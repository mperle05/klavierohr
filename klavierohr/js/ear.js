// ear.js — Gehörbildung: Intervalle, Akkorde, Nachspielen (mit Mikrofon)
import { judge } from './detector.js';

export const INTERVALS = [
  { semi: 1, de: 'kleine Sekunde', short: 'k2' }, { semi: 2, de: 'große Sekunde', short: 'g2' },
  { semi: 3, de: 'kleine Terz', short: 'k3' }, { semi: 4, de: 'große Terz', short: 'g3' },
  { semi: 5, de: 'reine Quarte', short: 'r4' }, { semi: 6, de: 'Tritonus', short: 'TT' },
  { semi: 7, de: 'reine Quinte', short: 'r5' }, { semi: 8, de: 'kleine Sexte', short: 'k6' },
  { semi: 9, de: 'große Sexte', short: 'g6' }, { semi: 10, de: 'kleine Septime', short: 'k7' },
  { semi: 11, de: 'große Septime', short: 'g7' }, { semi: 12, de: 'Oktave', short: '8' },
];
export const CHORDS = [
  { id: 'dur', de: 'Dur', iv: [0, 4, 7] }, { id: 'moll', de: 'Moll', iv: [0, 3, 7] },
  { id: 'verm', de: 'vermindert', iv: [0, 3, 6] }, { id: 'uebm', de: 'übermäßig', iv: [0, 4, 8] },
  { id: 'd7', de: 'Dominantseptakkord', iv: [0, 4, 7, 10] }, { id: 'maj7', de: 'großer Septakkord', iv: [0, 4, 7, 11] },
  { id: 'm7', de: 'Moll-Septakkord', iv: [0, 3, 7, 10] },
];

const rand = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const put = (el, ...kids) => el.append(...kids.filter(k => k !== null && k !== undefined && k !== false));
const pickOne = arr => arr[Math.floor(Math.random() * arr.length)];

export class EarTrainer {
  constructor({ audio, el, h, toast, noteName, onStats }) {
    Object.assign(this, { audio, el, h, toast, noteName, onStats });
    this.mode = 'interval';
    this.set = new Set([3, 4, 5, 7, 12]);
    this.chordSet = new Set(['dur', 'moll']);
    this.direction = 'up';
    this.stats = { right: 0, total: 0 };
    this.render();
  }

  async play(notes, harmonic) {
    await this.audio.loadPiano();
    const t = this.audio.now() + 0.08;
    if (harmonic) notes.forEach(m => this.audio.playNote(m, t, 1.4, 0.7));
    else notes.forEach((m, i) => this.audio.playNote(m, t + i * 0.62, 0.6, 0.7));
  }

  newQuestion() {
    if (this.mode === 'interval') {
      const iv = pickOne([...this.set]);
      const root = rand(55, 67);
      let notes = [root, root + iv];
      if (this.direction === 'down') notes = [root + iv, root];
      const dir = this.direction === 'mixed' ? pickOne(['up', 'down', 'harm']) : this.direction;
      if (dir === 'down') notes = [root + iv, root];
      this.q = { type: 'interval', answer: iv, notes, harmonic: dir === 'harm' };
    } else if (this.mode === 'chord') {
      const ch = CHORDS.find(c => c.id === pickOne([...this.chordSet]));
      const root = rand(52, 64);
      this.q = { type: 'chord', answer: ch.id, notes: ch.iv.map(x => root + x), harmonic: true };
    }
    this.answered = false;
    this.play(this.q.notes, this.q.harmonic);
    this.renderQuestion();
  }

  answer(a) {
    if (!this.q || this.answered) return;
    this.answered = true;
    this.chosen = a;
    const right = a === this.q.answer;
    this.stats.total++; if (right) this.stats.right++;
    this.onStats?.(this.mode, right, this.q.answer);
    const correct = this.q.type === 'interval' ? INTERVALS.find(i => i.semi === this.q.answer).de : CHORDS.find(c => c.id === this.q.answer).de;
    this.feedback = { right, text: right ? 'Richtig: ' + correct : 'Das war: ' + correct, notes: this.q.notes };
    this.renderQuestion();
    if (right) setTimeout(() => this.answered && this.newQuestion(), 1100);
  }

  // ------------------------------------------------- Nachspielen (Mikrofon)
  async startEcho() {
    const len = rand(3, 5);
    const scale = [60, 62, 64, 65, 67, 69, 71, 72];
    const mel = [pickOne(scale.slice(0, 5))];
    while (mel.length < len) {
      const last = mel[mel.length - 1];
      const cand = scale.filter(m => m !== last && Math.abs(m - last) <= 4);
      mel.push(pickOne(cand));
    }
    this.echo = { mel, k: 0, errors: 0 };
    this.feedback = null;
    this.renderQuestion();
    const det = await this.audio.startMic();
    this.echoOff?.();
    this.echoOff = det.on('analysis', ev => this.onEcho(ev));
    await this.play(mel, false);
  }

  onEcho(ev) {
    const e = this.echo;
    if (!e || e.k >= e.mel.length) return;
    const want = e.mel[e.k];
    const recent = e.k > 0 ? new Set([e.mel[e.k - 1]]) : null;
    const j = judge(ev, [want], new Set(), undefined, recent);
    if (j.present.includes(want)) {
      e.k++;
      if (e.k >= e.mel.length) {
        this.stats.total++; if (!e.errors) this.stats.right++;
        this.onStats?.('echo', !e.errors);
        this.feedback = { right: true, text: e.errors ? `Geschafft – mit ${e.errors} Fehler${e.errors > 1 ? 'n' : ''}.` : 'Fehlerfrei nachgespielt!' , notes: e.mel };
      }
      this.renderQuestion();
    } else if (j.wrong.length) {
      e.errors++;
      this.toast(`Nicht ${this.noteName(j.wrong[0].midi)} – hör noch mal hin.`, 'bad');
      this.renderQuestion();
    }
  }

  stopEcho() { this.echoOff?.(); this.echoOff = null; this.echo = null; }

  // ------------------------------------------------- Oberfläche
  render() {
    const h = this.h;
    this.el.innerHTML = '';
    const modes = h('div', { class: 'seg', role: 'tablist' },
      ...[['interval', 'Intervalle'], ['chord', 'Akkorde'], ['echo', 'Nachspielen']].map(([id, label]) =>
        h('button', { class: this.mode === id ? 'on' : '', onclick: () => { this.stopEcho(); this.mode = id; this.q = null; this.feedback = null; this.render(); } }, label)));
    const opts = h('div', { class: 'ear-opts' });
    if (this.mode === 'interval') {
      opts.append(
        h('div', { class: 'chips' }, ...INTERVALS.map(iv => h('button', {
          class: 'chip' + (this.set.has(iv.semi) ? ' on' : ''), 'aria-pressed': this.set.has(iv.semi),
          onclick: () => { if (this.set.has(iv.semi) && this.set.size > 2) this.set.delete(iv.semi); else this.set.add(iv.semi); this.render(); },
        }, iv.de))),
        h('div', { class: 'seg small' }, ...[['up', 'aufwärts'], ['down', 'abwärts'], ['harm', 'gleichzeitig'], ['mixed', 'gemischt']].map(([id, l]) =>
          h('button', { class: this.direction === id ? 'on' : '', onclick: () => { this.direction = id; this.render(); } }, l))));
    } else if (this.mode === 'chord') {
      opts.append(h('div', { class: 'chips' }, ...CHORDS.map(c => h('button', {
        class: 'chip' + (this.chordSet.has(c.id) ? ' on' : ''), 'aria-pressed': this.chordSet.has(c.id),
        onclick: () => { if (this.chordSet.has(c.id) && this.chordSet.size > 2) this.chordSet.delete(c.id); else this.chordSet.add(c.id); this.render(); },
      }, c.de))));
    } else {
      opts.append(h('p', { class: 'muted' }, 'Die App spielt eine kurze Melodie im Bereich c′–c″. Spiel sie auf deinem Klavier nach – das Mikrofon prüft Ton für Ton.'));
    }
    this.qEl = h('div', { class: 'ear-q' });
    this.el.append(modes, opts, this.qEl);
    this.renderQuestion();
  }

  renderQuestion() {
    const h = this.h;
    const el = this.qEl;
    if (!el) return;
    el.innerHTML = '';
    const score = h('div', { class: 'ear-score mono' }, `${this.stats.right} / ${this.stats.total} richtig`);
    if (this.mode === 'echo') {
      const e = this.echo;
      const dots = e ? h('div', { class: 'echo-dots' }, ...e.mel.map((m, i) => h('span', { class: 'dot' + (i < e.k ? ' done' : i === e.k ? ' cur' : '') }, i < e.k ? this.noteName(m) : '?'))) : null;
      put(el,
        h('div', { class: 'ear-actions' },
          h('button', { class: 'btn primary', onclick: () => this.startEcho() }, e ? 'Neue Melodie' : 'Melodie vorspielen'),
          e ? h('button', { class: 'btn', onclick: () => this.play(e.mel, false) }, 'Nochmal hören') : null),
        dots || h('p', { class: 'muted' }, 'Tipp: Der erste Ton liegt zwischen c′ und g′.'),
        this.feedback ? h('p', { class: 'fb ' + (this.feedback.right ? 'good' : 'bad') }, this.feedback.text) : null,
        score);
      return;
    }
    const choices = this.mode === 'interval'
      ? INTERVALS.filter(i => this.set.has(i.semi)).map(i => [i.semi, i.de])
      : CHORDS.filter(c => this.chordSet.has(c.id)).map(c => [c.id, c.de]);
    put(el,
      h('div', { class: 'ear-actions' },
        h('button', { class: 'btn primary', onclick: () => this.newQuestion() }, this.q ? 'Nächste Aufgabe' : 'Start'),
        this.q ? h('button', { class: 'btn', onclick: () => this.play(this.q.notes, this.q.harmonic) }, 'Nochmal hören') : null),
      this.q ? h('div', { class: 'answers' }, ...choices.map(([id, label]) => {
        let cls = 'answer';
        if (this.answered) { if (id === this.q.answer) cls += ' right'; else if (id === this.chosen) cls += ' wrongpick'; }
        return h('button', { class: cls, disabled: this.answered && id !== this.q.answer && id !== this.chosen ? '' : null, onclick: () => this.answer(id) }, label);
      })) : h('p', { class: 'muted' }, 'Wähle oben aus, was abgefragt wird, und tippe auf Start.'),
      this.feedback ? h('p', { class: 'fb ' + (this.feedback.right ? 'good' : 'bad') }, this.feedback.text,
        h('button', { class: 'link', style: { marginLeft: '10px' }, onclick: () => this.play(this.feedback.notes, this.q?.harmonic) }, 'nochmal anhören')) : null,
      score);
  }
}
