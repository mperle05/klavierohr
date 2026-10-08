// score.js — OSMD-Hülle: Laden, Rendern, Schritte (Anschlagzeitpunkte) extrahieren, Cursor, Einfärben

// Statusfarben (geprüft auf Farbsehschwäche zusammen mit den Markierungen ‹ › ✕ als zweitem Kanal)
const COLORS = {
  ok: '#12896f', early: '#c27f00', late: '#c27f00', far: '#c27f00', miss: '#cf2a4a', wrong: '#cf2a4a', pending: null, next: '#2f55d4',
};

export function midiOfNote(note) {
  return note.Pitch ? note.Pitch.getHalfTone() + 12 : null;
}

export class Score {
  constructor(container, opts = {}) {
    this.container = container;
    this.opts = opts;
    this.osmd = null;
    this.steps = [];
    this.measures = [];
    this.staves = [];
    this.noteState = new Map(); // key -> state
    this.zoom = opts.zoom || 1;
  }

  async load(content, { title = '', autoBeam = false } = {}) {
    this.container.innerHTML = '';
    const OSMD = window.opensheetmusicdisplay.OpenSheetMusicDisplay;
    this.osmd = new OSMD(this.container, {
      autoResize: false,
      backend: 'svg',
      drawTitle: true,
      drawSubtitle: true,
      drawComposer: true,
      drawLyricist: false,
      drawCredits: false,
      drawPartNames: false,
      drawMeasureNumbers: true,
      drawFingerings: true,
      autoBeam,
      followCursor: true,
      pageFormat: 'Endless',
      newSystemFromXML: false,
      defaultColorMusic: '#16181d',
      cursorsOptions: [{ type: 0, color: '#2f55d4', alpha: 0.28, follow: true }],
    });
    this.osmd.zoom = this.zoom;
    await this.osmd.load(content, title);
    this.render();
    this.buildModel();
  }

  render() {
    if (!this.osmd) return;
    this.osmd.zoom = this.zoom;
    this.osmd.render();
    this.lastWidth = this.container.clientWidth;
    this.osmd.cursor.show();
    if (this.steps.length) {
      this.refreshGraphics();
      this.applyColors();
    }
  }

  setZoom(z) {
    this.zoom = Math.max(0.5, Math.min(2, z));
    const k = this.cursorStep;
    this.render();
    if (k !== undefined) this.cursorToStep(k, false);
  }

  maybeResize() {
    if (!this.osmd) return;
    const w = this.container.clientWidth;
    if (Math.abs(w - (this.lastWidth || 0)) > 24) {
      const k = this.cursorStep;
      this.render();
      if (k !== undefined) this.cursorToStep(k, false);
    }
  }

  get sheet() { return this.osmd.Sheet; }

  // ------------------------------------------------------------------ Modell
  buildModel() {
    const sheet = this.sheet;
    // Systeme / Instrumente
    this.staves = sheet.Staves.map(s => ({ id: s.idInMusicSheet, instrument: s.ParentInstrument.Name || '', instrumentId: s.ParentInstrument.Id }));
    // Takte
    this.measures = sheet.SourceMeasures.map((m, i) => {
      const ts = m.ActiveTimeSignature;
      return {
        idx: i,
        no: m.MeasureNumber,
        t0: m.AbsoluteTimestamp.RealValue * 4,         // in Vierteln
        durQ: m.Duration.RealValue * 4,
        num: ts ? ts.Numerator : 4,
        den: ts ? ts.Denominator : 4,
        nominalQ: ts ? ts.Numerator * 4 / ts.Denominator : 4,
        implicit: !!m.ImplicitMeasure,
        tempo: m.TempoInBPM || 0,
      };
    });
    this.tempo = sheet.HasBPMInfo ? sheet.DefaultStartTempoInBpm : 0;
    // Schritte über den Cursor
    const c = this.osmd.cursor;
    c.reset();
    const steps = [];
    let pos = 0, guard = 0;
    while (!c.iterator.EndReached && guard++ < 20000) {
      const it = c.iterator;
      const tq = it.currentTimeStamp.RealValue * 4;
      const notes = [];
      const gnotes = c.GNotesUnderCursor();
      for (const ve of it.CurrentVoiceEntries) {
        for (const n of ve.Notes) {
          if (n.isRest() || !n.Pitch) continue;
          if (n.IsGraceNote || n.IsCueNote) continue;
          if (n.PrintObject === false) continue;
          const tie = n.NoteTie;
          if (tie && tie.StartNote !== n) continue; // Fortsetzung eines Haltebogens
          let durQ = n.Length.RealValue * 4;
          if (tie && tie.StartNote === n) {
            durQ = 0;
            for (const tn of tie.Notes) durQ += tn.Length.RealValue * 4;
          }
          const staff = n.ParentStaff.idInMusicSheet;
          const arts = (ve.Articulations || []).map(a => a.articulationEnum);
          notes.push({
            staccato: arts.some(a => a === 6 || a === 7 || a === 8),
            fermata: arts.some(a => a === 10 || a === 11) || !!(ve.Fermata),
            midi: midiOfNote(n),
            staff,
            durQ,
            note: n,
            name: n.Pitch.ToStringShort ? n.Pitch.ToStringShort() : '',
            measureIdx: it.CurrentMeasureIndex,
            gnote: gnotes.find(g => g.sourceNote === n) || null,
          });
        }
      }
      if (notes.length) {
        // gleiche Tonhöhe doppelt (zwei Stimmen) zusammenfassen
        const seen = new Map();
        const uniq = [];
        for (const nt of notes) {
          const k = nt.midi + ':' + nt.staff;
          if (seen.has(k)) { const o = seen.get(k); o.durQ = Math.max(o.durQ, nt.durQ); o.extra = (o.extra || []).concat(nt); continue; }
          seen.set(k, nt); uniq.push(nt);
        }
        steps.push({ i: steps.length, t: tq, pos, measureIdx: it.CurrentMeasureIndex, notes: uniq });
      }
      c.next();
      pos++;
    }
    steps.forEach(st => st.notes.forEach((nt, j) => { nt.key = st.i + ':' + j; nt.step = st.i; }));
    this.steps = steps;
    this.cursorPositions = pos;
    c.reset();
    this.cursorPos = 0;
    this.cursorStep = 0;
    // Tonumfang
    const all = steps.flatMap(s => s.notes.map(n => n.midi));
    this.range = all.length ? [Math.min(...all), Math.max(...all)] : [60, 72];
  }

  refreshGraphics() {
    // nach neuem Rendering die GraphicalNotes neu zuordnen
    const c = this.osmd.cursor;
    c.reset();
    let pos = 0, si = 0;
    while (!c.iterator.EndReached && si < this.steps.length) {
      const st = this.steps[si];
      if (pos === st.pos) {
        const gnotes = c.GNotesUnderCursor();
        for (const nt of st.notes) nt.gnote = gnotes.find(g => g.sourceNote === nt.note) || null;
        si++;
      }
      c.next(); pos++;
    }
    c.reset();
    this.cursorPos = 0;
  }

  // ------------------------------------------------------------------ Cursor
  cursorToStep(k, smooth = true) {
    const st = this.steps[k];
    if (!st) return;
    const c = this.osmd.cursor;
    if (st.pos < this.cursorPos) { c.reset(); this.cursorPos = 0; }
    while (this.cursorPos < st.pos && !c.iterator.EndReached) { c.next(); this.cursorPos++; }
    this.cursorStep = k;
    c.show();
    if (smooth) this.scrollCursorIntoView();
  }

  scrollCursorIntoView() {
    const el = this.osmd.cursor.cursorElement;
    const sc = this.opts.scrollEl || this.container.parentElement;
    if (!el || !sc) return;
    const r = el.getBoundingClientRect(), sr = sc.getBoundingClientRect();
    const margin = sr.height * 0.18;
    if (r.top < sr.top + margin || r.bottom > sr.bottom - margin) {
      sc.scrollTo({ top: sc.scrollTop + (r.top - sr.top) - sr.height * 0.25, behavior: 'smooth' });
    }
  }

  hideCursor() { this.osmd?.cursor.hide(); }
  showCursor() { this.osmd?.cursor.show(); }

  // ------------------------------------------------------------------ Farben
  setNoteState(nt, state) {
    if (state) this.noteState.set(nt.key, state); else this.noteState.delete(nt.key);
    this.paint(nt, state);
  }
  paint(nt, state) {
    const color = state ? COLORS[state] : '#16181d';
    const targets = [nt, ...(nt.extra || [])];
    for (const t of targets) {
      if (!t.gnote) continue;
      try {
        t.gnote.setColor(color || '#16181d', { applyToNoteheads: true, applyToStem: !!state && state !== 'next', applyToFlag: !!state && state !== 'next', applyToBeams: false, applyToLedgerLines: false, applyToModifiers: true, applyToTies: false, applyToSlurs: false });
      } catch { /* ältere Notenköpfe ohne SVG */ }
    }
  }
  applyColors() {
    for (const st of this.steps) for (const nt of st.notes) {
      const s = this.noteState.get(nt.key);
      if (s) this.paint(nt, s);
    }
  }
  clearColors(filter = null) {
    for (const st of this.steps) for (const nt of st.notes) {
      if (filter && !filter(nt)) continue;
      if (this.noteState.has(nt.key)) { this.noteState.delete(nt.key); this.paint(nt, null); }
    }
  }

  // Bounding-Box eines Notenkopfs relativ zum Container (für Markierungen/Antippen)
  noteBox(nt) {
    try {
      const heads = nt.gnote?.getNoteheadSVGs?.();
      const el = heads && heads[0] ? heads[0] : nt.gnote?.getSVGGElement?.();
      if (!el) return null;
      const r = el.getBoundingClientRect(), cr = this.container.getBoundingClientRect();
      return { x: r.left - cr.left, y: r.top - cr.top, w: r.width, h: r.height };
    } catch { return null; }
  }

  measureOfStep(k) { return this.measures[this.steps[k].measureIdx]; }
  stepsInMeasures(a, b) {
    return this.steps.filter(s => s.measureIdx >= a && s.measureIdx <= b);
  }
}
