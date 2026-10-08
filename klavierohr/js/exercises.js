// exercises.js — Tonleitern, Akkorde und Notenlese-Übungen als Notenbeschreibung (→ scoregen)

const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];
const NAT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

// Tonarten (deutsche Namen), Grundton als Buchstabe + Vorzeichen, Quintenzirkel
export const KEYS_MAJOR = [
  { id: 'C', de: 'C-Dur', letter: 'C', alter: 0, fifths: 0 },
  { id: 'G', de: 'G-Dur', letter: 'G', alter: 0, fifths: 1 },
  { id: 'D', de: 'D-Dur', letter: 'D', alter: 0, fifths: 2 },
  { id: 'A', de: 'A-Dur', letter: 'A', alter: 0, fifths: 3 },
  { id: 'E', de: 'E-Dur', letter: 'E', alter: 0, fifths: 4 },
  { id: 'H', de: 'H-Dur', letter: 'B', alter: 0, fifths: 5 },
  { id: 'Fis', de: 'Fis-Dur', letter: 'F', alter: 1, fifths: 6 },
  { id: 'F', de: 'F-Dur', letter: 'F', alter: 0, fifths: -1 },
  { id: 'B', de: 'B-Dur', letter: 'B', alter: -1, fifths: -2 },
  { id: 'Es', de: 'Es-Dur', letter: 'E', alter: -1, fifths: -3 },
  { id: 'As', de: 'As-Dur', letter: 'A', alter: -1, fifths: -4 },
  { id: 'Des', de: 'Des-Dur', letter: 'D', alter: -1, fifths: -5 },
];
export const KEYS_MINOR = [
  { id: 'a', de: 'a-Moll', letter: 'A', alter: 0, fifths: 0 },
  { id: 'e', de: 'e-Moll', letter: 'E', alter: 0, fifths: 1 },
  { id: 'h', de: 'h-Moll', letter: 'B', alter: 0, fifths: 2 },
  { id: 'fis', de: 'fis-Moll', letter: 'F', alter: 1, fifths: 3 },
  { id: 'cis', de: 'cis-Moll', letter: 'C', alter: 1, fifths: 4 },
  { id: 'd', de: 'd-Moll', letter: 'D', alter: 0, fifths: -1 },
  { id: 'g', de: 'g-Moll', letter: 'G', alter: 0, fifths: -2 },
  { id: 'c', de: 'c-Moll', letter: 'C', alter: 0, fifths: -3 },
  { id: 'f', de: 'f-Moll', letter: 'F', alter: 0, fifths: -4 },
];

const PATTERNS = {
  major: [0, 2, 4, 5, 7, 9, 11],
  natural: [0, 2, 3, 5, 7, 8, 10],
  harmonic: [0, 2, 3, 5, 7, 8, 11],
  melodic: [0, 2, 3, 5, 7, 9, 11], // aufwärts; abwärts natürlich
};

// Standard-Fingersätze (eine Oktave aufwärts: Stufe 1–7, dazu Finger auf dem oberen Grundton)
// rh/lh: Zyklus für Stufen 1–7; top: oberster Ton; lhInner: LH-Finger auf dem Grundton in der Mitte (2 Oktaven)
const FING = {
  'C': { rh: [1, 2, 3, 1, 2, 3, 4], rhTop: 5, lh: [5, 4, 3, 2, 1, 3, 2], lhTop: 1, lhInner: 1 },
  'H': { rh: [1, 2, 3, 1, 2, 3, 4], rhTop: 5, lh: [4, 3, 2, 1, 4, 3, 2], lhTop: 1, lhInner: null },
  'Fis': { rh: [2, 3, 4, 1, 2, 3, 1], rhTop: 2, lh: [4, 3, 2, 1, 3, 2, 1], lhTop: 4, lhInner: 4 },
  'Des': { rh: [2, 3, 1, 2, 3, 4, 1], rhTop: 2, lh: [3, 2, 1, 4, 3, 2, 1], lhTop: 3, lhInner: 3 },
  'As': { rh: [3, 4, 1, 2, 3, 1, 2], rhTop: 3, lh: [3, 2, 1, 4, 3, 2, 1], lhTop: 3, lhInner: 3 },
  'Es': { rh: [3, 1, 2, 3, 4, 1, 2], rhTop: 3, lh: [3, 2, 1, 4, 3, 2, 1], lhTop: 3, lhInner: 3 },
  'B': { rh: [4, 1, 2, 3, 1, 2, 3], rhTop: 4, lh: [3, 2, 1, 4, 3, 2, 1], lhTop: 3, lhInner: 3 },
  'F': { rh: [1, 2, 3, 4, 1, 2, 3], rhTop: 4, lh: [5, 4, 3, 2, 1, 3, 2], lhTop: 1, lhInner: 1 },
};
const FING_ALIAS = { G: 'C', D: 'C', A: 'C', E: 'C', a: 'C', e: 'C', d: 'C', g: 'C', c: 'C', h: 'H', f: 'F' };
function fingering(keyId) { return FING[keyId] || FING[FING_ALIAS[keyId]] || null; }

function spell(letterIdx, semitone) {
  // Buchstabe + Oktave so, dass die Tonhöhe = semitone (MIDI) passt
  const L = LETTERS[((letterIdx % 7) + 7) % 7];
  const oct = Math.floor(letterIdx / 7);
  const base = 12 * (oct + 1) + NAT[L];
  const alter = semitone - base;
  const acc = alter === 0 ? '' : alter === 1 ? '#' : alter === 2 ? '##' : alter === -1 ? 'b' : alter === -2 ? 'bb' : null;
  if (acc === null) throw new Error('spell ' + L + oct + ' ' + semitone);
  return L + acc + oct;
}

// Tonleiter als Liste {name, midi, finger}
function scaleNotes(key, type, startOct, octaves, hand) {
  const tonicLetterIdx = LETTERS.indexOf(key.letter) + 7 * startOct;
  const tonicMidi = 12 * (startOct + 1) + NAT[key.letter] + key.alter;
  const up = type === 'melodic' ? PATTERNS.melodic : PATTERNS[type];
  const down = type === 'melodic' ? PATTERNS.natural : PATTERNS[type];
  const f = fingering(key.id);
  const notes = [];
  const n = 7 * octaves;
  for (let i = 0; i <= n; i++) {
    const deg = i % 7, oct = Math.floor(i / 7);
    const midi = tonicMidi + 12 * oct + up[deg];
    let finger = null;
    if (f) {
      if (hand === 'rh') finger = i === n ? f.rhTop : f.rh[deg];
      else {
        if (i === n) finger = f.lhTop;
        else if (deg === 0 && oct > 0) finger = octaves > 1 ? f.lhInner : f.lh[0];
        else finger = f.lh[deg];
        if (finger === null) finger = undefined;
      }
    }
    notes.push({ name: spell(tonicLetterIdx + i, midi), midi, finger });
  }
  for (let i = n - 1; i >= 0; i--) {
    const deg = i % 7, oct = Math.floor(i / 7);
    const midi = tonicMidi + 12 * oct + down[deg];
    const upNote = notes[i];
    notes.push({ name: spell(tonicLetterIdx + i, midi), midi, finger: upNote.finger });
  }
  if (hand === 'lh' && f && octaves > 1 && f.lhInner === null) notes.forEach(x => { x.finger = undefined; });
  return notes;
}

const DUR_CODE = { q: 'q', e: 'e', s: 's' };
const PER_BAR = { q: 4, e: 8, s: 16 };

function toBars(tokens, perBar, durCode, lastDur = 'q') {
  // tokens: Arrays von Tonnamen (Akkord) oder 'r'; füllt Takte (4/4)
  const bars = [];
  let cur = [], count = 0;
  const unit = { q: 1, e: 0.5, s: 0.25 }[durCode];
  tokens.forEach((t, i) => {
    const isLast = i === tokens.length - 1;
    let d = durCode;
    let q = unit;
    if (isLast) {
      // Schluss auf eine lange Note auffüllen
      const remain = 4 - count * unit;
      const opts = [[4, 'w'], [3, 'h.'], [2, 'h'], [1.5, 'q.'], [1, 'q'], [0.75, 'e.'], [0.5, 'e'], [0.25, 's']];
      const o = opts.find(([v]) => Math.abs(v - remain) < 1e-6);
      if (o) { d = o[1]; q = o[0]; }
    }
    cur.push(`${t.text}:${d}${t.finger ? '@' + t.finger : ''}`);
    count += q / unit;
    if (Math.abs(count - perBar) < 1e-6 || isLast) {
      // Rest auffüllen
      let rem = 4 - count * unit;
      while (rem > 1e-6) {
        const o = [[2, 'h'], [1, 'q'], [0.5, 'e'], [0.25, 's']].find(([v]) => v <= rem + 1e-6);
        cur.push('r:' + o[1]); rem -= o[0];
      }
      bars.push(cur.join(' '));
      cur = []; count = 0;
    }
  });
  void lastDur;
  return bars;
}

export function scaleExercise({ key, type = 'major', hands = 'both', octaves = 1, value = 'e', tempo = 72 }) {
  const isMinor = type !== 'major';
  const keyDef = (isMinor ? KEYS_MINOR : KEYS_MAJOR).find(k => k.id === key) || KEYS_MAJOR[0];
  // Startoktave: rechte Hand ab Oktave 4 (bei hohen Grundtönen 3), linke eine Oktave tiefer
  const pc = (NAT[keyDef.letter] + keyDef.alter + 12) % 12;
  const rhOct = pc >= 7 ? 3 : 4;
  const lhOct = rhOct - 1;
  const rh = scaleNotes(keyDef, type, rhOct, octaves, 'rh');
  const lh = scaleNotes(keyDef, type, lhOct, octaves, 'lh');
  const perBar = PER_BAR[value];
  const tok = arr => arr.map(n => ({ text: n.name, finger: n.finger }));
  const staves = [];
  if (hands !== 'left') staves.push({ clef: 'G', bars: toBars(tok(rh), perBar, DUR_CODE[value]) });
  if (hands !== 'right') staves.push({ clef: 'F', bars: toBars(tok(lh), perBar, DUR_CODE[value]) });
  const typeName = { major: '', natural: ' (natürlich)', harmonic: ' (harmonisch)', melodic: ' (melodisch)' }[type];
  return {
    title: `${keyDef.de}${typeName}`,
    composer: `Tonleiter · ${octaves} Oktave${octaves > 1 ? 'n' : ''} · ${hands === 'both' ? 'beide Hände' : hands === 'right' ? 'rechte Hand' : 'linke Hand'}`,
    tempo, time: '4/4', key: keyDef.fifths, mode: isMinor ? 'minor' : 'major',
    staves, partName: 'Klavier',
  };
}

// Dreiklänge: Grundstellung – 1. Umkehrung – 2. Umkehrung – Grundstellung (Oktave), dann Kadenz I–IV–V–I
export function chordExercise({ key, kind = 'inversions', hands = 'both', tempo = 60 }) {
  const isMinor = /^[a-z]/.test(key);
  const keyDef = (isMinor ? KEYS_MINOR : KEYS_MAJOR).find(k => k.id === key) || KEYS_MAJOR[0];
  const pc = (NAT[keyDef.letter] + keyDef.alter + 12) % 12;
  const rhOct = pc >= 7 ? 3 : 4;
  const li = LETTERS.indexOf(keyDef.letter);
  const pat = isMinor ? PATTERNS.harmonic : PATTERNS.major;
  const tonic = 12 * (rhOct + 1) + NAT[keyDef.letter] + keyDef.alter;
  const deg = (d, octShift = 0) => {
    // Stufe d (0-basiert, kann >6), Oktavverschiebung
    const oct = Math.floor(d / 7) + octShift;
    const semi = tonic + 12 * oct + pat[((d % 7) + 7) % 7];
    return spell(li + 7 * rhOct + d + 7 * octShift, semi);
  };
  const rhBars = [], lhBars = [];
  const chord = (degs, shift, fing) => ({ text: degs.map(d => deg(d, shift)).join('+'), finger: fing });
  const lhChord = (degs, fing) => ({ text: degs.map(d => deg(d, -1)).join('+'), finger: fing });
  if (kind === 'inversions') {
    const rhSeq = [chord([0, 2, 4], 0, '1+3+5'), chord([2, 4, 7], 0, '1+2+5'), chord([4, 7, 9], 0, '1+3+5'), chord([7, 9, 11], 0, '1+3+5')];
    const lhSeq = [lhChord([0, 2, 4], '5+3+1'), lhChord([2, 4, 7], '5+3+1'), lhChord([4, 7, 9], '5+2+1'), lhChord([7, 9, 11], '5+3+1')];
    const back = [rhSeq[2], rhSeq[1], rhSeq[0]], lback = [lhSeq[2], lhSeq[1], lhSeq[0]];
    const all = [...rhSeq, ...back], lall = [...lhSeq, ...lback];
    for (let i = 0; i < all.length; i += 2) {
      const last = i + 1 >= all.length;
      rhBars.push(last ? `${all[i].text}:w@${all[i].finger}` : `${all[i].text}:h@${all[i].finger} ${all[i + 1].text}:h@${all[i + 1].finger}`);
      lhBars.push(last ? `${lall[i].text}:w@${lall[i].finger}` : `${lall[i].text}:h@${lall[i].finger} ${lall[i + 1].text}:h@${lall[i + 1].finger}`);
    }
  } else if (kind === 'cadence') {
    // RH enge Lage: I (Grundst.), IV (Quartsext), V (Sext), I; LH Grundtöne
    const I = [0, 2, 4], IV = [0, 3, 5], V = [-1, 1, 4];
    const rh = [chord(I, 0, '1+3+5'), chord(IV, 0, '1+2+5'), chord(V, 0, '1+2+5'), chord(I, 0, '1+3+5')];
    const lhRoots = [deg(0, -1), deg(3, -2), deg(4, -2), deg(0, -1)];
    const lhF = ['5', '5', '5', '5'];
    for (let r = 0; r < 2; r++) {
      rhBars.push(rh.map(c => `${c.text}:q@${c.finger}`).join(' '));
      lhBars.push(lhRoots.map((n, i) => `${n}:q@${lhF[i]}`).join(' '));
    }
    rhBars[rhBars.length - 1] = `${rh[0].text}:q@1+3+5 ${rh[1].text}:q@1+2+5 ${rh[2].text}:q@1+2+5 ${rh[3].text}:q@1+3+5`;
    rhBars.push(`${rh[3].text}:w@1+3+5`);
    lhBars.push(`${lhRoots[0]}:w@5`);
  } else {
    // gebrochen in Handlage: 1-3-5-3 je Viertel → Achtel
    const rhB = [deg(0), deg(2), deg(4), deg(2)];
    const lhB = [deg(0, -1), deg(2, -1), deg(4, -1), deg(2, -1)];
    const fr = ['1', '3', '5', '3'], fl = ['5', '3', '1', '3'];
    for (let r = 0; r < 3; r++) {
      rhBars.push([...rhB, ...rhB].map((n, i) => `${n}:e@${fr[i % 4]}`).join(' '));
      lhBars.push([...lhB, ...lhB].map((n, i) => `${n}:e@${fl[i % 4]}`).join(' '));
    }
    rhBars.push(`${deg(0)}+${deg(2)}+${deg(4)}:w@1+3+5`);
    lhBars.push(`${deg(0, -1)}+${deg(2, -1)}+${deg(4, -1)}:w@5+3+1`);
  }
  const staves = [];
  if (hands !== 'left') staves.push({ clef: 'G', bars: rhBars });
  if (hands !== 'right') staves.push({ clef: 'F', bars: lhBars });
  const kindName = { inversions: 'Dreiklang mit Umkehrungen', cadence: 'Kadenz I–IV–V–I', broken: 'Gebrochener Dreiklang' }[kind];
  return {
    title: `${keyDef.de}: ${kindName}`, composer: hands === 'both' ? 'beide Hände' : hands === 'right' ? 'rechte Hand' : 'linke Hand',
    tempo, time: '4/4', key: keyDef.fifths, mode: isMinor ? 'minor' : 'major', staves, partName: 'Klavier',
  };
}

// --------------------------------------------------------------- Notenlesen
export const READ_RANGES = {
  treble: { label: 'Violinschlüssel (c′–g″)', clef: 'G', lo: 60, hi: 79 },
  trebleWide: { label: 'Violinschlüssel mit Hilfslinien (g–c‴)', clef: 'G', lo: 55, hi: 84 },
  bass: { label: 'Bassschlüssel (F–c′)', clef: 'F', lo: 41, hi: 60 },
  bassWide: { label: 'Bassschlüssel mit Hilfslinien (C–e′)', clef: 'F', lo: 36, hi: 64 },
  grand: { label: 'Beide Schlüssel (F–g″)', clef: 'both', lo: 41, hi: 79 },
};
const WHITE_PC = [0, 2, 4, 5, 7, 9, 11];

export function readingExercise({ range = 'treble', accidentals = false, count = 16, weights = null, seed = Date.now() }) {
  const R = READ_RANGES[range] || READ_RANGES.treble;
  let s = seed % 2147483647 || 1;
  const rnd = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
  const pool = [];
  for (let m = R.lo; m <= R.hi; m++) {
    const pc = m % 12;
    if (!accidentals && !WHITE_PC.includes(pc)) continue;
    pool.push(m);
  }
  const pick = (prev) => {
    // Gewichte: schwierige Noten häufiger, keine direkte Wiederholung
    const ws = pool.map(m => (m === prev ? 0 : 1) * (weights?.[m] ?? 1) * (prev && Math.abs(m - prev) > 12 ? 0.5 : 1));
    let tot = ws.reduce((a, b) => a + b, 0), r = rnd() * tot;
    for (let i = 0; i < pool.length; i++) { r -= ws[i]; if (r <= 0) return pool[i]; }
    return pool[pool.length - 1];
  };
  const notes = [];
  let prev = null;
  for (let i = 0; i < count; i++) { const m = pick(prev); notes.push(m); prev = m; }
  const name = (m, preferFlat) => {
    const oct = Math.floor(m / 12) - 1, pc = m % 12;
    const sharp = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const flat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    return (preferFlat ? flat : sharp)[pc] + oct;
  };
  const toks = notes.map(m => name(m, rnd() < 0.5));
  const bars = [];
  for (let i = 0; i < toks.length; i += 4) bars.push(toks.slice(i, i + 4).map(t => t + ':q').join(' '));
  let staves;
  if (R.clef === 'both') {
    const tr = [], bs = [];
    for (let i = 0; i < toks.length; i += 4) {
      const chunk = notes.slice(i, i + 4);
      tr.push(chunk.map((m, j) => m >= 60 ? toks[i + j] + ':q' : 'r:q').join(' '));
      bs.push(chunk.map((m, j) => m < 60 ? toks[i + j] + ':q' : 'r:q').join(' '));
    }
    staves = [{ clef: 'G', bars: tr }, { clef: 'F', bars: bs }];
  } else staves = [{ clef: R.clef, bars }];
  return { title: 'Notenlesen', composer: R.label, tempo: 60, time: '4/4', key: 0, staves, partName: 'Klavier', notes };
}
