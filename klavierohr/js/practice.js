// practice.js — Übungslogik: Warte-Modus (abhaken) und Tempo-Modus (Timing, Tempo, Notenlänge)
import { judge } from './detector.js';

export function beatInfo(measure) {
  const num = measure?.num || 4, den = measure?.den || 4;
  if (den === 8 && num % 3 === 0 && num >= 6) return { beatQ: 1.5, beatsPerBar: num / 3, unit: 'dotted-quarter' };
  if (den === 8) return { beatQ: 0.5, beatsPerBar: num, unit: 'eighth' };
  if (den === 2) return { beatQ: 2, beatsPerBar: num, unit: 'half' };
  if (den === 16) return { beatQ: 0.25, beatsPerBar: num, unit: 'sixteenth' };
  return { beatQ: 4 / den, beatsPerBar: num, unit: 'quarter' };
}

// Systeme der Klavierstimme bestimmen und Händen zuordnen
export function staffRoles(score) {
  const staves = score.staves;
  const byInst = new Map();
  for (const s of staves) { if (!byInst.has(s.instrumentId)) byInst.set(s.instrumentId, []); byInst.get(s.instrumentId).push(s); }
  let piano = null;
  for (const [, list] of byInst) {
    if (/klavier|piano|pno|pf|flügel|keyboard/i.test(list[0].instrument)) { piano = list; break; }
  }
  if (!piano) piano = [...byInst.values()].find(l => l.length === 2) || [...byInst.values()][0] || [];
  const ids = piano.map(s => s.id);
  return { piano: ids, right: ids[0], left: ids.length > 1 ? ids[ids.length - 1] : ids[0], twoHands: ids.length > 1 };
}

export class Practice {
  constructor({ score, audio, settings, emit }) {
    this.score = score;
    this.audio = audio;
    this.settings = settings;
    this.emit = emit || (() => { });
    this.running = false;
    this.roles = staffRoles(score);
    this.unsub = [];
    // falsche Töne nur im Umfeld des Stücks suchen (± Oktave)
    this.cand = [score.range[0] - 12, score.range[1] + 12];
  }

  configure(cfg) {
    this.cfg = { mode: 'wait', hands: 'both', from: 0, to: this.score.measures.length - 1, loop: false, metronome: true, ...cfg };
    const { piano, right, left } = this.roles;
    const h = this.cfg.hands;
    this.reqStaves = new Set(h === 'right' ? [right] : h === 'left' ? [left] : piano);
    const steps = this.score.steps;
    this.seq = steps.filter(s => s.measureIdx >= this.cfg.from && s.measureIdx <= this.cfg.to && s.notes.some(n => this.reqStaves.has(n.staff)));
    this.inRange = steps.filter(s => s.measureIdx >= this.cfg.from && s.measureIdx <= this.cfg.to);
  }

  required(st) { return st.notes.filter(n => this.reqStaves.has(n.staff)); }
  // Töne früherer Schritte, die laut Noten zum Zeitpunkt q noch klingen (gehalten)
  soundingAt(q) {
    const out = new Set();
    for (const st of this.score.steps) {
      if (st.t >= q - 1e-6) break;
      for (const nt of st.notes) if (st.t + nt.durQ > q + 1e-6) out.add(nt.midi);
    }
    return out;
  }
  others(st) { return st.notes.filter(n => !this.reqStaves.has(n.staff)); }

  // ------------------------------------------------------------------
  async start() {
    if (this.running) this.stop();
    const det = await this.audio.startMic();
    this.det = det;
    det.reset();
    this.running = true;
    this.results = { mode: this.cfg.mode, startedAt: Date.now(), notes: new Map(), wrong: [], steps: [], iterations: 0 };
    this.score.clearColors();
    this.unsub.push(det.on('analysis', ev => this.onAnalysis(ev)));
    this.unsub.push(det.on('release', ev => this.onRelease(ev)));
    if (this.cfg.mode === 'wait') this.startWait();
    else await this.startTempo();
  }

  stop(reason = 'stop') {
    if (!this.running) return;
    this.running = false;
    this.unsub.forEach(f => f()); this.unsub = [];
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.det?.reset();
    const summary = this.cfg.mode === 'wait' ? this.summarizeWait() : this.summarizeTempo();
    this.emit('stopped', { reason, summary });
    return summary;
  }

  // ================================================================== Warten
  startWait() {
    this.k = 0;
    this.checked = new Set();
    this.stepErrors = 0;
    this.stepStart = performance.now();
    this.lastDone = null;
    this.activateStep();
  }

  activateStep() {
    const st = this.seq[this.k];
    if (!st) return;
    this.checked = new Set();
    this.stepErrors = 0;
    this.stepStart = performance.now();
    this.score.cursorToStep(st.i);
    for (const nt of this.required(st)) this.score.setNoteState(nt, 'next');
    this.emit('expect', { midis: [...new Set(this.required(st).map(n => n.midi))], step: st, k: this.k, total: this.seq.length });
  }

  waitAllowed(st) {
    const a = new Set();
    for (const nt of this.others(st)) a.add(nt.midi);
    const prev = this.seq[this.k - 1], next = this.seq[this.k + 1];
    for (const s of [prev, next]) if (s) for (const nt of this.others(s)) a.add(nt.midi);
    return a;
  }

  onWaitAnalysis(ev) {
    const st = this.seq[this.k];
    if (!st) return;
    const req = [...new Set(this.required(st).map(n => n.midi))];
    const recent = new Set();
    for (const d of this.doneHist || []) if (performance.now() - d.at < 2500) d.midis.forEach(m => recent.add(m));
    this.checked.forEach(m => recent.add(m));
    const j = judge(ev, req, this.waitAllowed(st), undefined, recent, this.soundingAt(st.t), this.cand);
    const fresh = j.present.filter(m => !this.checked.has(m));
    for (const m of fresh) {
      this.checked.add(m);
      for (const nt of this.required(st)) if (nt.midi === m) this.score.setNoteState(nt, this.stepErrors ? 'early' : 'ok');
      this.emit('hit', { midi: m });
      if (ev.postLen > 3000) this.det.learnTuning(ev, m);
    }
    if (j.wrong.length && !fresh.length) {
      this.stepErrors++;
      this.results.wrong.push({ step: st.i, midi: j.wrong[0].midi, expected: req.filter(m => !this.checked.has(m)), t: performance.now() });
      this.emit('wrong', { midi: j.wrong[0].midi, expected: req.filter(m => !this.checked.has(m)), info: j.info });
    } else if (j.wrong.length) {
      // richtige und falsche Töne zugleich
      this.stepErrors++;
      this.results.wrong.push({ step: st.i, midi: j.wrong[0].midi, expected: req, t: performance.now() });
      this.emit('wrong', { midi: j.wrong[0].midi, expected: req, info: j.info });
    } else if (!fresh.length && j.missing.length) {
      // Anschlag ohne Treffer – Hinweis aus den Gründen ableiten
      const why = Object.values(j.info).map(i => i.why).find(w => w && w.startsWith('oktave'));
      if (why) this.emit('hint', { text: why === 'oktave höher?' ? 'Eine Oktave zu hoch?' : 'Eine Oktave zu tief?' });
    }
    if (req.every(m => this.checked.has(m))) this.completeStep(false);
  }

  completeStep(skipped) {
    const st = this.seq[this.k];
    const dt = (performance.now() - this.stepStart) / 1000;
    this.results.steps.push({ step: st.i, measureIdx: st.measureIdx, time: dt, errors: this.stepErrors, skipped });
    for (const nt of this.required(st)) {
      const state = skipped ? 'miss' : (this.stepErrors ? 'early' : 'ok');
      this.score.setNoteState(nt, state);
      this.results.notes.set(nt.key, { state, errors: this.stepErrors, skipped, time: dt });
    }
    this.lastDone = { at: performance.now(), midis: this.required(st).map(n => n.midi) };
    (this.doneHist ||= []).push(this.lastDone);
    if (this.doneHist.length > 3) this.doneHist.shift();
    this.k++;
    this.emit('progress', { k: this.k, total: this.seq.length });
    if (this.k >= this.seq.length) {
      if (this.cfg.loop) {
        this.results.iterations++;
        this.k = 0;
        setTimeout(() => { if (!this.running) return; this.score.clearColors(); this.activateStep(); }, 600);
        this.emit('loop', { iteration: this.results.iterations });
        return;
      }
      this.results.iterations++;
      setTimeout(() => this.stop('done'), 350);
      return;
    }
    this.activateStep();
  }

  skip() {
    if (!this.running || this.cfg.mode !== 'wait') return;
    this.completeStep(true);
  }

  summarizeWait() {
    const steps = this.results.steps;
    const n = steps.length;
    const clean = steps.filter(s => !s.errors && !s.skipped).length;
    const errors = Math.max(steps.reduce((a, s) => a + s.errors, 0), this.results.wrong.length);
    const skipped = steps.filter(s => s.skipped).length;
    const times = steps.map(s => s.time).sort((a, b) => a - b);
    const med = times.length ? times[times.length >> 1] : 0;
    const byMeasure = new Map();
    for (const s of steps) {
      const m = byMeasure.get(s.measureIdx) || { idx: s.measureIdx, errors: 0, slow: 0, steps: 0, skipped: 0 };
      m.steps++; m.errors += s.errors; m.skipped += s.skipped ? 1 : 0;
      if (s.time > Math.max(2.5, med * 2.5)) m.slow++;
      byMeasure.set(s.measureIdx, m);
    }
    const problem = [...byMeasure.values()].map(m => ({ ...m, score: m.errors * 2 + m.slow + m.skipped * 2 }))
      .filter(m => m.score > 0).sort((a, b) => b.score - a.score).slice(0, 3);
    return {
      mode: 'wait', steps: n, total: this.seq.length, clean, errors, skipped, medianStepTime: med,
      totalTime: (Date.now() - this.results.startedAt) / 1000,
      accuracy: n ? clean / n : 0, problem: problem.map(m => ({ ...m, no: this.score.measures[m.idx]?.no })),
      complete: n >= this.seq.length,
    };
  }

  // ================================================================== Tempo
  async startTempo() {
    const sc = this.score;
    const m0 = sc.measures[this.cfg.from];
    const bi = beatInfo(m0);
    this.bi = bi;
    this.bpmQ = this.cfg.beatBpm * bi.beatQ;   // Viertel pro Minute
    this.spq = 60 / this.bpmQ;                // Sekunden pro Viertel
    this.rangeStartQ = m0.t0;
    const last = sc.measures[this.cfg.to];
    this.rangeEndQ = last.t0 + last.durQ;
    // Auftakt: Taktraster beginnt vor dem ersten (kurzen) Takt
    this.gridQ = m0.implicit && m0.durQ < m0.nominalQ - 1e-6 ? m0.t0 - (m0.nominalQ - m0.durQ) : m0.t0;
    let countBeats = bi.beatsPerBar * (bi.beatsPerBar <= 2 ? 2 : 1);
    this.firstClickQ = this.gridQ - countBeats * bi.beatQ;
    this.T0 = this.audio.now() + 0.35;
    this.latency = this.settings.latency ?? (this.audio.outputLatency + 0.02);
    this.iter = 0;
    this.nextClickQ = this.firstClickQ;
    this.hits = new Map();       // key -> {t, dev, onsetIdx}
    this.finalized = new Set();
    this.trackId = 0;
    this.trackMap = new Map();   // trackId -> key
    this.durations = new Map();  // key -> seconds
    this.iterResults = [];
    this.dispIter = 0;
    this.noteStates = new Map();
    this.schedule();
    this.timer = setInterval(() => this.schedule(), 25);
    const loop = () => { if (!this.running) return; this.frame(); this.raf = requestAnimationFrame(loop); };
    this.raf = requestAnimationFrame(loop);
    this.emit('expect', { midis: [], k: 0, total: this.seq.length });
  }

  // Liedzeit (Viertel) → AudioContext-Zeit, für Durchlauf n
  T(q, n = this.iter) { return this.T0 + (q - this.firstClickQ + n * (this.rangeEndQ - this.rangeStartQ)) * this.spq; }

  schedule() {
    // Metronom vorausplanen
    const ahead = this.audio.now() + 0.2;
    const bq = this.bi.beatQ;
    while (true) {
      // globale Klickzeit unabhängig von Durchlauf: Klicks laufen durchgehend
      const tq = this.nextClickQ;
      const t = this.T0 + (tq - this.firstClickQ) * this.spq;
      if (t > ahead) break;
      const inCount = tq < this.gridQ - 1e-6;
      const loopLen = this.rangeEndQ - this.rangeStartQ;
      const songQ = this.cfg.loop ? this.rangeStartQ + ((tq - this.rangeStartQ) % loopLen + loopLen) % loopLen : tq;
      const endT = this.T(this.rangeEndQ, this.cfg.loop ? 1e9 : 0);
      const barPos = Math.round(((tq - this.gridQ) / bq)) % this.bi.beatsPerBar;
      const accent = ((barPos % this.bi.beatsPerBar) + this.bi.beatsPerBar) % this.bi.beatsPerBar === 0;
      if (inCount) {
        this.audio.click(t, accent);
        const num = Math.round((tq - this.firstClickQ) / bq) % this.bi.beatsPerBar + 1;
        const delay = Math.max(0, (t + this.audio.outputLatency - this.audio.now()) * 1000);
        setTimeout(() => this.running && this.emit('count', { n: num }), delay);
      } else if (this.cfg.metronome && t < endT + 0.01) {
        this.audio.click(t, accent);
      }
      void songQ;
      this.nextClickQ += bq;
    }
  }

  frame() {
    const now = this.audio.now();
    const heard = now - this.audio.outputLatency;
    const loop = this.cfg.loop;
    const rangeLen = this.rangeEndQ - this.rangeStartQ;
    // angezeigter Durchlauf (bei Schleife)
    const heardQ = (heard - this.T0) / this.spq + this.firstClickQ;
    const nDisp = loop ? Math.max(0, Math.floor((heardQ - this.rangeStartQ + 0.02) / rangeLen)) : 0;
    if (nDisp !== this.dispIter) { this.dispIter = nDisp; this.curK = -1; this.repaint(); }
    // Cursor: letzter Schritt, dessen Zeit erreicht ist
    let cur = -1;
    for (let k = 0; k < this.seq.length; k++) { if (this.T(this.seq[k].t, nDisp) <= heard + 0.03) cur = k; else break; }
    if (cur >= 0 && cur !== this.curK) {
      this.curK = cur;
      const st = this.seq[cur];
      this.score.cursorToStep(st.i);
      this.emit('expect', { midis: [...new Set(this.required(st).map(n => n.midi))], step: st, k: cur, total: this.seq.length });
      if (cur === 0 && nDisp === 0) this.emit('count', { n: 0 });
    }
    // Schritte abschließen, deren Fenster vorbei ist (aktueller und – bei Schleife – nächster Durchlauf)
    for (const n of loop ? [this.iter, this.iter + 1] : [this.iter]) {
      for (let k = 0; k < this.seq.length; k++) {
        const st = this.seq[k];
        if (this.finalized.has(n + ':' + st.i)) continue;
        const [, wl] = this.windowOf(k);
        if (now - this.latency > this.T(st.t, n) + wl + 0.22) this.finalizeStep(n, k);
        else break;
      }
    }
    // Ende des Durchlaufs
    const done = this.seq.every(st => this.finalized.has(this.iter + ':' + st.i));
    if (done) {
      if (loop) {
        this.iterResults.push(this.iterationStats(this.iter));
        this.emit('loop', { iteration: this.iter + 1, stats: this.iterResults[this.iterResults.length - 1] });
        this.iter++;
      } else if (!this.ending && now - this.latency > this.T(this.rangeEndQ) + 0.35) {
        this.ending = true;
        // auf Loslass-Ereignisse der letzten Noten warten
        setTimeout(() => this.stop('done'), 900);
      }
    }
  }

  paintNote(n, nt, state) {
    (this.noteStates ||= new Map()).set(n + ':' + nt.key, state);
    if (n === (this.dispIter || 0)) this.score.setNoteState(nt, state);
  }
  repaint() {
    this.score.clearColors();
    for (const st of this.seq) for (const nt of this.required(st)) {
      const sNow = this.noteStates?.get((this.dispIter || 0) + ':' + nt.key);
      if (sNow) this.score.setNoteState(nt, sNow);
    }
  }

  windowOf(k) {
    const st = this.seq[k];
    const prev = this.seq[k - 1], next = this.seq[k + 1];
    const t = st.t;
    const gapP = prev ? (t - prev.t) * this.spq : 1;
    const gapN = next ? (next.t - t) * this.spq : 1;
    return [Math.min(0.32, Math.max(0.08, gapP * 0.6)), Math.min(0.4, Math.max(0.09, gapN * 0.7))];
  }

  onTempoAnalysis(ev) {
    const tc = ev.time - this.latency;
    const iters = this.cfg.loop ? [this.iter, this.iter + 1] : [this.iter];
    // Kandidaten (Durchlauf, Schritt), deren Fenster tc enthält
    const cands = [];
    for (const n of iters) for (let k = 0; k < this.seq.length; k++) {
      const st = this.seq[k];
      const T = this.T(st.t, n);
      const [we, wl] = this.windowOf(k);
      if (tc >= T - we && tc <= T + wl && !this.finalized.has(n + ':' + st.i)) cands.push({ n, k, st, T });
    }
    if (!cands.length && tc < this.T(this.rangeStartQ, 0) - 0.35) return; // während des Einzählens
    const expected = new Set(), allowed = new Set(), recent = new Set();
    for (const c of cands) {
      for (const nt of this.required(c.st)) expected.add(nt.midi);
      for (const nt of this.others(c.st)) allowed.add(nt.midi);
    }
    for (const n of [this.iter - 1, ...iters]) {
      if (n < 0) continue;
      for (let k = 0; k < this.seq.length; k++) {
        const T = this.T(this.seq[k].t, n);
        if (T < tc - 0.03 && T > tc - 1.6) for (const nt of this.required(this.seq[k])) recent.add(nt.midi);
        if (Math.abs(T - tc) < 0.5) for (const nt of this.others(this.seq[k])) allowed.add(nt.midi);
      }
    }
    const qNow = cands.length ? cands[0].st.t : (this.nearestStep(tc)?.t ?? 0);
    const j = judge(ev, [...expected], allowed, undefined, recent, this.soundingAt(qNow), this.cand);
    for (const m of j.present) {
      // nächstgelegene offene Note mit dieser Tonhöhe
      let best = null;
      for (const c of cands) {
        for (const nt of this.required(c.st)) {
          if (nt.midi !== m) continue;
          const key = c.n + ':' + nt.key;
          if (this.hits.has(key)) continue;
          const d = Math.abs(tc - c.T);
          if (!best || d < best.d) best = { d, nt, c, key };
        }
      }
      if (!best) continue;
      const dev = tc - best.c.T;
      this.hits.set(best.key, { t: tc, dev, onsetIdx: ev.idx, midi: m, q: best.c.st.t });
      const id = ++this.trackId;
      this.trackMap.set(id, best.key);
      this.det.track(id, m, ev.idx, best.nt.durQ * this.spq);
      this.paintNote(best.c.n, best.nt, this.devState(dev));
      this.emit('hit', { midi: m, dev });
      // gleichbleibender Versatz? → Hinweis auf Latenzmessung
      (this.devHist ||= []).push(dev);
      if (this.devHist.length === 12 && !this.latHinted) {
        const d = [...this.devHist].sort((a, b) => a - b), med = d[6];
        const spread = d[9] - d[2];
        if (Math.abs(med) > 0.09 && spread < 0.08) { this.latHinted = true; this.emit('latencyHint', { offset: med }); }
      }
      if (ev.postLen > 3000) this.det.learnTuning(ev, m);
    }
    for (const w of j.wrong) {
      const c0 = cands[0];
      const nearest = c0?.st || this.nearestStep(tc);
      this.results.wrong.push({ step: nearest?.i, midi: w.midi, t: tc, iter: c0 ? c0.n : this.iter, measureIdx: nearest?.measureIdx });
      this.emit('wrong', { midi: w.midi, expected: [...expected] });
    }
  }

  nearestStep(tc) {
    let best = null, bd = 1e9;
    for (const st of this.seq) { const d = Math.abs(this.T(st.t) - tc); if (d < bd) { bd = d; best = st; } }
    return best;
  }

  devState(dev) {
    const a = Math.abs(dev);
    if (a <= (this.settings.tolOk ?? 0.06)) return 'ok';
    if (a <= (this.settings.tolWarn ?? 0.13)) return dev < 0 ? 'early' : 'late';
    return 'far';
  }

  finalizeStep(n, k) {
    const st = this.seq[k];
    this.finalized.add(n + ':' + st.i);
    for (const nt of this.required(st)) {
      if (!this.hits.has(n + ':' + nt.key)) this.paintNote(n, nt, 'miss');
    }
  }

  onRelease(ev) {
    if (!this.trackMap) return;
    const key = this.trackMap.get(ev.id);
    if (!key) return;
    this.trackMap.delete(ev.id);
    if (ev.reason === 'damper' || (ev.reason === 'restrike' && ev.measurable)) this.durations.set(key, { dur: ev.duration, reason: ev.reason });
  }

  onAnalysis(ev) {
    if (!this.running) return;
    if (this.cfg.mode === 'wait') this.onWaitAnalysis(ev);
    else this.onTempoAnalysis(ev);
  }

  iterationStats(iter = this.iter) {
    let req = 0, hit = 0;
    const devs = [];
    for (const st of this.seq) for (const nt of this.required(st)) {
      req++;
      const h = this.hits.get(iter + ':' + nt.key);
      if (h) { hit++; devs.push(h.dev); }
    }
    const wrong = this.results.wrong.filter(w => w.iter === iter).length;
    return { req, hit, wrong, acc: req ? hit / req : 0, devs };
  }

  summarizeTempo() {
    const iters = this.iter + 1;
    // Auswertung des letzten vollständigen (bzw. aktuellen) Durchlaufs
    const iterStarted = n => this.seq.some(st => this.finalized.has(n + ':' + st.i));
    const it = this.cfg.loop && this.iter > 0 && !iterStarted(this.iter) ? this.iter - 1 : this.iter;
    const notes = [];
    for (const st of this.seq) for (const nt of this.required(st)) {
      const key = it + ':' + nt.key;
      const h = this.hits.get(key);
      const expDur = nt.durQ * this.spq;
      const d = this.durations.get(key);
      notes.push({ key: nt.key, nt, st, midi: nt.midi, measureIdx: st.measureIdx, q: st.t, hit: !!h, dev: h ? h.dev : null, t: h?.t, expDur, dur: d?.dur ?? null });
    }
    const played = notes.filter(n => this.finalized.has(it + ':' + n.st.i));
    const hits = played.filter(n => n.hit);
    const devs = hits.map(n => n.dev * 1000);
    const mean = devs.length ? devs.reduce((a, b) => a + b, 0) / devs.length : 0;
    const sd = devs.length > 1 ? Math.sqrt(devs.reduce((a, b) => a + (b - mean) ** 2, 0) / (devs.length - 1)) : 0;
    const within = devs.filter(d => Math.abs(d) <= (this.settings.tolOk ?? 0.06) * 1000).length;
    // Tempo-Regression t = a + b·q über Schritte mit Treffer (Median je Schritt)
    const byStep = new Map();
    for (const n of hits) { if (!byStep.has(n.st.i)) byStep.set(n.st.i, []); byStep.get(n.st.i).push(n); }
    const pts = [...byStep.values()].map(arr => { const ts = arr.map(a => a.t).sort((a, b) => a - b); return { q: arr[0].q, t: ts[ts.length >> 1] }; });
    let playedBpmQ = null, drift = null;
    if (pts.length >= 4) {
      const fit = (P) => {
        const n = P.length, mq = P.reduce((a, p) => a + p.q, 0) / n, mt = P.reduce((a, p) => a + p.t, 0) / n;
        let sxy = 0, sxx = 0;
        for (const p of P) { sxy += (p.q - mq) * (p.t - mt); sxx += (p.q - mq) ** 2; }
        return sxx > 0 ? sxy / sxx : null;
      };
      const b = fit(pts);
      if (b) playedBpmQ = 60 / b;
      if (pts.length >= 8) {
        const h = pts.length >> 1;
        const b1 = fit(pts.slice(0, h)), b2 = fit(pts.slice(h));
        if (b1 && b2) drift = (60 / b2 - 60 / b1) / this.bpmQ; // >0: wird schneller
      }
    }
    // Notenlängen
    const short = [];
    const judgeable = n => n.dur !== null && n.expDur >= 0.42 && !n.nt.staccato && !n.nt.fermata;
    for (const n of hits) {
      if (!judgeable(n)) continue;
      if (n.dur < 0.6 * n.expDur) short.push(n);
    }
    const measured = hits.filter(judgeable).length;
    // Takte
    const byM = new Map();
    for (const n of played) {
      const m = byM.get(n.measureIdx) || { idx: n.measureIdx, req: 0, hit: 0, absDev: 0, wrong: 0, short: 0 };
      m.req++; if (n.hit) { m.hit++; m.absDev += Math.abs(n.dev); }
      byM.set(n.measureIdx, m);
    }
    for (const w of this.results.wrong.filter(w => w.iter === it)) { const m = byM.get(w.measureIdx); if (m) m.wrong++; }
    for (const s of short) { const m = byM.get(s.measureIdx); if (m) m.short++; }
    const measures = [...byM.values()].map(m => ({
      ...m, no: this.score.measures[m.idx]?.no, acc: m.req ? m.hit / m.req : 0, meanAbsDev: m.hit ? m.absDev / m.hit : 0,
      score: (m.req - m.hit) * 2 + m.wrong * 2 + (m.hit ? Math.max(0, m.absDev / m.hit - 0.06) * 20 : 0) + m.short * 0.5,
    }));
    const problem = measures.filter(m => m.score > 0.6).sort((a, b) => b.score - a.score).slice(0, 3);
    return {
      mode: 'tempo', iterations: iters, req: played.length, hit: hits.length, accuracy: played.length ? hits.length / played.length : 0,
      wrong: this.results.wrong.filter(w => w.iter === it).length,
      meanDev: mean, sdDev: sd, within: devs.length ? within / devs.length : 0,
      targetBpmQ: this.bpmQ, playedBpmQ, drift, beat: this.bi, beatBpm: this.cfg.beatBpm,
      short, measured, notes, measures, problem, complete: played.length >= notes.length,
      loopStats: this.iterResults,
    };
  }
}
