// scoregen.js — kompakte Notenbeschreibung → MusicXML (für Übungen und Beispielstücke)
//
// Token-Syntax pro Takt (durch Leerzeichen getrennt):
//   E4            Viertel (oder Dauer des vorigen Tokens)
//   F#4:e         Achtel, Vorzeichen # / b / ## / bb / n
//   C3+E3+G3:h.   Akkord, punktierte Halbe
//   r:q           Pause
//   G4:q~         Haltebogen zur nächsten gleichen Note
//   C4:q@1        Fingersatz 1
// Dauern: w h q e s t (Ganze … 32tel), Punkte mit "."

const DIV = 24; // divisions per quarter (teilbar durch 2,3,4,8)
const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 0.125 };
const TYPE = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth', s: '16th', t: '32nd' };
const STEP_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function parsePitch(s) {
  const m = /^([A-G])(##|bb|#|b|n)?(-?\d)$/.exec(s);
  if (!m) throw new Error('Ungültige Tonhöhe: ' + s);
  const alter = { '#': 1, '##': 2, b: -1, bb: -2, n: 0 }[m[2]] ?? 0;
  const octave = parseInt(m[3], 10);
  const midi = 12 * (octave + 1) + STEP_SEMI[m[1]] + alter;
  return { step: m[1], alter, octave, midi, explicitNatural: m[2] === 'n' };
}

export function parseToken(tok, prevDur) {
  let finger = null, tie = false;
  let t = tok;
  const at = t.indexOf('@');
  if (at >= 0) { finger = t.slice(at + 1); t = t.slice(0, at); }
  if (t.endsWith('~')) { tie = true; t = t.slice(0, -1); }
  let durCode = prevDur?.code ?? 'q', dots = prevDur?.dots ?? 0;
  const colon = t.indexOf(':');
  if (colon >= 0) {
    const d = t.slice(colon + 1);
    t = t.slice(0, colon);
    durCode = d[0];
    dots = d.length - 1;
    if (!(durCode in DUR) || /[^.]/.test(d.slice(1))) throw new Error('Ungültige Dauer: ' + tok);
  }
  let q = DUR[durCode], add = DUR[durCode];
  for (let i = 0; i < dots; i++) { add /= 2; q += add; }
  const rest = t === 'r';
  const pitches = rest ? [] : t.split('+').map(parsePitch);
  const fingers = finger ? finger.split('+') : [];
  return { rest, pitches, dur: { code: durCode, dots, q }, tie, fingers };
}

function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function noteXml(p, ev, opts) {
  const { isChord, staff, voice, tieStart, tieStop, finger } = opts;
  const dur = Math.round(ev.dur.q * DIV);
  let x = '<note>';
  if (isChord) x += '<chord/>';
  if (!p) x += '<rest/>';
  else {
    x += `<pitch><step>${p.step}</step>${p.alter ? `<alter>${p.alter}</alter>` : ''}<octave>${p.octave}</octave></pitch>`;
  }
  x += `<duration>${dur}</duration>`;
  if (tieStop) x += '<tie type="stop"/>';
  if (tieStart) x += '<tie type="start"/>';
  x += `<voice>${voice}</voice><type>${TYPE[ev.dur.code]}</type>`;
  for (let i = 0; i < ev.dur.dots; i++) x += '<dot/>';
  if (p && p.explicitNatural) x += '<accidental>natural</accidental>';
  x += `<staff>${staff}</staff>`;
  const notations = [];
  if (tieStop) notations.push('<tied type="stop"/>');
  if (tieStart) notations.push('<tied type="start"/>');
  if (finger) notations.push(`<technical><fingering>${esc(finger)}</fingering></technical>`);
  if (notations.length) x += `<notations>${notations.join('')}</notations>`;
  x += '</note>';
  return x;
}

/**
 * spec = { title, composer, tempo, time:"4/4", key:0 (Quintenzirkel), pickup:quarters|0,
 *          staves:[{clef:'G'|'F', bars:[...]}, ...] }
 */
export function specToMusicXML(spec) {
  const [beats, beatType] = (spec.time || '4/4').split('/').map(Number);
  const barQ = beats * 4 / beatType;
  const staves = spec.staves;
  const nBars = Math.max(...staves.map(s => s.bars.length));
  const tieOpen = staves.map(() => new Set()); // midi values with open tie per staff
  let measures = '';
  for (let b = 0; b < nBars; b++) {
    const isPickup = b === 0 && spec.pickup > 0;
    const mQ = isPickup ? spec.pickup : barQ;
    let mx = `<measure number="${isPickup ? 0 : (spec.pickup > 0 ? b : b + 1)}"${isPickup ? ' implicit="yes"' : ''}>`;
    if (b === 0) {
      mx += `<attributes><divisions>${DIV}</divisions><key><fifths>${spec.key || 0}</fifths>${spec.mode ? `<mode>${spec.mode}</mode>` : ''}</key>` +
        `<time><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>` +
        (staves.length > 1 ? `<staves>${staves.length}</staves>` : '') +
        staves.map((s, i) => `<clef number="${i + 1}"><sign>${s.clef === 'F' ? 'F' : 'G'}</sign><line>${s.clef === 'F' ? 4 : 2}</line></clef>`).join('') +
        '</attributes>';
      if (spec.tempo) {
        mx += `<direction placement="above"><direction-type><metronome><beat-unit>${spec.tempoUnit || 'quarter'}</beat-unit>` +
          `${spec.tempoUnitDot ? '<beat-unit-dot/>' : ''}<per-minute>${spec.tempo}</per-minute></metronome></direction-type>` +
          `<staff>1</staff><sound tempo="${spec.soundTempo || spec.tempo}"/></direction>`;
      }
    }
    if (spec.systemBreaks && spec.systemBreaks.includes(b) && b > 0) mx += '<print new-system="yes"/>';
    staves.forEach((staff, si) => {
      if (si > 0) mx += `<backup><duration>${Math.round(mQ * DIV)}</duration></backup>`;
      const barStr = (staff.bars[b] ?? '').trim();
      const voice = si === 0 ? 1 : 5;
      if (!barStr) {
        mx += `<note><rest measure="yes"/><duration>${Math.round(mQ * DIV)}</duration><voice>${voice}</voice><staff>${si + 1}</staff></note>`;
        return;
      }
      let prev = null, sum = 0;
      for (const tok of barStr.split(/\s+/)) {
        const ev = parseToken(tok, prev);
        prev = ev.dur;
        sum += ev.dur.q;
        if (ev.rest) {
          mx += noteXml(null, ev, { isChord: false, staff: si + 1, voice });
          continue;
        }
        ev.pitches.forEach((p, pi) => {
          const tieStop = tieOpen[si].has(p.midi);
          if (tieStop) tieOpen[si].delete(p.midi);
          const tieStart = ev.tie;
          if (tieStart) tieOpen[si].add(p.midi);
          mx += noteXml(p, ev, { isChord: pi > 0, staff: si + 1, voice, tieStart, tieStop, finger: ev.fingers[pi] });
        });
      }
      if (Math.abs(sum - mQ) > 1e-6) throw new Error(`Takt ${b + 1}, System ${si + 1}: ${sum} statt ${mQ} Viertel`);
    });
    if (b === nBars - 1) mx += '<barline location="right"><bar-style>light-heavy</bar-style></barline>';
    mx += '</measure>';
    measures += mx;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
<work><work-title>${esc(spec.title || 'Übung')}</work-title></work>
<identification>${spec.composer ? `<creator type="composer">${esc(spec.composer)}</creator>` : ''}${spec.arranger ? `<creator type="arranger">${esc(spec.arranger)}</creator>` : ''}</identification>
<part-list><score-part id="P1"><part-name>${esc(spec.partName ?? 'Klavier')}</part-name></score-part></part-list>
<part id="P1">${measures}</part>
</score-partwise>`;
}
