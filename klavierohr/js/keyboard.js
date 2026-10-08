// keyboard.js — Klaviatur-Anzeige (SVG): erwartete Töne, Treffer, falsche Töne
const BLACK = new Set([1, 3, 6, 8, 10]);
const isBlack = m => BLACK.has(((m % 12) + 12) % 12);

export class Keyboard {
  constructor(el, { lo = 21, hi = 108 } = {}) {
    this.el = el;
    this.keys = new Map();
    this.setRange(lo, hi);
    if (window.ResizeObserver) {
      let lastW = 0;
      new ResizeObserver(() => { const w = el.clientWidth; if (Math.abs(w - lastW) > 4) { lastW = w; this.draw(); } }).observe(el);
    }
  }

  setRange(lo, hi) {
    // auf weiße Tasten runden
    while (isBlack(lo)) lo--;
    while (isBlack(hi)) hi++;
    this.lo = Math.max(21, lo); this.hi = Math.min(108, hi);
    this.draw();
  }

  fitTo(min, max) {
    let lo = min - 7, hi = max + 7;
    if (hi - lo < 30) { const c = (lo + hi) >> 1; lo = c - 15; hi = c + 15; }
    this.setRange(lo, hi);
  }

  draw() {
    const NS = 'http://www.w3.org/2000/svg';
    const whites = [];
    for (let m = this.lo; m <= this.hi; m++) if (!isBlack(m)) whites.push(m);
    // viewBox in echten Pixeln, damit Beschriftungen nicht verzerrt werden
    const pw = Math.max(200, this.el.clientWidth || 800), ph = Math.max(40, this.el.clientHeight || 80);
    const kw = pw / whites.length;
    const W = pw, H = ph;
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'kb-svg');
    svg.setAttribute('aria-hidden', 'true');
    this.keys.clear();
    const xOf = new Map();
    whites.forEach((m, i) => {
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', i * kw + 0.5); r.setAttribute('y', 0);
      r.setAttribute('width', Math.max(1, kw - 1)); r.setAttribute('height', H);
      r.setAttribute('rx', Math.min(4, kw * 0.12));
      r.setAttribute('class', 'kb-w');
      svg.appendChild(r);
      this.keys.set(m, r);
      xOf.set(m, i * kw);
      if (m % 12 === 0 && kw >= 9) {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('x', i * kw + kw / 2); t.setAttribute('y', H - 6);
        t.setAttribute('class', 'kb-label');
        t.setAttribute('text-anchor', 'middle');
        t.textContent = 'C' + (m / 12 - 1);
        svg.appendChild(t);
      }
    });
    for (let m = this.lo; m <= this.hi; m++) {
      if (!isBlack(m)) continue;
      const bw = kw * 0.6;
      const x = (xOf.get(m - 1) ?? 0) + kw - bw / 2;
      const r = document.createElementNS(NS, 'rect');
      r.setAttribute('x', x); r.setAttribute('y', 0);
      r.setAttribute('width', bw); r.setAttribute('height', H * 0.62);
      r.setAttribute('rx', Math.min(3, bw * 0.12));
      r.setAttribute('class', 'kb-b');
      svg.appendChild(r);
      this.keys.set(m, r);
    }
    this.el.innerHTML = '';
    this.el.appendChild(svg);
    if (this.expected) this.setExpected(this.expected);
  }

  setExpected(midis) {
    this.expected = midis;
    for (const [, r] of this.keys) r.classList.remove('exp');
    for (const m of midis || []) {
      if (m < this.lo || m > this.hi) this.ensureVisible(m);
      this.keys.get(m)?.classList.add('exp');
    }
  }

  ensureVisible(m) {
    if (m >= this.lo && m <= this.hi) return;
    this.setRange(Math.min(this.lo, m - 4), Math.max(this.hi, m + 4));
  }

  flash(m, cls, ms = 450) {
    this.ensureVisible(m);
    const r = this.keys.get(m);
    if (!r) return;
    r.classList.remove('hit', 'bad');
    void r.getBoundingClientRect();
    r.classList.add(cls);
    clearTimeout(r._t);
    r._t = setTimeout(() => r.classList.remove(cls), ms);
  }
}
