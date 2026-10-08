// app.js — Oberfläche von Klavierohr
import { AudioEngine } from './audio.js';
import { Score } from './score.js';
import { Practice, beatInfo, staffRoles } from './practice.js';
import { Keyboard } from './keyboard.js';
import { specToMusicXML } from './scoregen.js';
import { SAMPLES } from './samples.js';
import { store, loadSettings, saveSettings } from './store.js';
import { scaleExercise, chordExercise, readingExercise, KEYS_MAJOR, KEYS_MINOR, READ_RANGES } from './exercises.js';
import { EarTrainer } from './ear.js';
import { judge } from './detector.js';

// ------------------------------------------------------------------ Helfer
function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  if (attrs) for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}
const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.4-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
  loop: '<svg viewBox="0 0 24 24"><path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/></svg>',
  metro: '<svg viewBox="0 0 24 24"><path d="M9 3h6l3.5 18h-13z"/><path d="M12 17l5-10"/><path d="M8 17h8"/></svg>',
  ear: '<svg viewBox="0 0 24 24"><path d="M6 9a6 6 0 1 1 12 0c0 4-4 5-4 8a3 3 0 0 1-6 0"/><path d="M9.5 9.5a2.5 2.5 0 0 1 5 0c0 1.5-1.5 2-1.5 3.5"/></svg>',
  upload: '<svg viewBox="0 0 24 24"><path d="M12 16V4"/><path d="M7 9l5-5 5 5"/><path d="M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
  trash: '<svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0"/><path d="M12 18v3"/></svg>',
  skip: '<svg viewBox="0 0 24 24"><path d="M5 5l10 7-10 7z"/><path d="M19 5v14"/></svg>',
  zoomIn: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/></svg>',
  zoomOut: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M8 11h6"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
};
const icon = (name) => h('span', { html: ICON[name], style: { display: 'inline-grid' }, 'aria-hidden': 'true' });

const S = loadSettings();
const audio = new AudioEngine(S);
const toastEl = document.getElementById('toast');
function toast(text, kind = '', ms = 2200) {
  const d = h('div', { class: kind }, text);
  toastEl.append(d);
  while (toastEl.children.length > 2) toastEl.firstChild.remove();
  setTimeout(() => d.remove(), ms);
}
const DE = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'];
const INTL = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'B♭', 'B'];
function noteName(m) {
  const n = (S.names === 'intl' ? INTL : DE)[((m % 12) + 12) % 12];
  return n + (Math.floor(m / 12) - 1);
}
function fmtPct(x) { return Math.round(x * 100) + ' %'; }
function fmtMs(x) { return Math.round(x) + ' ms'; }
function fmtSec(x) { return x < 60 ? x.toFixed(x < 10 ? 1 : 0).replace('.', ',') + ' s' : Math.floor(x / 60) + ':' + String(Math.round(x % 60)).padStart(2, '0') + ' min'; }
const NOTE_GLYPH = { quarter: '♩', eighth: '♪', half: '𝅗𝅥', 'dotted-quarter': '♩.', sixteenth: '𝅘𝅥𝅯' };
const beatGlyph = unit => h('span', { class: 'glyph' }, NOTE_GLYPH[unit] || '♩');
function tolerance() {
  return { strict: [0.04, 0.09], normal: [0.06, 0.13], loose: [0.09, 0.18] }[S.tolerance || 'normal'];
}
function applyTheme() {
  if (S.theme === 'light' || S.theme === 'dark') document.documentElement.setAttribute('data-theme', S.theme);
  else document.documentElement.removeAttribute('data-theme');
}
applyTheme();

// ------------------------------------------------------------------ Zustand
const app = { view: 'home', tab: localStorage.getItem('klavierohr.tab') || 'pieces', practice: null };
const root = document.getElementById('app');

// Wake Lock
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener?.('release', () => { wakeLock = null; }); }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { wakeLock = null; }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && app.practice?.practice?.running) keepAwake(true);
  if (document.visibilityState === 'hidden' && app.practice?.practice?.running) { app.practice.practice.stop('hidden'); }
});

// ------------------------------------------------------------------ Bibliothek
async function pieceStats(id) {
  try {
    const ss = await store.sessionsFor(id);
    if (!ss.length) return null;
    ss.sort((a, b) => b.at - a.at);
    const best = Math.max(...ss.filter(s => s.mode === 'tempo').map(s => s.accuracy), -1);
    const bestWait = Math.max(...ss.filter(s => s.mode === 'wait').map(s => s.accuracy), -1);
    return { last: ss[0].at, n: ss.length, best: best >= 0 ? best : null, bestWait: bestWait >= 0 ? bestWait : null };
  } catch { return null; }
}

function sampleItem(s) {
  return { id: s.id, kind: 'sample', title: s.title, composer: s.composer, level: s.level, autoBeam: true, getContent: async () => specToMusicXML(s.spec) };
}
async function uploadItems() {
  const list = await store.listPieces();
  return list.sort((a, b) => (b.lastAt || b.addedAt) - (a.lastAt || a.addedAt)).map(p => ({
    id: p.id, kind: 'upload', title: p.title || p.fileName, composer: p.composer || '', fileName: p.fileName, autoBeam: false,
    measures: p.measures, getContent: async () => (await store.getPiece(p.id)).blob,
  }));
}

async function handleFiles(files) {
  for (const file of files) {
    const name = file.name || 'Noten';
    const lower = name.toLowerCase();
    if (/\.(pdf|png|jpe?g|heic)$/.test(lower)) {
      openInfo('PDF und Fotos kann Klavierohr nicht direkt lesen', [
        h('p', null, 'Die App braucht die Noten als ', h('b', null, 'MusicXML'), ' (.musicxml, .mxl oder .xml), damit sie weiß, welche Töne wann kommen.'),
        h('p', null, 'So kommst du an MusicXML:'),
        h('ul', null,
          h('li', null, h('b', null, 'MuseScore'), ': Datei öffnen → Exportieren → MusicXML (.mxl). Viele Stücke auf musescore.com lassen sich so herunterladen.'),
          h('li', null, h('b', null, 'Aus PDF/Foto'), ': mit einer Notenerkennung (OMR) umwandeln, z. B. ', h('b', null, 'Audiveris'), ' (kostenlos, Desktop) oder Scan-Apps fürs iPad, die MusicXML exportieren. Danach Fehler kurz in MuseScore prüfen.'),
          h('li', null, h('b', null, 'IMSLP'), ' und andere Archive bieten manche Stücke direkt als MusicXML an.')),
      ]);
      continue;
    }
    if (/\.(mid|midi)$/.test(lower)) {
      openInfo('MIDI-Dateien werden noch nicht unterstützt', [h('p', null, 'Öffne die MIDI-Datei in MuseScore und exportiere sie als MusicXML (.mxl) – dann kannst du sie hier hochladen.')]);
      continue;
    }
    try {
      const head = new Uint8Array(await file.slice(0, 600).arrayBuffer());
      const isZip = head[0] === 0x50 && head[1] === 0x4b;
      const txt = new TextDecoder().decode(head);
      if (!isZip && !/score-partwise|score-timewise|<\?xml/.test(txt)) throw new Error('Keine MusicXML-Datei');
      if (!isZip && /score-timewise/.test(txt)) throw new Error('Dieses MusicXML-Format (timewise) wird nicht unterstützt. Bitte in MuseScore neu exportieren.');
      const id = 'up-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const rec = { id, fileName: name, title: name.replace(/\.(musicxml|mxl|xml)$/i, ''), composer: '', blob: file, addedAt: Date.now() };
      await store.putPiece(rec);
      store.persist();
      toast('„' + rec.title + '“ hinzugefügt', 'good');
      await openPractice({ id, kind: 'upload', title: rec.title, composer: '', fileName: name, autoBeam: false, getContent: async () => (await store.getPiece(id)).blob }, { fresh: true });
      return;
    } catch (e) {
      toast(e.message || 'Datei konnte nicht gelesen werden', 'bad', 4000);
    }
  }
}

// ------------------------------------------------------------------ Startseite
function renderHome() {
  if (app.view === 'practice') { app.practice?.ro?.disconnect(); audio.stopMic(); }
  app.view = 'home';
  root.innerHTML = '';
  const fileInput = h('input', { type: 'file', multiple: true, hidden: true, onchange: e => { handleFiles([...e.target.files]); e.target.value = ''; } });
  const tabsDef = [['pieces', 'Stücke'], ['tech', 'Tonleitern & Akkorde'], ['read', 'Noten lesen'], ['ear', 'Gehör']];
  const tabBody = h('div', { class: 'tab-body' });
  const tabs = h('nav', { class: 'tabs', role: 'tablist' }, ...tabsDef.map(([id, label]) =>
    h('button', { role: 'tab', class: app.tab === id ? 'on' : '', 'aria-selected': app.tab === id, onclick: () => { app.tab = id; localStorage.setItem('klavierohr.tab', id); renderHome(); } }, label)));
  const home = h('section', { class: 'view home' },
    h('div', { class: 'home-inner' },
      h('header', { class: 'masthead' },
        h('div', null,
          h('div', { class: 'wordmark' }, 'Klavierohr', h('span', { class: 'staff' })),
          h('div', { class: 'tagline' }, 'Noten aufs Pult, iPad hört zu – und hakt ab, was du spielst.')),
        h('div', { class: 'masthead-right' },
          h('button', { class: 'btn small ghost', onclick: openHelp }, 'So geht’s'),
          h('button', { class: 'icon-btn', title: 'Einstellungen', 'aria-label': 'Einstellungen', onclick: openSettings, html: ICON.gear }))),
      tabs, tabBody, fileInput));
  root.append(home);
  if (app.tab === 'pieces') renderPiecesTab(tabBody, fileInput);
  else if (app.tab === 'tech') renderTechTab(tabBody);
  else if (app.tab === 'read') renderReadTab(tabBody);
  else renderEarTab(tabBody);
}

async function renderPiecesTab(el, fileInput) {
  const drop = h('div', { class: 'upload' },
    h('div', { class: 'grow' },
      h('h2', null, 'Noten hochladen'),
      h('p', null, 'MusicXML-Datei (.musicxml, .mxl, .xml) – zum Beispiel aus MuseScore exportiert. Die App zeigt die Noten, hört dein Klavier über das Mikrofon und prüft Töne, Rhythmus, Tempo und Notenlängen.')),
    h('button', { class: 'btn primary', onclick: () => fileInput.click() }, icon('upload'), 'Datei wählen'));
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('drag'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('drag'));
  drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('drag'); handleFiles([...e.dataTransfer.files]); });
  const mine = h('div', { class: 'pieces' });
  const samples = h('div', { class: 'pieces' });
  el.append(drop, h('div', { class: 'section-title' }, 'Deine Stücke'), mine, h('div', { class: 'section-title' }, 'Zum Ausprobieren'), samples);
  const ups = await uploadItems();
  if (!ups.length) mine.append(h('p', { class: 'muted' }, 'Noch keine eigenen Noten. Lade eine Datei hoch oder starte mit einem Beispiel.'));
  for (const it of ups) mine.append(await pieceRow(it, true));
  for (const s of SAMPLES) samples.append(await pieceRow(sampleItem(s), false));
}

async function pieceRow(it, deletable) {
  const st = await pieceStats(it.id);
  const meta = [];
  if (it.composer) meta.push(h('span', null, it.composer));
  if (it.level) meta.push(h('span', { class: 'tag' }, it.level));
  if (st) meta.push(h('span', null, 'zuletzt ' + new Date(st.last).toLocaleDateString('de-CH', { day: 'numeric', month: 'short' })));
  const best = st?.best !== null && st?.best !== undefined ? h('span', { class: 'best', title: 'Bestes Ergebnis im Tempo-Modus' }, fmtPct(st.best)) : null;
  return h('div', { class: 'piece' },
    h('div', null, h('div', { class: 't' }, it.title), h('div', { class: 'meta' }, ...meta)),
    h('div', { class: 'actions' }, best,
      deletable ? h('button', {
        class: 'icon-btn', 'aria-label': 'Löschen', title: 'Löschen', html: ICON.trash, onclick: async (e) => {
          const btn = e.currentTarget;
          if (btn.dataset.confirm !== '1') { btn.dataset.confirm = '1'; btn.style.color = 'var(--bad)'; toast('Nochmal tippen zum Löschen'); setTimeout(() => { btn.dataset.confirm = ''; btn.style.color = ''; }, 2500); return; }
          await store.deletePiece(it.id); renderHome();
        },
      }) : null,
      h('button', { class: 'btn primary', onclick: () => openPractice(it) }, 'Üben')));
}

// ------------------------------------------------------------------ Technik
function renderTechTab(el) {
  const st = JSON.parse(localStorage.getItem('klavierohr.tech') || '{}');
  const cfg = { what: 'scale', key: 'C', type: 'major', hands: 'right', octaves: 1, value: 'e', chord: 'inversions', ...st };
  const save = () => localStorage.setItem('klavierohr.tech', JSON.stringify(cfg));
  const body = h('div', { class: 'card' });
  const draw = () => {
    body.innerHTML = '';
    const isMinor = cfg.type !== 'major';
    const keys = cfg.what === 'scale' ? (isMinor ? KEYS_MINOR : KEYS_MAJOR) : [...KEYS_MAJOR, ...KEYS_MINOR];
    if (!keys.find(k => k.id === cfg.key)) cfg.key = keys[0].id;
    const seg = (opts, val, set) => h('div', { class: 'seg' }, ...opts.map(([v, l]) => h('button', { class: val === v ? 'on' : '', onclick: () => { set(v); save(); draw(); } }, l)));
    body.append(
      h('h2', null, cfg.what === 'scale' ? 'Tonleitern' : 'Dreiklänge'),
      seg([['scale', 'Tonleiter'], ['chord', 'Akkorde']], cfg.what, v => cfg.what = v),
      cfg.what === 'scale' ? seg([['major', 'Dur'], ['natural', 'Moll natürlich'], ['harmonic', 'Moll harmonisch'], ['melodic', 'Moll melodisch']], cfg.type, v => cfg.type = v)
        : seg([['inversions', 'Umkehrungen'], ['cadence', 'Kadenz I–IV–V–I'], ['broken', 'Gebrochen']], cfg.chord, v => cfg.chord = v),
      h('div', { class: 'field' }, h('span', null, 'Tonart'),
        h('div', { class: 'keys-circle' }, ...keys.map(k => h('button', { class: 'chip' + (cfg.key === k.id ? ' on' : ''), onclick: () => { cfg.key = k.id; save(); draw(); } }, k.de)))),
      h('div', { class: 'grid-form' },
        h('div', { class: 'field' }, h('span', null, 'Hände'), seg([['right', 'Rechts'], ['left', 'Links'], ['both', 'Beide']], cfg.hands, v => cfg.hands = v)),
        cfg.what === 'scale' ? h('div', { class: 'field' }, h('span', null, 'Umfang'), seg([[1, '1 Oktave'], [2, '2 Oktaven']], cfg.octaves, v => cfg.octaves = v)) : null,
        cfg.what === 'scale' ? h('div', { class: 'field' }, h('span', null, 'Notenwert'), seg([['q', 'Viertel'], ['e', 'Achtel'], ['s', 'Sechzehntel']], cfg.value, v => cfg.value = v)) : null),
      h('p', { class: 'help' }, cfg.what === 'scale'
        ? 'Mit Standard-Fingersatz (wo er eindeutig ist). Tipp: erst im Modus „Warten“ die Töne und Finger sichern, dann „Im Tempo“ mit Metronom gleichmäßig werden.'
        : 'Akkorde werden als Ganzes geprüft – alle Töne müssen klingen. Fingersätze stehen über bzw. unter den Noten.'),
      h('div', null, h('button', {
        class: 'btn primary', onclick: () => {
          const spec = cfg.what === 'scale' ? scaleExercise({ key: cfg.key, type: cfg.type, hands: cfg.hands, octaves: cfg.octaves, value: cfg.value, tempo: 60 })
            : chordExercise({ key: cfg.key, kind: cfg.chord, hands: cfg.hands, tempo: 60 });
          const id = 'tech-' + [cfg.what, cfg.key, cfg.what === 'scale' ? cfg.type : cfg.chord, cfg.hands, cfg.octaves, cfg.value].join('-');
          openPractice({ id, kind: 'exercise', title: spec.title, composer: spec.composer, autoBeam: true, getContent: async () => specToMusicXML(spec) });
        },
      }, 'Üben')));
  };
  draw();
  el.append(body);
}

// ------------------------------------------------------------------ Notenlesen
async function readStats() { return (await store.getKV('readStats', {})) || {}; }
async function renderReadTab(el) {
  const cfg = { range: 'treble', accidentals: false, ...JSON.parse(localStorage.getItem('klavierohr.read') || '{}') };
  const save = () => localStorage.setItem('klavierohr.read', JSON.stringify(cfg));
  const card = h('div', { class: 'card' });
  const stats = await readStats();
  const draw = () => {
    card.innerHTML = '';
    const R = READ_RANGES[cfg.range];
    const hard = Object.entries(stats).filter(([m, s]) => +m >= R.lo && +m <= R.hi && s.n >= 2)
      .map(([m, s]) => ({ m: +m, score: (s.err / s.n) * 2 + Math.min(3, s.time / s.n / 2) }))
      .sort((a, b) => b.score - a.score).slice(0, 5);
    card.append(...[
      h('h2', null, 'Noten lesen'),
      h('p', { class: 'help' }, '16 Noten erscheinen nacheinander – spiel jede auf dem Klavier. Die App merkt sich, welche Noten dir schwerfallen, und fragt sie öfter ab.'),
      h('div', { class: 'field' }, h('span', null, 'Bereich'),
        h('div', { class: 'chips' }, ...Object.entries(READ_RANGES).map(([id, r]) => h('button', { class: 'chip' + (cfg.range === id ? ' on' : ''), onclick: () => { cfg.range = id; save(); draw(); } }, r.label)))),
      h('div', { class: 'field' }, h('span', null, 'Vorzeichen'),
        h('div', { class: 'seg' }, ...[[false, 'Nur Stammtöne'], [true, 'Mit ♯ und ♭']].map(([v, l]) => h('button', { class: cfg.accidentals === v ? 'on' : '', onclick: () => { cfg.accidentals = v; save(); draw(); } }, l)))),
      hard.length ? h('div', { class: 'field' }, h('span', null, 'Deine schwierigsten Noten'), h('div', { class: 'chips' }, ...hard.map(x => h('span', { class: 'chip' }, noteName(x.m))))) : null,
      h('div', null, h('button', {
        class: 'btn primary', onclick: () => {
          const weights = {};
          for (const [m, s] of Object.entries(stats)) weights[m] = 1 + (s.err / Math.max(1, s.n)) * 3 + Math.min(2, (s.time / Math.max(1, s.n)) / 3);
          const spec = readingExercise({ range: cfg.range, accidentals: cfg.accidentals, count: 16, weights, seed: Date.now() });
          openPractice({ id: 'read-' + cfg.range + (cfg.accidentals ? '-acc' : ''), kind: 'reading', title: 'Notenlesen', composer: READ_RANGES[cfg.range].label, autoBeam: false, getContent: async () => specToMusicXML(spec) }, { forceMode: 'wait' });
        },
      }, 'Los geht’s'))].filter(Boolean));
  };
  draw();
  el.append(card);
}

// ------------------------------------------------------------------ Gehör
function renderEarTab(el) {
  const card = h('div', { class: 'card' });
  card.append(h('h2', null, 'Gehörbildung'));
  const body = h('div', { style: { display: 'grid', gap: '16px' } });
  card.append(body);
  el.append(card);
  app.ear = new EarTrainer({
    audio, el: body, h, toast, noteName,
    onStats: async (mode, right) => {
      const s = (await store.getKV('earStats', {})) || {};
      const k = s[mode] || { right: 0, total: 0 };
      k.total++; if (right) k.right++;
      s[mode] = k;
      store.setKV('earStats', s);
    },
  });
}

// ------------------------------------------------------------------ Üben
function cfgKey(id) { return 'klavierohr.cfg.' + id; }

async function openPractice(item, opts = {}) {
  app.ear?.stopEcho?.();
  app.view = 'practice';
  root.innerHTML = '';
  const P = app.practice = { item, cfg: null, running: false };
  const scoreEl = h('div', { id: 'score' });
  const marks = h('div', { class: 'marks' });
  const paper = h('div', { class: 'paper' }, scoreEl, marks);
  const countin = h('div', { class: 'countin', hidden: true });
  const scoreWrap = h('div', { class: 'score-wrap' }, paper, countin);
  const titleEl = h('div', { class: 'ptitle' }, h('div', { class: 't' }, item.title), h('div', { class: 's' }, item.composer || ''));
  const controls = h('div', { class: 'controls' });
  const bar = h('div', { class: 'pbar' },
    h('div', { class: 'pbar-top' },
      h('button', { class: 'icon-btn', 'aria-label': 'Zurück', title: 'Zurück', html: ICON.back, onclick: () => { stopRun(); renderHome(); } }),
      titleEl,
      h('button', { class: 'icon-btn', 'aria-label': 'Kleiner', title: 'Noten kleiner', html: ICON.zoomOut, onclick: () => zoom(-0.1) }),
      h('button', { class: 'icon-btn', 'aria-label': 'Größer', title: 'Noten größer', html: ICON.zoomIn, onclick: () => zoom(0.1) }),
      h('button', { class: 'icon-btn', 'aria-label': 'Einstellungen', title: 'Einstellungen', html: ICON.gear, onclick: openSettings })),
    controls);
  const goBtn = h('button', { class: 'go', 'aria-label': 'Start', html: ICON.play, onclick: () => toggleRun() });
  const statusBig = h('div', { class: 'big' }, 'Noten werden geladen …');
  const statusSmall = h('div', { class: 'small' }, '');
  const meterBar = h('i');
  const skipBtn = h('button', { class: 'btn small', hidden: true, onclick: () => P.practice?.skip() }, icon('skip'), 'Weiter');
  const listenBtn = h('button', { class: 'btn small', onclick: () => playDemo() }, icon('ear'), 'Anhören');
  const kbEl = h('div', { class: 'kb' });
  const dock = h('div', { class: 'dock' },
    h('div', { class: 'dock-row' }, goBtn, h('div', { class: 'status' }, statusBig, statusSmall), skipBtn, listenBtn,
      h('div', { class: 'meter-wrap' }, h('div', { class: 'meter', title: 'Mikrofonpegel' }, meterBar), h('span', null, 'Mikrofon'))),
    kbEl);
  root.append(h('section', { class: 'view practice' }, bar, scoreWrap, dock));
  Object.assign(P, { scoreEl, marks, countin, scoreWrap, controls, goBtn, statusBig, statusSmall, meterBar, skipBtn, listenBtn, kbEl });

  // auf schmalen Bildschirmen Noten automatisch verkleinern
  const autoZoom = () => Math.min(1, Math.max(0.55, (scoreWrap.clientWidth - 40) / 760));
  const score = new Score(scoreEl, { scrollEl: scoreWrap, zoom: (S.zoom || 1) * autoZoom() });
  P.autoZoom = autoZoom;
  P.score = score;
  try {
    const content = await item.getContent();
    await score.load(content, { title: item.title, autoBeam: item.autoBeam });
  } catch (e) {
    console.error(e);
    statusBig.textContent = 'Diese Noten konnten nicht geladen werden.';
    statusSmall.textContent = (e && e.message) ? e.message.slice(0, 160) : '';
    return;
  }
  if (!score.steps.length) { statusBig.textContent = 'In dieser Datei wurden keine Noten gefunden.'; return; }
  // Titel aus der Datei übernehmen (hochgeladene Stücke)
  if (item.kind === 'upload') {
    let t = score.sheet.TitleString?.trim(), c = score.sheet.ComposerString?.trim();
    if (t === 'Untitled Score' || t === 'Untitled') t = '';
    const rec = await store.getPiece(item.id);
    if (rec) {
      if (t && (opts.fresh || !rec.titleFromFile)) { rec.title = t; rec.titleFromFile = true; }
      if (c) rec.composer = c;
      rec.measures = score.measures.length; rec.lastAt = Date.now();
      await store.putPiece(rec);
      item.title = rec.title; item.composer = rec.composer;
      titleEl.firstChild.textContent = rec.title; titleEl.lastChild.textContent = rec.composer || '';
    }
  }
  P.keyboard = new Keyboard(kbEl);
  P.keyboard.fitTo(score.range[0], score.range[1]);
  P.roles = staffRoles(score);
  // Konfiguration
  const m0 = score.measures[0];
  const bi = beatInfo(m0.implicit && score.measures[1] ? score.measures[1] : m0);
  const origBeat = score.tempo ? Math.round(score.tempo / bi.beatQ) : Math.round(72 / bi.beatQ);
  P.origBeat = origBeat;
  P.bi = bi;
  const saved = JSON.parse(localStorage.getItem(cfgKey(item.id)) || 'null');
  P.cfg = {
    mode: 'wait', hands: P.roles.twoHands ? 'both' : 'right', beatBpm: Math.max(30, Math.round(origBeat * (item.kind === 'exercise' || item.kind === 'reading' ? 1 : 0.8))),
    from: 0, to: score.measures.length - 1, loop: false, metronome: true,
    ...(saved || {}),
  };
  if (P.cfg.to >= score.measures.length) P.cfg.to = score.measures.length - 1;
  if (P.cfg.from > P.cfg.to) P.cfg.from = 0;
  if (opts.forceMode) P.cfg.mode = opts.forceMode;
  if (item.kind === 'reading') { P.cfg.from = 0; P.cfg.to = score.measures.length - 1; }
  renderControls();
  score.cursorToStep(firstStepInRange(), false);
  setIdleStatus();
  // Antippen von Noten → Detail
  scoreEl.addEventListener('click', onScoreTap);
  P.ro = new ResizeObserver(() => { clearTimeout(P.rt); P.rt = setTimeout(() => { score.maybeResize(); placeMarks(); }, 250); });
  P.ro.observe(scoreWrap);
  if (opts.fresh) toast('Tipp: Erst mit „Warten“ die Töne sichern, dann „Im Tempo“.', '', 3500);
}

function firstStepInRange() {
  const P = app.practice;
  const st = P.score.steps.find(s => s.measureIdx >= P.cfg.from);
  return st ? st.i : 0;
}

function saveCfg() {
  const P = app.practice;
  if (!P) return;
  const { mode, hands, beatBpm, from, to, loop, metronome } = P.cfg;
  localStorage.setItem(cfgKey(P.item.id), JSON.stringify({ mode, hands, beatBpm, from, to, loop, metronome }));
}

function measureLabel(idx) {
  const m = app.practice.score.measures[idx];
  if (!m) return '';
  return m.implicit && m.no === 0 ? 'Auftakt' : String(m.no);
}

function renderControls() {
  const P = app.practice, c = P.cfg, el = P.controls;
  el.innerHTML = '';
  const seg = (opts, val, set, label) => h('div', { class: 'seg', role: 'group', 'aria-label': label }, ...opts.map(([v, l]) => h('button', {
    class: val === v ? 'on' : '', 'aria-pressed': val === v, onclick: () => { if (P.practice?.running) return toast('Erst stoppen, dann umstellen'); set(v); saveCfg(); renderControls(); setIdleStatus(); },
  }, l)));
  el.append(seg([['wait', 'Warten'], ['tempo', 'Im Tempo']], c.mode, v => c.mode = v, 'Modus'));
  if (P.roles.twoHands) el.append(seg([['right', 'Rechts'], ['left', 'Links'], ['both', 'Beide']], c.hands, v => c.hands = v, 'Hände'));
  const pct = Math.round(c.beatBpm / P.origBeat * 100);
  el.append(h('div', { class: 'tempo', role: 'group', 'aria-label': 'Tempo' },
    h('button', { 'aria-label': 'Langsamer', onclick: () => setTempo(c.beatBpm - (c.beatBpm > 100 ? 4 : 2)) }, '−'),
    h('div', { class: 'val' }, beatGlyph(P.bi.unit), ` = ${c.beatBpm}`, h('small', null, `${pct} %`)),
    h('button', { 'aria-label': 'Schneller', onclick: () => setTempo(c.beatBpm + (c.beatBpm >= 100 ? 4 : 2)) }, '+')));
  const full = c.from === 0 && c.to === P.score.measures.length - 1;
  el.append(h('button', { class: 'toggle range-btn', onclick: openRange, title: 'Takte auswählen' }, full ? 'Ganzes Stück' : `Takt ${measureLabel(c.from)}–${measureLabel(c.to)}`));
  el.append(h('button', { class: 'toggle', 'aria-pressed': c.loop, onclick: () => { c.loop = !c.loop; saveCfg(); renderControls(); }, html: ICON.loop + '<span>Schleife</span>' }));
  if (c.mode === 'tempo') el.append(h('button', { class: 'toggle', 'aria-pressed': c.metronome, onclick: () => { c.metronome = !c.metronome; saveCfg(); renderControls(); }, html: ICON.metro + '<span>Metronom</span>' }));
  P.skipBtn.hidden = c.mode !== 'wait';
}

function setTempo(v) {
  const P = app.practice;
  if (P.practice?.running) return toast('Erst stoppen, dann Tempo ändern');
  P.cfg.beatBpm = Math.max(20, Math.min(240, Math.round(v)));
  saveCfg(); renderControls();
}

function zoom(d) {
  const P = app.practice;
  S.zoom = Math.max(0.6, Math.min(1.8, (S.zoom || 1) + d));
  saveSettings(S);
  P.score.setZoom(S.zoom * (P.autoZoom ? P.autoZoom() : 1));
  placeMarks();
}

function setIdleStatus() {
  const P = app.practice;
  if (!P?.statusBig) return;
  const c = P.cfg;
  P.statusBig.textContent = c.mode === 'wait' ? 'Bereit: Warte-Modus' : 'Bereit: Im Tempo';
  P.statusSmall.textContent = c.mode === 'wait'
    ? 'Die App wartet, bis jeder Ton stimmt – Tempo egal.'
    : `Nach ${P.bi.beatsPerBar <= 2 ? 2 * P.bi.beatsPerBar : P.bi.beatsPerBar} Schlägen Einzählen spielst du im Takt mit. Danach gibt es die Auswertung.`;
}

function openRange() {
  const P = app.practice, c = P.cfg, ms = P.score.measures;
  let from = c.from, to = c.to;
  const opt = (sel) => ms.map((m, i) => h('option', { value: i, selected: i === sel ? true : null }, measureLabel(i)));
  const fromSel = h('select', { onchange: e => { from = +e.target.value; if (from > to) { to = from; toSel.value = to; } } }, ...opt(from));
  const toSel = h('select', { onchange: e => { to = +e.target.value; if (to < from) { from = to; fromSel.value = from; } } }, ...opt(to));
  openSheet('Takte auswählen', [
    h('div', { class: 'grid-form' }, h('label', { class: 'field' }, h('span', null, 'Von Takt'), fromSel), h('label', { class: 'field' }, h('span', null, 'Bis Takt'), toSel)),
    h('p', { class: 'help' }, 'Kurze Abschnitte (2–4 Takte) mit „Schleife“ sind der schnellste Weg durch schwierige Stellen.'),
  ], [
    h('button', { class: 'btn', onclick: () => { c.from = 0; c.to = ms.length - 1; done(); } }, 'Ganzes Stück'),
    h('button', { class: 'btn primary', onclick: () => { c.from = from; c.to = to; done(); } }, 'Übernehmen'),
  ]);
  function done() { saveCfg(); renderControls(); closeSheet(); P.score.cursorToStep(firstStepInRange()); }
}

async function toggleRun() {
  const P = app.practice;
  if (!P?.score?.steps?.length) return;
  if (P.practice?.running) { stopRun(); return; }
  if (P.demo) { stopDemo(); }
  // AudioContext im Tipp-Ereignis anlegen (iOS)
  const ensure = audio.ensure();
  await ensure;
  clearMarks();
  const pr = new Practice({ score: P.score, audio, settings: { ...S, tolOk: tolerance()[0], tolWarn: tolerance()[1] }, emit: (t, d) => onPracticeEvent(t, d) });
  pr.configure({ ...P.cfg });
  if (!pr.seq.length) { toast('In diesem Abschnitt gibt es für die gewählte Hand nichts zu spielen.', 'bad'); return; }
  P.practice = pr;
  P.expectedNow = [];
  try {
    P.goBtn.classList.add('stop'); P.goBtn.innerHTML = ICON.stop; P.goBtn.setAttribute('aria-label', 'Stopp');
    P.statusBig.textContent = 'Mikrofon wird gestartet …';
    await pr.start();
    attachMeter();
    keepAwake(true);
    if (P.cfg.mode === 'tempo') { P.statusBig.textContent = 'Zähl mit …'; P.statusSmall.textContent = ''; P.statusSmall.append(beatGlyph(P.bi.unit), ` = ${P.cfg.beatBpm}`); }
  } catch (e) {
    console.error(e);
    resetGo();
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    P.statusBig.textContent = denied ? 'Kein Zugriff aufs Mikrofon' : 'Mikrofon nicht verfügbar';
    P.statusSmall.textContent = denied ? 'In Safari: „aA“ in der Adressleiste → Website-Einstellungen → Mikrofon: Erlauben. Dann nochmal starten.' : (e.message || String(e));
  }
}

function resetGo() {
  const P = app.practice;
  if (!P) return;
  P.goBtn.classList.remove('stop'); P.goBtn.innerHTML = ICON.play; P.goBtn.setAttribute('aria-label', 'Start');
}

function stopRun() {
  const P = app.practice;
  if (!P) return;
  if (P.demo) stopDemo();
  if (P.practice?.running) P.practice.stop('user');
}

function attachMeter() {
  const P = app.practice;
  if (!audio.detector || P.meterOff) return;
  P.meterOff = audio.detector.on('level', e => {
    const w = Math.max(0, Math.min(1, (e.db + 62) / 50));
    if (P.meterBar) P.meterBar.style.width = (w * 100).toFixed(0) + '%';
  });
}

function onPracticeEvent(type, d) {
  const P = app.practice;
  if (!P) return;
  const kb = P.keyboard;
  switch (type) {
    case 'expect': {
      P.expectedNow = d.midis || [];
      kb.setExpected(P.expectedNow);
      if (P.cfg.mode === 'wait' && d.midis?.length) {
        P.statusBig.innerHTML = '';
        P.statusBig.append('Spiele: ', h('span', { class: 'n' }, d.midis.slice().sort((a, b) => b - a).map(noteName).join(' · ')));
        P.statusSmall.textContent = `Note ${Math.min(d.k + 1, d.total)} von ${d.total}`;
      } else if (P.cfg.mode === 'tempo' && d.step) {
        const m = P.score.measures[d.step.measureIdx];
        P.statusSmall.textContent = `Takt ${m.implicit && m.no === 0 ? 'Auftakt' : m.no}`;
      }
      break;
    }
    case 'hit': kb.flash(d.midi, 'hit'); if (P.cfg.mode === 'tempo') tempoLive(); break;
    case 'wrong': {
      kb.flash(d.midi, 'bad', 700);
      if (P.cfg.mode === 'wait') {
        const exp = (d.expected || []).map(noteName).join(' · ');
        toast(`${noteName(d.midi)} ist falsch${exp ? ' – gesucht: ' + exp : ''}`, 'bad', 1800);
      }
      break;
    }
    case 'hint': toast(d.text, '', 1800); break;
    case 'latencyHint': toast(`Du liegst gleichmäßig ${Math.round(Math.abs(d.offset) * 1000)} ms ${d.offset > 0 ? 'hinter' : 'vor'} dem Klick – falls das an der Technik liegt: Einstellungen → Latenz messen.`, '', 5000); break;
    case 'count': {
      if (d.n > 0) { P.countin.hidden = false; P.countin.innerHTML = ''; P.countin.append(h('span', null, d.n)); P.statusBig.textContent = 'Zähl mit … ' + d.n; }
      else { P.countin.hidden = true; P.statusBig.textContent = 'Los!'; }
      break;
    }
    case 'progress': break;
    case 'loop': {
      if (d.stats) toast(`Durchlauf ${d.iteration}: ${fmtPct(d.stats.acc)} getroffen`, d.stats.acc >= 0.9 ? 'good' : '', 2200);
      else toast(`Durchlauf ${d.iteration} geschafft – nochmal!`, 'good');
      break;
    }
    case 'stopped': {
      keepAwake(false);
      P.countin.hidden = true;
      resetGo();
      kb.setExpected([]);
      if (P.meterOff) { P.meterOff(); P.meterOff = null; }
      P.meterBar.style.width = '0';
      const s = d.summary;
      P.lastSummary = s;
      setIdleStatus();
      if (d.reason === 'hidden') { toast('Pausiert, weil die App im Hintergrund war.'); }
      const meaningful = s && (s.mode === 'wait' ? s.steps > 0 : s.req > 0);
      if (meaningful) {
        recordSession(s);
        if (s.mode === 'tempo') placeMarks(s);
        showResults(s);
      }
      break;
    }
  }
}

function tempoLive() {
  const P = app.practice, pr = P.practice;
  if (!pr || !pr.hits) return;
  const st = pr.iterationStats();
  const done = [...pr.finalized].filter(k => k.startsWith(pr.iter + ':')).length;
  if (done > 2) P.statusBig.textContent = `${fmtPct(st.hit / Math.max(1, Math.min(st.req, st.hit + countMissed(pr))))} getroffen`;
}
function countMissed(pr) {
  let n = 0;
  for (const st of pr.seq) {
    if (!pr.finalized.has(pr.iter + ':' + st.i)) continue;
    for (const nt of pr.required(st)) if (!pr.hits.has(pr.iter + ':' + nt.key)) n++;
  }
  return n;
}

async function recordSession(s) {
  const P = app.practice;
  const rec = {
    pieceId: P.item.id, at: Date.now(), mode: s.mode, accuracy: s.accuracy, hands: P.cfg.hands, beatBpm: P.cfg.beatBpm,
    from: P.cfg.from, to: P.cfg.to, complete: s.complete,
    wrong: s.mode === 'tempo' ? s.wrong : s.errors, sd: s.sdDev ?? null, playedBpmQ: s.playedBpmQ ?? null,
  };
  try { await store.addSession(rec); } catch { }
  if (P.item.kind === 'reading' && s.mode === 'wait') {
    const stats = await readStats();
    for (const r of P.practice.results.steps) {
      const st = P.score.steps[r.step];
      for (const nt of st.notes) {
        const k = stats[nt.midi] || { n: 0, err: 0, time: 0 };
        k.n++; k.err += r.errors ? 1 : 0; k.time += Math.min(10, r.time);
        stats[nt.midi] = k;
      }
    }
    store.setKV('readStats', stats);
  }
}

// Markierungen (früh/spät/verpasst/zu kurz) über den Noten
function clearMarks() { const P = app.practice; if (P?.marks) P.marks.innerHTML = ''; P && (P.markData = null); }
function placeMarks(s) {
  const P = app.practice;
  if (!P?.marks) return;
  if (s) P.markData = s;
  s = P.markData;
  P.marks.innerHTML = '';
  if (!s || s.mode !== 'tempo') return;
  const tolOk = tolerance()[0];
  const shortKeys = new Set(s.short.map(n => n.key));
  for (const n of s.notes) {
    const box = P.score.noteBox(n.nt);
    if (!box) continue;
    let cls = null, txt = null;
    if (!n.hit) { cls = 'miss'; txt = '✕'; }
    else if (n.dev < -tolOk) { cls = 'early'; txt = '‹' + Math.round(-n.dev * 1000); }
    else if (n.dev > tolOk) { cls = 'late'; txt = Math.round(n.dev * 1000) + '›'; }
    if (cls) P.marks.append(h('span', { class: 'mark ' + cls, style: { left: (box.x + box.w / 2) + 'px', top: (box.y - 4) + 'px' } }, txt));
    if (shortKeys.has(n.key)) P.marks.append(h('span', { class: 'mark short', style: { left: (box.x + box.w / 2) + 'px', top: (box.y + box.h) + 'px' } }, 'kurz'));
  }
}

function onScoreTap(e) {
  const P = app.practice;
  const s = P.markData;
  if (!s || s.mode !== 'tempo' || P.practice?.running) return;
  const cr = P.scoreEl.getBoundingClientRect();
  const x = e.clientX - cr.left, y = e.clientY - cr.top;
  let best = null, bd = 1e9;
  for (const n of s.notes) {
    const b = P.score.noteBox(n.nt);
    if (!b) continue;
    const d = Math.hypot(b.x + b.w / 2 - x, b.y + b.h / 2 - y);
    if (d < bd) { bd = d; best = n; }
  }
  if (!best || bd > 34) return;
  const m = P.score.measures[best.measureIdx];
  let t = `${noteName(best.midi)} · Takt ${m.implicit && m.no === 0 ? 'Auftakt' : m.no}: `;
  if (!best.hit) t += 'nicht gehört';
  else t += Math.abs(best.dev) * 1000 < 8 ? 'genau im Takt' : `${Math.round(Math.abs(best.dev) * 1000)} ms ${best.dev < 0 ? 'zu früh' : 'zu spät'}`;
  if (best.dur !== null && best.expDur >= 0.42) t += ` · gehalten ${best.dur.toFixed(1).replace('.', ',')} s von ${best.expDur.toFixed(1).replace('.', ',')} s`;
  toast(t, '', 3200);
}

// ------------------------------------------------------------------ Anhören (Vorspielen)
async function playDemo() {
  const P = app.practice;
  if (!P?.score) return;
  if (P.demo) { stopDemo(); return; }
  if (P.practice?.running) return toast('Erst stoppen');
  await audio.ensure();
  P.listenBtn.disabled = true;
  P.statusBig.textContent = 'Klavierklang wird geladen …';
  await audio.loadPiano();
  P.listenBtn.disabled = false;
  const pr = new Practice({ score: P.score, audio, settings: S });
  pr.configure({ ...P.cfg, hands: 'both' });
  const bi = beatInfo(P.score.measures[P.cfg.from]);
  const spq = 60 / (P.cfg.beatBpm * bi.beatQ);
  const t0 = audio.now() + 0.25;
  const q0 = P.score.measures[P.cfg.from].t0;
  const seq = pr.seq;
  for (const st of seq) for (const nt of st.notes) audio.playNote(nt.midi, t0 + (st.t - q0) * spq, Math.max(0.12, nt.durQ * spq * 0.95), 0.62);
  P.demo = { t0, spq, q0, seq, k: -1 };
  P.listenBtn.innerHTML = ''; P.listenBtn.append(icon('stop'), 'Stopp');
  P.statusBig.textContent = 'Hör zu …';
  P.statusSmall.textContent = 'So klingt der Abschnitt im eingestellten Tempo.';
  const step = () => {
    if (!P.demo) return;
    const now = audio.now() - audio.outputLatency;
    let k = -1;
    for (let i = 0; i < seq.length; i++) if (t0 + (seq[i].t - q0) * spq <= now + 0.02) k = i; else break;
    if (k !== P.demo.k && k >= 0) { P.demo.k = k; P.score.cursorToStep(seq[k].i); P.keyboard.setExpected(seq[k].notes.map(n => n.midi)); }
    const last = seq[seq.length - 1];
    const end = t0 + (last.t - q0 + Math.max(...last.notes.map(n => n.durQ))) * spq;
    if (now > end + 0.2) { stopDemo(); return; }
    P.demo.raf = requestAnimationFrame(step);
  };
  P.demo.raf = requestAnimationFrame(step);
}
function stopDemo() {
  const P = app.practice;
  if (!P?.demo) return;
  cancelAnimationFrame(P.demo.raf);
  audio.stopAllNotes();
  P.demo = null;
  P.keyboard.setExpected([]);
  P.listenBtn.innerHTML = ''; P.listenBtn.append(icon('ear'), 'Anhören');
  setIdleStatus();
}

// ------------------------------------------------------------------ Ergebnis
function showResults(s) {
  const P = app.practice;
  const c = P.cfg;
  const handsTxt = { right: 'rechte Hand', left: 'linke Hand', both: 'beide Hände' }[c.hands];
  const full = c.from === 0 && c.to === P.score.measures.length - 1;
  const rangeTxt = full ? 'ganzes Stück' : `Takt ${measureLabel(c.from)}–${measureLabel(c.to)}`;
  const sub = h('span', null, `${s.mode === 'wait' ? 'Warte-Modus' : 'Im Tempo'} · `, beatGlyph(P.bi.unit), ` = ${c.beatBpm} · ${P.roles.twoHands ? handsTxt + ' · ' : ''}${rangeTxt}`);
  const body = [];
  const actions = [];
  const practiceMeasure = (m) => h('button', {
    class: 'btn small', onclick: () => {
      c.from = Math.max(0, m.idx); c.to = Math.min(P.score.measures.length - 1, m.idx); c.loop = true;
      if (s.mode === 'tempo') c.beatBpm = Math.max(20, Math.round(c.beatBpm * 0.9));
      saveCfg(); renderControls(); closeSheet(); clearMarks(); P.score.clearColors(); P.score.cursorToStep(firstStepInRange());
      toast(`Takt ${measureLabel(m.idx)} in Schleife${s.mode === 'tempo' ? ', etwas langsamer' : ''}`);
    },
  }, 'Üben');
  if (s.mode === 'wait') {
    body.push(h('div', { class: 'hero' }, h('span', { class: 'num' }, fmtPct(s.accuracy)), h('span', { class: 'lbl' }, 'der Noten auf Anhieb richtig')));
    body.push(h('div', { class: 'tiles' },
      tile('Geschafft', `${s.steps} / ${s.total}`, s.complete ? 'bis zum Ende' : 'abgebrochen'),
      tile('Falsche Töne', String(s.errors), s.errors ? 'vor dem richtigen Ton' : 'keine'),
      tile('Übersprungen', String(s.skipped), s.skipped ? 'mit „Weiter“' : '–'),
      tile('Zeit', fmtSec(s.totalTime), 'Ø ' + fmtSec(s.medianStepTime) + ' je Note')));
    if (s.problem.length) {
      body.push(h('div', { class: 'section-title' }, 'Hier hakt es'));
      body.push(h('div', { class: 'problems' }, ...s.problem.map(m => h('div', { class: 'problem' },
        h('div', null, h('b', null, 'Takt ' + measureLabel(m.idx)), h('div', { class: 'why' }, [m.errors ? `${m.errors} falsche${m.errors > 1 ? '' : 'r'} Ton${m.errors > 1 ? 'töne' : ''}`.replace('Tontöne', 'Töne') : null, m.slow ? 'lange gezögert' : null, m.skipped ? 'übersprungen' : null].filter(Boolean).join(' · '))),
        practiceMeasure(m)))));
    }
    if (s.accuracy >= 0.9 && s.complete) body.push(h('p', { class: 'notice', style: { borderColor: 'var(--ok)', background: 'var(--ok-soft)' } }, 'Die Töne sitzen. Nächster Schritt: „Im Tempo“ mit Metronom – erst langsam.'));
    actions.push(h('button', { class: 'btn', onclick: () => { closeSheet(); toggleRun(); } }, 'Nochmal'));
    if (s.accuracy >= 0.8) actions.push(h('button', { class: 'btn', onclick: () => { c.mode = 'tempo'; saveCfg(); renderControls(); setIdleStatus(); closeSheet(); } }, 'Im Tempo üben'));
  } else {
    body.push(h('div', { class: 'hero' }, h('span', { class: 'num' }, fmtPct(s.accuracy)), h('span', { class: 'lbl' }, `der Noten getroffen (${s.hit} von ${s.req})`)));
    const tol = tolerance()[0] * 1000;
    const tend = Math.abs(s.meanDev) < 12 ? 'ausgeglichen' : s.meanDev < 0 ? `Ø ${fmtMs(-s.meanDev)} zu früh` : `Ø ${fmtMs(s.meanDev)} zu spät`;
    let tempoTxt = '–', tempoSub = 'zu wenige Treffer';
    if (s.playedBpmQ) {
      const played = s.playedBpmQ / s.beat.beatQ;
      const diff = (played / s.beatBpm - 1) * 100;
      tempoTxt = h('span', null, beatGlyph(s.beat.unit), ` ≈ ${Math.round(played)}`);
      tempoSub = Math.abs(diff) < 2 ? 'genau im Metronom-Tempo' : diff > 0 ? `${diff.toFixed(0)} % schneller als ${s.beatBpm}` : `${(-diff).toFixed(0)} % langsamer als ${s.beatBpm}`;
      if (s.drift !== null && Math.abs(s.drift) > 0.04) tempoSub += s.drift > 0 ? ' · wirst schneller' : ' · wirst langsamer';
    }
    const durTxt = s.measured ? `${s.short.length} von ${s.measured}` : '–';
    const durSub = s.measured ? (s.short.length ? 'lange Noten zu früh losgelassen' : 'lange Noten gut gehalten') : 'nicht messbar (Pedal oder nur kurze Noten)';
    body.push(h('div', { class: 'tiles' },
      tile('Falsche Töne', String(s.wrong), s.wrong ? 'zusätzlich gehört' : 'keine'),
      tile('Rhythmus', `±${fmtMs(s.sdDev)}`, `${fmtPct(s.within)} innerhalb ±${tol} ms · ${tend}`),
      tile('Tempo', tempoTxt, tempoSub),
      tile('Notenlänge', durTxt, durSub)));
    if (s.loopStats?.length > 1) body.push(h('div', { class: 'field' }, h('span', null, 'Durchläufe'),
      h('div', { class: 'chips' }, ...s.loopStats.map((x, i) => h('span', { class: 'chip' }, `${i + 1}: ${fmtPct(x.acc)}`)))));
    body.push(timingChart(s));
    if (s.problem.length) {
      body.push(h('div', { class: 'section-title' }, 'Problemstellen'));
      body.push(h('div', { class: 'problems' }, ...s.problem.map(m => {
        const why = [];
        if (m.req - m.hit) why.push(`${m.req - m.hit} verpasst`);
        if (m.wrong) why.push(`${m.wrong} falsch`);
        if (m.hit && m.meanAbsDev > tolerance()[0]) why.push(`Ø ±${fmtMs(m.meanAbsDev * 1000)} daneben`);
        if (m.short) why.push(`${m.short} zu kurz`);
        return h('div', { class: 'problem' }, h('div', null, h('b', null, 'Takt ' + measureLabel(m.idx)), h('div', { class: 'why' }, why.join(' · '))), practiceMeasure(m));
      })));
    }
    if (s.short.length) {
      body.push(h('div', { class: 'notelist' }, h('b', null, 'Zu kurz gehalten:'),
        ...s.short.slice(0, 6).map(n => h('span', null, `Takt ${measureLabel(n.measureIdx)}: ${noteName(n.midi)} – ${n.dur.toFixed(1).replace('.', ',')} s statt ${n.expDur.toFixed(1).replace('.', ',')} s`))));
    }
    body.push(h('p', { class: 'help' }, 'Tippe auf eine Note im Notenblatt, um Details zu sehen. Markierungen: ‹ zu früh, › zu spät (in ms), ✕ nicht gehört.'));
    actions.push(h('button', { class: 'btn', onclick: () => { closeSheet(); toggleRun(); } }, 'Nochmal'));
    actions.push(h('button', { class: 'btn', onclick: () => { c.beatBpm = Math.max(20, Math.round(c.beatBpm * 0.9)); saveCfg(); renderControls(); closeSheet(); toggleRun(); } }, 'Langsamer (−10 %)'));
    if (s.accuracy >= 0.92 && s.sdDev < 45) actions.push(h('button', { class: 'btn', onclick: () => { c.beatBpm = Math.round(c.beatBpm * 1.06); saveCfg(); renderControls(); closeSheet(); toggleRun(); } }, 'Schneller (+6 %)'));
  }
  actions.push(h('button', { class: 'btn primary', onclick: closeSheet }, 'Fertig'));
  const hist = h('div', { class: 'history' });
  body.push(hist);
  store.sessionsFor(P.item.id).then(ss => {
    const same = ss.filter(x => x.mode === s.mode).sort((a, b) => a.at - b.at).slice(-6);
    if (same.length < 2) return;
    hist.append(h('div', { class: 'section-title' }, 'Verlauf (' + (s.mode === 'wait' ? 'Warten' : 'Im Tempo') + ')'),
      h('div', { class: 'chips' }, ...same.map((x, i) => h('span', { class: 'chip' + (i === same.length - 1 ? ' on' : ''), title: new Date(x.at).toLocaleString('de-CH') },
        fmtPct(x.accuracy), x.beatBpm ? h('small', { class: 'muted', style: { marginLeft: '6px', fontWeight: 400 } }, '@' + x.beatBpm) : null))));
  }).catch(() => { });
  openSheet(s.accuracy >= 0.95 ? 'Sehr gut!' : s.accuracy >= 0.8 ? 'Gut gespielt' : s.accuracy >= 0.5 ? 'Das wird' : 'Weiter üben', [h('p', { class: 'muted', style: { margin: '-10px 0 0' } }, sub), ...body], actions);
}

function tile(l, v, d) { return h('div', { class: 'tile' }, h('div', { class: 'l' }, l), h('div', { class: 'v' }, v), h('div', { class: 'd' }, d)); }

// Punktdiagramm: Abweichung je getroffener Note (ms), Band = Toleranz
function timingChart(s) {
  const NS = 'http://www.w3.org/2000/svg';
  const pts = s.notes.filter(n => n.hit);
  const wrap = h('div', { class: 'chart' }, h('div', { class: 'ttl' }, 'Timing je Note (früh ↓ / spät ↑)'));
  if (pts.length < 2) { wrap.append(h('p', { class: 'muted', style: { margin: '6px' } }, 'Zu wenige Treffer für ein Diagramm.')); return wrap; }
  const W = 680, H = 210, L = 46, R = 10, T = 12, B = 26;
  const tol = tolerance()[0] * 1000, tolW = tolerance()[1] * 1000;
  const maxAbs = Math.max(150, ...pts.map(n => Math.abs(n.dev * 1000)));
  const lim = Math.ceil(maxAbs / 50) * 50;
  const n = s.notes.length;
  const x = i => L + (i + 0.5) * (W - L - R) / n;
  const y = v => T + (lim - v) / (2 * lim) * (H - T - B);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Timing-Abweichung je Note');
  const el = (tag, a) => { const e = document.createElementNS(NS, tag); for (const k in a) e.setAttribute(k, a[k]); svg.appendChild(e); return e; };
  el('rect', { x: L, y: y(tol), width: W - L - R, height: y(-tol) - y(tol), fill: '#12896f', opacity: 0.08 });
  const ticks = [-lim, -lim / 2, 0, lim / 2, lim];
  for (const t of ticks) {
    el('line', { x1: L, x2: W - R, y1: y(t), y2: y(t), stroke: t === 0 ? '#9aa1b0' : '#e2e6ed', 'stroke-width': 1 });
    const tx = el('text', { x: L - 6, y: y(t) + 4, 'text-anchor': 'end', 'font-size': 11, fill: '#4b5263', 'font-family': 'IBM Plex Mono, monospace' });
    tx.textContent = (t > 0 ? '+' : '') + Math.round(t);
  }
  const unit = el('text', { x: L - 6, y: H - 6, 'text-anchor': 'end', 'font-size': 11, fill: '#737b8c' }); unit.textContent = 'ms';
  // Taktgrenzen als Achsenbeschriftung
  let lastM = -1;
  s.notes.forEach((nn, i) => {
    if (nn.measureIdx !== lastM) {
      lastM = nn.measureIdx;
      const m = app.practice.score.measures[nn.measureIdx];
      if (n <= 120 || m.no % 2 === 0) {
        const tx = el('text', { x: x(i), y: H - 8, 'text-anchor': 'middle', 'font-size': 10, fill: '#737b8c' });
        tx.textContent = m.implicit && m.no === 0 ? 'A' : m.no;
      }
    }
  });
  const tip = h('div', { class: 'tip', hidden: true });
  s.notes.forEach((nn, i) => {
    if (!nn.hit) {
      const g = el('text', { x: x(i), y: T + 9, 'text-anchor': 'middle', 'font-size': 12, 'font-weight': 700, fill: '#cf2a4a' });
      g.textContent = '✕';
      return;
    }
    const v = nn.dev * 1000;
    const a = Math.abs(v);
    const color = a <= tol ? '#12896f' : a <= tolW ? '#c27f00' : '#c27f00';
    const cx = x(i), cy = y(Math.max(-lim, Math.min(lim, v)));
    if (a <= tol) el('circle', { cx, cy, r: 4.5, fill: color, stroke: '#ffffff', 'stroke-width': 2 });
    else {
      const d = v > 0 ? `M${cx} ${cy - 6} L${cx + 5.5} ${cy + 4} L${cx - 5.5} ${cy + 4} Z` : `M${cx} ${cy + 6} L${cx + 5.5} ${cy - 4} L${cx - 5.5} ${cy - 4} Z`;
      el('path', { d, fill: color, stroke: '#ffffff', 'stroke-width': 2, 'stroke-linejoin': 'round' });
    }
    const hit = el('circle', { cx, cy, r: 12, fill: 'transparent' });
    const show = () => {
      const m = app.practice.score.measures[nn.measureIdx];
      tip.textContent = `Takt ${m.implicit && m.no === 0 ? 'Auftakt' : m.no} · ${noteName(nn.midi)} · ${a < 8 ? 'genau' : Math.round(a) + ' ms ' + (v < 0 ? 'zu früh' : 'zu spät')}`;
      const r = svg.getBoundingClientRect(), wr = wrap.getBoundingClientRect();
      tip.style.left = (r.left - wr.left + cx / W * r.width) + 'px';
      tip.style.top = (r.top - wr.top + cy / H * r.height) + 'px';
      tip.hidden = false;
    };
    hit.addEventListener('pointerenter', show);
    hit.addEventListener('pointerdown', show);
    hit.addEventListener('pointerleave', () => { tip.hidden = true; });
  });
  const tri = (up) => h('span', { html: `<svg width="12" height="11" viewBox="0 0 12 11" aria-hidden="true"><path d="${up ? 'M6 0.5L11.5 10.5H0.5Z' : 'M6 10.5L11.5 0.5H0.5Z'}" fill="#c27f00"/></svg>`, style: { display: 'inline-block', marginRight: '5px', verticalAlign: '-1px' } });
  wrap.append(svg, tip, h('div', { class: 'legend' },
    h('span', null, h('span', { class: 'status-dot', style: { background: '#12896f' } }), `im Takt (±${tol} ms)`),
    h('span', null, tri(true), 'zu spät'),
    h('span', null, tri(false), 'zu früh'),
    h('span', null, h('b', { style: { color: '#cf2a4a', marginRight: '5px' } }, '✕'), 'nicht gehört')));
  return wrap;
}

// ------------------------------------------------------------------ Sheets
let sheetEl = null;
function openSheet(title, content, actions = []) {
  closeSheet();
  const close = h('button', { class: 'icon-btn', 'aria-label': 'Schließen', html: ICON.close, onclick: closeSheet });
  const sheet = h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
    h('div', { class: 'sheet-head' }, h('h2', null, title), close),
    ...content,
    actions.length ? h('div', { class: 'sheet-actions' }, ...actions) : null);
  sheetEl = h('div', { class: 'scrim', onclick: e => { if (e.target === sheetEl) closeSheet(); } }, sheet);
  document.body.append(sheetEl);
  setTimeout(() => close.focus(), 50);
}
function closeSheet() { if (sheetEl) { sheetEl.onClose?.(); sheetEl.remove(); sheetEl = null; } }
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') closeSheet();
  if (e.key === ' ' && app.view === 'practice' && !sheetEl && e.target === document.body) { e.preventDefault(); toggleRun(); }
  // Blättertasten/Pedale (Pfeil rechts, Bild ab) → im Warte-Modus „Weiter“
  if ((e.key === 'ArrowRight' || e.key === 'PageDown') && app.view === 'practice' && !sheetEl && app.practice?.practice?.running) { e.preventDefault(); app.practice.practice.skip(); }
});
function openHelp() {
  openSheet('So geht’s', [
    h('div', { class: 'help', style: { display: 'grid', gap: '12px' } },
      h('p', null, h('b', null, '1. Aufstellen. '), 'iPad aufs Notenpult, Mikrofon frei (nicht abdecken). Einmal in den Einstellungen die ', h('b', null, 'Latenz messen'), ' – dann stimmen „zu früh/zu spät“.'),
      h('p', null, h('b', null, '2. Noten laden. '), 'MusicXML-Datei hochladen (z. B. aus MuseScore exportiert) oder ein Beispiel wählen.'),
      h('p', null, h('b', null, '3. Warten-Modus. '), 'Die App zeigt die nächste Note (blau) und wartet, bis du sie richtig spielst. Richtige Töne werden grün abgehakt, falsche kurz rot angezeigt. Klemmt die Erkennung, tippe „Weiter“.'),
      h('p', null, h('b', null, '4. Im Tempo. '), 'Nach dem Einzählen läuft der Cursor im eingestellten Tempo. Danach siehst du: Treffer, falsche Töne, Rhythmus (wie genau du auf den Schlag kommst), dein tatsächliches Tempo und ob lange Noten lang genug gehalten wurden.'),
      h('p', null, h('b', null, '5. Gezielt üben. '), 'Unter „Problemstellen“ einen Takt antippen – er läuft dann in Schleife, etwas langsamer. Mit „Rechts/Links“ übst du die Hände einzeln.'),
      h('p', null, h('b', null, 'Gut zu wissen. '), 'Die Erkennung arbeitet mit den Noten im Hintergrund: Sie weiß, was kommen soll, und prüft genau das. Sehr tiefe Basstöne (unter C2) und Oktavverwechslungen nach unten sind schwer zu unterscheiden. Die Notenlänge wird nur gemessen, wo ein Ton nicht von anderen überdeckt wird; mit Pedal ist sie nicht messbar. Am besten mit wenig Nebengeräuschen üben.'),
      h('p', null, h('b', null, 'Tipp fürs iPad: '), 'In Safari auf „Teilen“ → „Zum Home-Bildschirm“ – dann startet Klavierohr wie eine App und funktioniert auch offline.')),
  ], [h('button', { class: 'btn primary', onclick: closeSheet }, 'Los geht’s')]);
}
function openInfo(title, content) { openSheet(title, content, [h('button', { class: 'btn primary', onclick: closeSheet }, 'Verstanden')]); }

// ------------------------------------------------------------------ Einstellungen
function openSettings() {
  const lat = S.latency;
  const latVal = h('b', { class: 'mono' }, lat === null || lat === undefined ? 'nicht gemessen' : fmtMs(lat * 1000));
  const latMsg = h('p', null, 'Zeit zwischen Klick und dem, was das Mikrofon hört. Einmal messen, damit „zu früh/zu spät“ stimmt.');
  const measureBtn = h('button', {
    class: 'btn small', onclick: async () => {
      measureBtn.disabled = true; latMsg.textContent = 'Bitte still sein – 8 Klicks …';
      try {
        await audio.ensure();
        const r = await audio.measureLatency();
        if (r.ok) { S.latency = r.latency; saveSettings(S); latVal.textContent = fmtMs(r.latency * 1000); latMsg.textContent = `Gemessen über ${r.n} Klicks.`; }
        else latMsg.textContent = 'Klicks nicht deutlich gehört (Kopfhörer? laute Umgebung?). Nutze „Mitspielen“.';
      } catch (e) { latMsg.textContent = 'Mikrofon nicht verfügbar: ' + (e.message || e); }
      measureBtn.disabled = false;
    },
  }, 'Automatisch messen');
  const playBtn = h('button', {
    class: 'btn small', onclick: async () => {
      playBtn.disabled = true; latMsg.textContent = '4 Klicks zum Einzählen, dann 8 Mal einen Ton genau auf den Klick spielen …';
      try {
        await audio.ensure();
        const r = await audio.measureLatencyByPlaying(k => { latMsg.textContent = k < 4 ? `Einzählen ${k + 1} …` : `Spielen: ${k - 3} von 8`; });
        if (r.ok) { S.latency = r.latency; saveSettings(S); latVal.textContent = fmtMs(r.latency * 1000); latMsg.textContent = `Übernommen (${r.n} Anschläge).`; }
        else latMsg.textContent = 'Zu wenige Anschläge erkannt – bitte nochmal.';
      } catch (e) { latMsg.textContent = 'Mikrofon nicht verfügbar: ' + (e.message || e); }
      playBtn.disabled = false;
    },
  }, 'Mitspielen');

  // Mikrofontest
  const live = h('div', { class: 'live-notes' });
  const testMeter = h('i');
  let testOff = null, levelOff = null;
  const testBtn = h('button', {
    class: 'btn small', onclick: async () => {
      if (testOff) { stopTest(); return; }
      try {
        await audio.ensure();
        const det = await audio.startMic();
        testBtn.textContent = 'Test beenden';
        levelOff = det.on('level', e => { testMeter.style.width = Math.max(0, Math.min(100, (e.db + 62) / 50 * 100)) + '%'; });
        testOff = det.on('analysis', ev => {
          const j = judge(ev, [], new Set());
          for (const w of j.wrong.slice(0, 3)) { live.prepend(h('span', null, noteName(w.midi))); while (live.children.length > 8) live.lastChild.remove(); }
        });
      } catch (e) { toast('Mikrofon nicht verfügbar: ' + (e.message || e), 'bad', 3500); }
    },
  }, 'Test starten');
  function stopTest() { testOff?.(); levelOff?.(); testOff = levelOff = null; testBtn.textContent = 'Test starten'; testMeter.style.width = '0'; }

  const seg = (opts, val, set) => {
    const wrap = h('div', { class: 'seg' });
    const draw = () => { wrap.innerHTML = ''; for (const [v, l] of opts) wrap.append(h('button', { class: val() === v ? 'on' : '', onclick: () => { set(v); saveSettings(S); draw(); } }, l)); };
    draw();
    return wrap;
  };
  const sens = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.sensitivity ?? 0.5, oninput: e => { S.sensitivity = +e.target.value; saveSettings(S); audio.applySensitivity(); } });
  const vol = h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: S.metronomeVolume ?? 0.6, oninput: e => { S.metronomeVolume = +e.target.value; saveSettings(S); audio.setMetronomeVolume(S.metronomeVolume); } });
  const a4 = h('input', { type: 'number', min: 415, max: 466, step: 1, value: S.a4 || 440, onchange: e => { S.a4 = Math.max(415, Math.min(466, +e.target.value || 440)); saveSettings(S); if (audio.detector) { audio.detector.a4 = S.a4; audio.detector.buildPartials(); } } });
  const tuneInfo = audio.detector ? `Gelernt: ${audio.detector.tuningCents >= 0 ? '+' : ''}${audio.detector.tuningCents.toFixed(0)} Cent` : 'Die App passt sich beim Spielen an dein Klavier an.';

  const exportBtn = h('button', { class: 'btn small', onclick: exportData }, 'Sicherung herunterladen');
  const importInput = h('input', { type: 'file', hidden: true, onchange: e => importData(e.target.files[0]) });
  const importBtn = h('button', { class: 'btn small', onclick: () => importInput.click() }, 'Sicherung laden');

  openSheet('Einstellungen', [h('div', { class: 'settings-grid' },
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Latenz'), latVal), latMsg, h('div', { class: 'stat-row' }, measureBtn, playBtn)),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Mikrofon-Test'), h('div', { class: 'meter' }, testMeter)),
      h('p', null, 'Spiel einzelne Töne – die erkannten Noten erscheinen hier.'), live, h('div', null, testBtn)),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Empfindlichkeit')), h('p', null, 'Höher, wenn leise Töne nicht erkannt werden; niedriger bei Störgeräuschen.'), sens),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Timing-Toleranz')),
      seg([['strict', 'Streng ±40 ms'], ['normal', 'Normal ±60 ms'], ['loose', 'Locker ±90 ms']], () => S.tolerance || 'normal', v => S.tolerance = v)),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Metronom')),
      seg([['high', 'Hell (empfohlen)'], ['wood', 'Holz (nur mit Kopfhörern)']], () => S.clickSound || 'high', v => S.clickSound = v),
      h('p', null, 'Der helle Klick liegt über dem Klavierbereich, deshalb verwechselt die App ihn nicht mit deinen Tönen.'), vol),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Notennamen')),
      seg([['de', 'Deutsch (H, B)'], ['intl', 'International (B, B♭)']], () => S.names || 'de', v => S.names = v)),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Kammerton a′')), h('p', null, tuneInfo), h('label', { class: 'field', style: { maxWidth: '160px' } }, h('span', null, 'Hz'), a4)),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Darstellung')),
      seg([['system', 'Wie System'], ['light', 'Hell'], ['dark', 'Dunkel']], () => S.theme || 'system', v => { S.theme = v; applyTheme(); })),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Daten')), h('p', null, 'Stücke und Verlauf liegen nur auf diesem iPad. Mit einer Sicherung kannst du sie umziehen.'), h('div', { class: 'stat-row' }, exportBtn, importBtn, importInput)),
    h('div', { class: 'set-row' }, h('div', { class: 'head' }, h('b', null, 'Über')),
      h('p', null, 'Klavierohr 1.0 · Notensatz: OpenSheetMusicDisplay (BSD-3) · Klavierklang: Salamander Grand Piano von Alexander Holm (CC BY 3.0) · Schriften: Bodoni Moda, Atkinson Hyperlegible Next, IBM Plex Mono (OFL).')),
  )]);
  sheetEl.onClose = stopTest;
}

async function exportData() {
  const pieces = await store.listPieces();
  const out = { app: 'klavierohr', version: 1, at: Date.now(), settings: S, pieces: [], sessions: await store.allSessions(), readStats: await readStats(), earStats: await store.getKV('earStats', {}) };
  for (const p of pieces) {
    const buf = new Uint8Array(await p.blob.arrayBuffer());
    let bin = ''; for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    out.pieces.push({ ...p, blob: undefined, data: btoa(bin), type: p.blob.type });
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `klavierohr-sicherung-${new Date().toISOString().slice(0, 10)}.json` });
  document.body.append(a); a.click(); a.remove();
}
async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'klavierohr') throw new Error('Keine Klavierohr-Sicherung');
    for (const p of data.pieces || []) {
      const bin = atob(p.data); const buf = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
      await store.putPiece({ ...p, data: undefined, blob: new Blob([buf], { type: p.type || '' }) });
    }
    for (const s of data.sessions || []) { const { id, ...rest } = s; void id; await store.addSession(rest); }
    if (data.readStats) await store.setKV('readStats', data.readStats);
    toast('Sicherung geladen', 'good');
    closeSheet(); renderHome();
  } catch (e) { toast(e.message || 'Sicherung konnte nicht gelesen werden', 'bad', 3500); }
}

// ------------------------------------------------------------------ Start
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => { e.preventDefault(); if (app.view === 'home' && e.dataTransfer?.files?.length) handleFiles([...e.dataTransfer.files]); });
if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => { });
}
renderHome();
if (!localStorage.getItem('klavierohr.seenHelp')) { localStorage.setItem('klavierohr.seenHelp', '1'); setTimeout(openHelp, 400); }
window.__klavierohr = { app, audio, S, openPractice, sampleItem, SAMPLES };
