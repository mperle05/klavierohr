// detector.js — Echtzeit-Analyse des Mikrofonsignals (ohne DOM, auch in Node testbar)
//
//  • Anschlagerkennung: SuperFlux-artiger spektraler Fluss (2048er Fenster, Hop 256)
//  • pro Anschlag: Spektrum vor/nach dem Anschlag → Zuwachs je Teilton für alle 88 Tasten
//  • judge(): notengestützte Entscheidung (erwartete Töne, Nachbarn, Oktavfehler, falsche Töne)
//  • Notenende: Pegelverlauf der gespielten Töne, schneller Abfall = Dämpfer

import { FFT, hann, midiToFreq, inharm, stretchCents, partialWeights } from './dsp.js';

export const P_MIN = 21, P_MAX = 108;
const LN10_20 = 20 / Math.LN10;

export class Detector {
  constructor(sampleRate, opts = {}) {
    const sr = this.sr = sampleRate;
    this.hop = 256;
    this.onsetN = 2048;
    this.trackN = 4096;
    this.bigN = 8192;
    this.ringSize = 1 << 18;
    this.ring = new Float32Array(this.ringSize);
    this.total = 0;
    this.t0 = null;
    this.frameCount = 0;
    this.nextFrameEnd = this.onsetN;
    this.fftOn = new FFT(this.onsetN);
    this.fftTrack = new FFT(this.trackN);
    this.fftBig = new FFT(this.bigN);
    this.tmp = new Float32Array(this.bigN);

    // Anschlag
    const binOn = sr / this.onsetN;
    this.k1 = Math.max(2, Math.floor(35 / binOn));
    this.k2 = Math.min(this.onsetN / 2 - 2, Math.floor(5200 / binOn));
    this.onMag = new Float32Array(this.onsetN / 2 + 1);
    this.onNoise = null;
    this.onL = [new Float32Array(this.onsetN / 2 + 1), new Float32Array(this.onsetN / 2 + 1), new Float32Array(this.onsetN / 2 + 1)];
    this.odf = new Float32Array(4096);   // Ring
    this.odfEnd = new Float64Array(4096);
    this.lastOnsetIdx = -1e12;
    this.lastOnsetFrame = -1e9;
    this.minIOI = Math.round(0.045 * sr);
    this.odfAbsMin = opts.odfAbsMin ?? 6;
    this.odfRel = opts.odfRel ?? 1.8;
    this.onsetBias = opts.onsetBias ?? 0; // in Samples, empirisch

    // Tracking-Spektrum
    this.trackMag = new Float32Array(this.trackN / 2 + 1);
    this.trackNoise = null;
    this.trackEvery = 2;
    this.tracked = new Map();
    this.pending = [];
    this.recentOnsets = [];

    this.a4 = opts.a4 ?? 440;
    this.tuningCents = opts.tuningCents ?? 0;
    this.tuneDevs = [];
    this.buildPartials();

    this.listeners = {};
    this.paused = false;
    this.levelAcc = 0; this.levelN = 0; this.levelEvery = Math.round(0.05 * sr);
  }

  on(type, fn) { (this.listeners[type] ||= []).push(fn); return () => { this.listeners[type] = this.listeners[type].filter(f => f !== fn); }; }
  emit(type, ev) { const l = this.listeners[type]; if (l) for (const f of l) f(ev); }

  timeOf(idx) { return this.t0 + idx / this.sr; }
  idxOf(time) { return Math.round((time - this.t0) * this.sr); }

  buildPartials() {
    // Teiltonfenster für bigN und trackN
    this.partials = { big: [], track: [] };
    const tune = this.tuningCents;
    for (const [key, N] of [['big', this.bigN], ['track', this.trackN]]) {
      const bin = this.sr / N;
      const arr = [];
      for (let p = 0; p <= 127; p++) {
        if (p < P_MIN || p > P_MAX) { arr.push(null); continue; }
        const w = partialWeights(p);
        const B = inharm(p);
        const f0 = midiToFreq(p, this.a4) * Math.pow(2, (stretchCents(p) + tune) / 1200);
        const list = [];
        for (let h = 1; h <= w.length; h++) {
          const fc = h * f0 * Math.sqrt(1 + B * h * h);
          if (fc > Math.min(6500, 0.45 * this.sr)) break;
          const W = 24 + (h === 1 ? 8 : 0);
          let lo = h * f0 * Math.sqrt(1 + 0.5 * B * h * h) * Math.pow(2, -W / 1200);
          let hi = h * f0 * Math.sqrt(1 + 2.0 * B * h * h) * Math.pow(2, W / 1200);
          lo = Math.max(lo, fc * Math.pow(2, -40 / 1200));
          hi = Math.min(hi, fc * Math.pow(2, 40 / 1200));
          let kLo = Math.round(lo / bin), kHi = Math.round(hi / bin);
          if (kHi < kLo) kHi = kLo;
          list.push({ h, w: w[h - 1], kLo: Math.max(1, kLo), kHi: Math.min(N / 2 - 1, kHi), f: fc, lo, hi });
        }
        arr.push(list);
      }
      this.partials[key] = arr;
    }
    // erweiterte Teiltonliste (alle Harmonischen bis ~7 kHz) zum Maskieren
    const bin = this.sr / this.bigN, ext = [];
    for (let p = 0; p <= 127; p++) {
      if (p < P_MIN || p > P_MAX) { ext.push(null); continue; }
      const B = inharm(p);
      const f0 = midiToFreq(p, this.a4) * Math.pow(2, (stretchCents(p) + tune) / 1200);
      const list = [];
      for (let h = 1; h <= 60; h++) {
        const fc = h * f0 * Math.sqrt(1 + B * h * h);
        if (fc > Math.min(7000, 0.45 * this.sr)) break;
        const lo = h * f0 * Math.sqrt(1 + 0.4 * B * h * h) * Math.pow(2, -30 / 1200);
        const hi = h * f0 * Math.sqrt(1 + 2.5 * B * h * h) * Math.pow(2, 30 / 1200);
        list.push({ h, kLo: Math.round(lo / bin), kHi: Math.max(Math.round(lo / bin), Math.round(hi / bin)), f: fc, lo, hi });
      }
      ext.push(list);
    }
    this.partialsExt = ext;
    this.builtTuning = tune;
  }

  reset() {
    this.pending = [];
    this.tracked.clear();
    this.recentOnsets = [];
  }

  // samples: Float32Array (mono), time: AudioContext-Zeit des ersten Samples
  push(samples, time) {
    if (this.t0 === null) this.t0 = time - this.total / this.sr;
    else if (time !== undefined) {
      const expected = this.timeOf(this.total);
      if (Math.abs(expected - time) > 0.03) this.t0 += time - expected; // Lücke/Drift
    }
    const R = this.ringSize - 1;
    for (let i = 0; i < samples.length; i++) {
      const v = samples[i];
      this.ring[(this.total + i) & R] = v;
      this.levelAcc += v * v;
    }
    this.levelN += samples.length;
    this.total += samples.length;
    if (this.levelN >= this.levelEvery) {
      const rms = Math.sqrt(this.levelAcc / this.levelN);
      this.emit('level', { time: this.timeOf(this.total), db: 20 * Math.log10(rms + 1e-9) });
      this.levelAcc = 0; this.levelN = 0;
    }
    while (this.total >= this.nextFrameEnd) {
      this.processFrame(this.nextFrameEnd);
      this.nextFrameEnd += this.hop;
    }
    this.processPending(false);
  }

  copyWindow(endIdx, len, N, out) {
    // Hann-gefenstertes Segment [endIdx-len, endIdx) in out (Länge N, Rest 0)
    const R = this.ringSize - 1;
    const w = hann(len);
    const start = endIdx - len;
    for (let i = 0; i < len; i++) out[i] = this.ring[(start + i) & R] * w[i];
    for (let i = len; i < N; i++) out[i] = 0;
    return out;
  }

  processFrame(end) {
    const f = this.frameCount++;
    // --- Anschlagsfunktion
    const N = this.onsetN;
    this.copyWindow(end, N, N, this.tmp);
    const mag = this.fftOn.magnitude(this.tmp, N, this.onMag, 4 / N);
    if (!this.onNoise) { this.onNoise = Float32Array.from(mag, v => Math.max(v, 1e-7)); }
    const noise = this.onNoise;
    const L = this.onL[f % 3], Lprev = this.onL[(f + 1) % 3]; // f-2
    let odf = 0;
    for (let k = 0; k < mag.length; k++) {
      const m = mag[k];
      let nz = noise[k];
      if (m < nz) nz *= Math.pow(m / nz, 0.1);
      else nz *= Math.min(1.0004, Math.pow(m / nz, 0.02));
      noise[k] = Math.max(nz, 1e-7);
      L[k] = Math.log(1 + m / (2 * noise[k]));
    }
    if (f >= 2) {
      for (let k = this.k1; k <= this.k2; k++) {
        const pm = Math.max(Lprev[k - 1], Lprev[k], Lprev[k + 1]);
        const d = L[k] - pm;
        if (d > 0) odf += d;
      }
    }
    const R = this.odf.length - 1;
    this.odf[f & R] = odf;
    this.odfEnd[f & R] = end;
    if (f >= 70) this.pickPeak(f - 2);

    // --- Tracking-Spektrum (Notenende, Rauschboden)
    if (f % this.trackEvery === 0 && end >= this.trackN) {
      const TN = this.trackN;
      this.copyWindow(end, TN, TN, this.tmp);
      const tm = this.fftTrack.magnitude(this.tmp, TN, this.trackMag, 4 / TN);
      if (!this.trackNoise) this.trackNoise = Float32Array.from(tm, v => Math.max(v, 1e-7));
      const tn = this.trackNoise;
      for (let k = 0; k < tm.length; k++) {
        const m = tm[k];
        let nz = tn[k];
        if (m < nz) nz *= Math.pow(m / nz, 0.1);
        else nz *= Math.min(1.0005, Math.pow(m / nz, 0.02));
        tn[k] = Math.max(nz, 1e-7);
      }
      this.updateTracked(end);
      this.emit('frame', { idx: end, time: this.timeOf(end), det: this });
    }
  }

  pickPeak(c) {
    const R = this.odf.length - 1;
    const o = i => this.odf[i & R];
    const v = o(c);
    if (!(v >= o(c - 1) && v >= o(c - 2) && v > o(c + 1) && v >= o(c + 2))) return;
    // adaptiver Schwellwert: Median der letzten ~60 Frames
    const hist = [];
    for (let i = c - 60; i < c - 2; i++) hist.push(o(i));
    hist.sort((a, b) => a - b);
    const med = hist[hist.length >> 1];
    let local = 0; for (let i = c - 8; i <= c - 3; i++) local += o(i); local /= 6;
    const thr = Math.max(this.odfAbsMin, med * this.odfRel + 2, local * 1.4 + 2);
    if (v < thr) return;
    const end = this.odfEnd[c & R];
    let est = end - this.onsetN / 2 + this.onsetBias;
    est = this.refineOnset(est);
    if (est - this.lastOnsetIdx < this.minIOI) return;
    // Doppelerkennung kurz nach einem viel stärkeren Anschlag ignorieren
    if (est - this.lastOnsetIdx < 0.09 * this.sr && v < 0.25 * (this.lastStrength || 0)) return;
    if (this.paused) { this.lastOnsetIdx = est; return; }
    const ev = { idx: est, time: this.timeOf(est), strength: v, thr, prevIdx: this.lastOnsetIdx };
    this.lastOnsetIdx = est;
    this.lastOnsetFrame = c;
    this.lastStrength = v;
    this.recentOnsets.push(est);
    if (this.recentOnsets.length > 32) this.recentOnsets.shift();
    // nachfolgender Anschlag begrenzt das Analysefenster des vorigen
    for (const p of this.pending) if (p.nextIdx === undefined) p.nextIdx = est;
    this.pending.push(ev);
    this.emit('onset', ev);
    // laufende Töne gleicher Höhe enden spätestens hier (wird in analyse() gesetzt)
  }

  refineOnset(est) {
    // Zeitbereich: erster 1-ms-Block mit sprunghaft steigender Hochpass-Energie
    const R = this.ringSize - 1;
    const B = Math.max(16, Math.round(this.sr * 0.001));
    const from = Math.round(est - 0.03 * this.sr), to = Math.round(est + 0.022 * this.sr);
    if (from - 12 * B < this.total - this.ringSize + 10 || to > this.total) return Math.round(est);
    const nb = Math.floor((to - from) / B) + 12;
    const E = new Float32Array(nb);
    const s0 = from - 12 * B;
    for (let j = 0; j < nb; j++) {
      let e = 0;
      for (let i = 0; i < B; i++) {
        const n = s0 + j * B + i;
        const d = this.ring[n & R] - this.ring[(n - 1) & R];
        e += d * d;
      }
      E[j] = e;
    }
    let maxE = 0; for (let j = 12; j < nb; j++) maxE = Math.max(maxE, E[j]);
    let best = -1, bestR = 0;
    for (let j = 12; j < nb; j++) {
      const base = (E[j - 10] + E[j - 9] + E[j - 8] + E[j - 7] + E[j - 6] + E[j - 5] + E[j - 4] + E[j - 3]) / 8 + 1e-12;
      const r = E[j] / base;
      if (E[j] >= 0.2 * maxE && r > 4) { best = j; break; }
      if (r > bestR && E[j] >= 0.2 * maxE) { bestR = r; best = j; }
    }
    if (best < 0) return Math.round(est);
    return s0 + best * B;
  }

  processPending(flush) {
    const postStart = Math.round(0.012 * this.sr);
    const Lwant = 6144;
    while (this.pending.length) {
      const p = this.pending[0];
      const s = p.idx + postStart;
      let end = s + Lwant;
      if (p.nextIdx !== undefined) end = Math.min(end, p.nextIdx - Math.round(0.006 * this.sr));
      if (end > this.total && !flush) return;
      end = Math.min(end, this.total);
      this.pending.shift();
      this.analyse(p, s, end);
    }
  }

  partialAmps(mag, list, out, valid = null, D = 8, binHz = 1) {
    for (let i = 0; i < list.length; i++) {
      const pt = list[i];
      let m = 0, km = pt.kLo;
      for (let k = pt.kLo; k <= pt.kHi; k++) if (mag[k] > m) { m = mag[k]; km = k; }
      out[i] = m;
      if (valid) {
        // echte Spitze? (lokales Maximum, nicht Nebenkeule/Flanke eines stärkeren Teiltons)
        let ok = mag[km] >= (mag[km - 1] || 0) && mag[km] >= (mag[km + 1] || 0);
        if (ok && pt.lo) {
          const l = Math.log(mag[km - 1] + 1e-12), c = Math.log(mag[km] + 1e-12), r = Math.log(mag[km + 1] + 1e-12);
          const den = l - 2 * c + r;
          const d = den < 0 ? 0.5 * (l - r) / den : 0;
          const f = (km + Math.max(-0.5, Math.min(0.5, d))) * binHz;
          ok = f >= pt.lo * 0.995 && f <= pt.hi * 1.005;
        }
        if (ok) {
          let nb = 0;
          const a = Math.max(1, km - D), b = Math.min(mag.length - 1, km + D);
          for (let k = a; k <= b; k++) if (mag[k] > nb) nb = mag[k];
          ok = m >= 0.06 * nb;
        }
        valid[i] = ok ? 1 : 0;
      }
    }
    return out;
  }

  noiseAt(f, len) {
    // Rauschboden (aus Tracking-Spektrum) auf Fensterlänge len umgerechnet
    if (!this.trackNoise) return 1e-6;
    const k = Math.round(f / (this.sr / this.trackN));
    const kk = Math.max(1, Math.min(this.trackNoise.length - 2, k));
    const n = Math.max(this.trackNoise[kk - 1], this.trackNoise[kk], this.trackNoise[kk + 1]);
    return n * Math.sqrt(this.trackN / len);
  }

  analyse(p, postS, postE) {
    const N = this.bigN;
    let postLen = Math.max(1024, postE - postS);
    if (postS + postLen > this.total) postLen = Math.max(256, this.total - postS);
    postLen = Math.min(postLen, N);
    const preEnd = p.idx - Math.round(0.004 * this.sr);
    let preStart = preEnd - 6144;
    if (p.prevIdx > -1e11) preStart = Math.max(preStart, p.prevIdx + Math.round(0.03 * this.sr));
    let preLen = preEnd - preStart;
    if (preLen < 1024) preLen = 1024;
    preLen = Math.min(preLen, N);

    const post = new Float32Array(N / 2 + 1), pre = new Float32Array(N / 2 + 1), preS = new Float32Array(N / 2 + 1);
    this.copyWindow(postS + postLen, postLen, N, this.tmp);
    this.fftBig.magnitude(this.tmp, N, post, 4 / postLen);
    this.copyWindow(preEnd, preLen, N, this.tmp);
    this.fftBig.magnitude(this.tmp, N, pre, 4 / preLen);
    // kurzes Fenster direkt vor dem Anschlag (für Tonwiederholungen)
    const preSLen = Math.min(preLen, 3072);
    this.copyWindow(preEnd, preSLen, N, this.tmp);
    this.fftBig.magnitude(this.tmp, N, preS, 4 / preSLen);

    const inc = new Float32Array(128), odd = new Float32Array(128), even = new Float32Array(128);
    const postLv = new Float32Array(128), nSig = new Uint8Array(128);
    const incH = new Array(128), postH = new Array(128), ampH = new Array(128), sigH = new Array(128);
    const tmpA = new Float32Array(64), tmpB = new Float32Array(64), tmpC = new Float32Array(64), vA = new Uint8Array(64);
    const plist = this.partials.big;
    const D = Math.max(4, Math.round(3 * 2 * N / postLen));
    // Lautstärke-Referenz: stärkste Spektrallinie 40 Hz … 6 kHz
    let specMax = 0;
    const k40 = Math.floor(40 * N / this.sr), k6k = Math.ceil(6000 * N / this.sr);
    for (let k = k40; k <= k6k; k++) if (post[k] > specMax) specMax = post[k];
    const sigThr = specMax * 0.0126; // −38 dB
    for (let m = P_MIN; m <= P_MAX; m++) {
      const list = plist[m];
      this.partialAmps(post, list, tmpA, vA, D, this.sr / N);
      this.partialAmps(pre, list, tmpB);
      this.partialAmps(preS, list, tmpC);
      const ih = new Float32Array(list.length), ph = new Float32Array(list.length), ah = new Float32Array(list.length), sg = new Uint8Array(list.length);
      let sw = 0, si = 0, so = 0, swo = 0, se = 0, swe = 0, sp = 0, swAll = 0, ns = 0;
      for (let i = 0; i < list.length; i++) {
        const pt = list[i];
        const nPost = this.noiseAt(pt.f, postLen), nPre = this.noiseAt(pt.f, preLen), nPreS = this.noiseAt(pt.f, preSLen);
        const Lpost = Math.log(1 + tmpA[i] / (2 * nPost));
        const Lpre = Math.min(Math.log(1 + tmpB[i] / (2 * nPre)), Math.log(1 + tmpC[i] / (2 * nPreS)));
        const sig = vA[i] && tmpA[i] >= sigThr;
        const d = sig ? Math.max(0, Lpost - Lpre) : 0;
        ih[i] = d; ph[i] = Lpost; ah[i] = tmpA[i]; sg[i] = sig ? 1 : 0;
        sp += pt.w * Lpost; swAll += pt.w;
        if (!sig) continue;
        ns++;
        sw += pt.w; si += pt.w * d;
        if (pt.h % 2) { so += pt.w * d; swo += pt.w; } else { se += pt.w * d; swe += pt.w; }
      }
      // fehlende/insignifikante Teiltöne zählen mit halbem Gewicht als 0 (kein Freifahrtschein)
      const swPen = sw + 0.5 * (swAll - sw);
      inc[m] = swPen > 0 ? si / swPen : 0;
      odd[m] = swo ? so / swo : 0;
      even[m] = swe ? se / swe : 0;
      postLv[m] = sp / swAll;
      nSig[m] = ns;
      incH[m] = ih; postH[m] = ph; ampH[m] = ah; sigH[m] = sg;
    }
    const ev = {
      idx: p.idx, time: this.timeOf(p.idx), strength: p.strength,
      inc, odd, even, postLv, nSig, incH, postH, ampH, sigH, specMax, postSpec: post, postLen, partials: plist, partialsExt: this.partialsExt, sr: this.sr, fftN: this.bigN,
    };
    this.emit('analysis', ev);
  }

  // --- Tuning-Schätzung aus einem sicher erkannten Ton
  learnTuning(ev, m) {
    const list = this.partials.big[m];
    if (!list) return;
    // stärkster der ersten drei Teiltöne
    let bi = -1, ba = 0;
    for (let i = 0; i < Math.min(3, list.length); i++) if (ev.ampH[m][i] > ba) { ba = ev.ampH[m][i]; bi = i; }
    if (bi < 0 || ev.postLen < 3000) return;
    const pt = list[bi];
    const spec = ev.postSpec;
    let k = pt.kLo; for (let j = pt.kLo; j <= pt.kHi; j++) if (spec[j] > spec[k]) k = j;
    if (k <= 1 || k >= spec.length - 2) return;
    const a = spec[k - 1], b = spec[k], c = spec[k + 1];
    const delta = 0.5 * (a - c) / (a - 2 * b + c || 1e-9);
    const f = (k + delta) * this.sr / this.bigN;
    const dev = 1200 * Math.log2(f / pt.f) + this.tuningCents;
    if (!isFinite(dev) || Math.abs(dev) > 70) return;
    this.tuneDevs.push(dev);
    if (this.tuneDevs.length > 25) this.tuneDevs.shift();
    if (this.tuneDevs.length >= 6) {
      const s = [...this.tuneDevs].sort((x, y) => x - y);
      const med = s[s.length >> 1];
      this.tuningCents = Math.max(-60, Math.min(60, med));
      if (Math.abs(this.tuningCents - this.builtTuning) > 4) this.buildPartials();
    }
  }

  // --- Notenende
  track(id, midi, onsetIdx, expDur = null) {
    for (const [k, t] of this.tracked) if (t.midi === midi && !t.done) { this.finishTrack(k, t, onsetIdx, 'restrike'); }
    this.tracked.set(id, { id, midi, onsetIdx, expDur, lv: [], peak: -200, done: false });
  }
  untrack(id) { this.tracked.delete(id); }

  levelOf(m, mag = this.trackMag, list = this.partials.track[m]) {
    let s = 0;
    for (const pt of list) {
      let a = 0;
      for (let k = pt.kLo; k <= pt.kHi; k++) if (mag[k] > a) a = mag[k];
      s += pt.w * a;
    }
    return LN10_20 * Math.log(s + 1e-9);
  }
  // Teiltöne von m, die nicht mit anderen klingenden Tönen geteilt werden (für Notenende)
  privateTrackPartials(m, others) {
    const list = this.partials.track[m];
    if (!others.length) return list;
    const ext = this.partialsExt;
    return list.filter(pt => !others.some(o => (ext[o] || []).some(b => {
      const lo = pt.lo ?? pt.f * 0.98, hi = pt.hi ?? pt.f * 1.02;
      return lo <= b.hi * 1.004 && b.lo <= hi * 1.004;
    })));
  }
  noiseLevelOf(m) {
    const list = this.partials.track[m];
    let s = 0;
    for (const pt of list) {
      let a = 0;
      for (let k = pt.kLo; k <= pt.kHi; k++) if (this.trackNoise[k] > a) a = this.trackNoise[k];
      s += pt.w * a * 2.5;
    }
    return LN10_20 * Math.log(s + 1e-9);
  }

  updateTracked(end) {
    const fr = this.sr / (this.hop * this.trackEvery);
    const lag = Math.round(0.06 * fr), confirm = Math.round(0.1 * fr);
    // klingende Töne: getrackt oder vor kurzem (≤0,4 s) beendet
    const recentEnd = this.recentEnded || [];
    this.recentEnded = recentEnd.filter(r => end - r.idx < (r.midi < 48 ? 0.9 : 0.45) * this.sr);
    for (const [id, t] of this.tracked) {
      if (t.done) continue;
      const age = (end - t.onsetIdx) / this.sr;
      if (age < 0) continue;
      const others = [];
      for (const [, o] of this.tracked) if (o !== t && !o.done && o.midi !== t.midi && o.onsetIdx <= end) others.push(o.midi);
      for (const r of this.recentEnded) if (r.midi !== t.midi) others.push(r.midi);
      const key = [...new Set(others)].sort((a, b) => a - b).join(',');
      if (key !== t.setKey) {
        t.setKey = key;
        t.plist = this.privateTrackPartials(t.midi, [...new Set(others)]);
        t.lv = []; t.peak = -200; t.cand = null;
        // messbar nur mit genug eigenen Teiltönen (einzelne Teiltöne können natürlich schnell abklingen)
        const full = this.partials.track[t.midi];
        const wFull = full.reduce((a, pt) => a + pt.w, 0), wPriv = t.plist.reduce((a, pt) => a + pt.w, 0);
        t.measurable = t.plist.length >= Math.min(3, full.length) && wPriv >= 0.35 * wFull;
      }
      if (!t.measurable) {
        // nicht messbar: nach der Soll-Dauer nicht mehr als klingend betrachten
        if (age > (t.expDur ? t.expDur + 0.35 : 4)) this.finishTrack(id, t, end, 'unknown');
        continue;
      }
      const lv = this.levelOf(t.midi, this.trackMag, t.plist);
      // Pegel je Teilton (dB) für die Abstimmung beim Loslassen
      const pl = t.plist.map(pt => { let a = 0; for (let k = pt.kLo; k <= pt.kHi; k++) if (this.trackMag[k] > a) a = this.trackMag[k]; return LN10_20 * Math.log(a + 1e-9); });
      t.lv.push({ end, lv, pl });
      if (t.lv.length > 600) t.lv.shift();
      t.peak = Math.max(t.peak, lv);
      if (age < 0.16 || t.lv.length < 4) continue;
      const n = t.lv.length;
      if (t.cand) {
        // Bestätigung: Pegel bleibt unten
        if (n - 1 - t.cand.at >= confirm) {
          if (lv <= t.cand.lv + 2) { this.finishTrack(id, t, t.cand.idx, 'damper'); continue; }
          t.cand = null;
        }
        continue;
      }
      if (n > lag + 1) {
        const before = t.lv[n - 1 - lag].lv;
        const drop = before - lv;
        const nl = this.noiseLevelOf(t.midi);
        // Dämpfer wirkt auf alle Teiltöne: Mehrheit (nach Gewicht) muss mitfallen
        let wDrop = 0, wAll = 0;
        const plB = t.lv[n - 1 - lag].pl;
        t.plist.forEach((pt, i) => { wAll += pt.w; if (plB[i] - t.lv[n - 1].pl[i] >= 5) wDrop += pt.w; });
        if (drop >= 6 && lv < t.peak - 9 && wDrop >= 0.6 * wAll) {
          const relIdx = t.lv[n - 1 - lag].end - Math.round(this.trackN * 0.35);
          t.cand = { idx: Math.max(t.onsetIdx + 1, relIdx), lv, at: n - 1 };
        } else if (lv < nl + 3 && t.plist === this.partials.track[t.midi]) {
          this.finishTrack(id, t, end - Math.round(this.trackN * 0.5), 'faded');
        } else if (age > 12) {
          this.finishTrack(id, t, end, 'timeout');
        }
      }
    }
  }
  finishTrack(id, t, idx, reason) {
    t.done = true;
    this.tracked.delete(id);
    (this.recentEnded ||= []).push({ midi: t.midi, idx });
    this.emit('release', { id, midi: t.midi, onsetIdx: t.onsetIdx, idx, time: this.timeOf(idx), reason, duration: (idx - t.onsetIdx) / this.sr, measurable: t.measurable !== false && t.measurable !== undefined });
  }
}

// ---------------------------------------------------------------------------
// Entscheidung: welche erwarteten Töne wurden angeschlagen, welche falschen?
export const JUDGE = {
  tau: 0.9,        // Mindest-Zuwachs (gewichteter Mittelwert, nats)
  rho: 1.12,       // Vorsprung vor Halbton-Nachbarn (auf unterscheidenden Teiltönen)
  kappa: 0.35,     // ungerade/gerade Teiltöne (Oktave-höher-Verwechslung)
  tauWrong: 1.4,   // Schwelle für falsche Töne
  wrongRelAmp: 0.15, // Mindestlautstärke falscher Töne relativ zum lautesten Teilton (−16 dB)
  tonal: 3.5,      // Spitze/Umgebung, damit ein Teilton als tonal gilt
  lowRelDb: 27,    // tiefe Teiltöne eines erwarteten Tons: höchstens so viel dB unter der lautesten Linie
};

// Überschneidung zweier Teiltonfenster – in Hz (bei tiefen Tönen sind FFT-Bins zu grob)
function overlaps(a, b, marginCents = 0) {
  if (a.lo !== undefined && b.lo !== undefined) {
    const f = Math.pow(2, marginCents / 1200);
    return a.lo / f <= b.hi * f && b.lo / f <= a.hi * f;
  }
  return a.kHi >= b.kLo && a.kLo <= b.kHi;
}

// gewichteter Zuwachs von p auf den Teiltönen, die sich nicht mit q überschneiden
function discInc(ev, p, q) {
  const lp = ev.partials[p], lq = ev.partials[q], ih = ev.incH[p];
  let sw = 0, si = 0, n = 0;
  for (let i = 0; i < lp.length; i++) {
    if (lq.some(b => overlaps(lp[i], b, 0))) continue;
    sw += lp[i].w; si += lp[i].w * ih[i]; n++;
  }
  return n >= Math.min(2, lp.length) && sw > 0.3 ? si / sw : null;
}

function peakInfo(ev, pt, sr) {
  const spec = ev.postSpec;
  let a = 0, ka = pt.kLo;
  for (let k = pt.kLo; k <= pt.kHi; k++) if (spec[k] > a) { a = spec[k]; ka = k; }
  const vals = [];
  for (let k = ka - 18; k <= ka + 18; k++) {
    if (k < 1 || k >= spec.length || Math.abs(k - ka) <= 3) continue;
    vals.push(spec[k]);
  }
  vals.sort((x, y) => x - y);
  const med = vals[vals.length >> 1] || 1e-9;
  let f = ka;
  if (ka > 0 && ka < spec.length - 1) {
    const l = Math.log(spec[ka - 1] + 1e-12), c = Math.log(spec[ka] + 1e-12), r = Math.log(spec[ka + 1] + 1e-12);
    const d = 0.5 * (l - r) / (l - 2 * c + r || -1e-9);
    if (Math.abs(d) < 1) f = ka + d;
  }
  const isLocalMax = ka > pt.kLo && ka < pt.kHi ? true : (spec[ka] >= (spec[ka - 1] || 0) && spec[ka] >= (spec[ka + 1] || 0));
  return { a, tonal: a / med, f: f * sr / ev.fftN, isLocalMax };
}

export function judge(ev, expected, allowed = new Set(), P = JUDGE, recent = null, sounding = null, cand = null) {
  const sr = ev.sr;
  const exp = [...new Set(expected)];
  const ok = new Set([...exp, ...allowed]);
  const inc = ev.inc, plist = ev.partials, ext = ev.partialsExt;
  const relDb = a => 20 * Math.log10((a + 1e-12) / (ev.specMax + 1e-12));
  const extOf = m => ext[m] || [];
  const sharedWith = (pt, others) => others.some(o => extOf(o).some(b => overlaps(pt, b, 0)));

  // Evidenz auf eigenen (nicht geteilten) Teiltönen
  const privEvidence = (m, others, oddOnly = false) => {
    const list = plist[m], ih = ev.incH[m], sg = ev.sigH[m], ah = ev.ampH[m];
    let sw = 0, si = 0, n = 0, swAll = 0, low = 0, lowAny = 0, lowAmp = 0, oddAny = 0, oddLow = 0, sp = 0;
    const lowH = m < 48 ? 4 : 3;
    const ph = ev.postH[m];
    for (let i = 0; i < list.length; i++) {
      const h = list[i].h;
      if (oddOnly && h % 2 === 0) continue;
      if (sharedWith(list[i], others)) continue;
      swAll += list[i].w;
      if (h <= lowH) lowAny++;
      if (h <= 3 && h % 2 === 1) oddAny++;
      if (!sg[i]) continue;
      sw += list[i].w; si += list[i].w * ih[i]; n++; sp += list[i].w * ph[i];
      if (h <= lowH && ih[i] >= P.tau) { low++; lowAmp = Math.max(lowAmp, ah[i]); }
      if (h <= 3 && h % 2 === 1 && ih[i] >= P.tau) oddLow++;
    }
    const swPen = sw + 0.5 * (swAll - sw);
    return { s: swPen > 0 ? si / swPen : 0, n, sw, swAll, low, lowAny, lowAmp, oddAny, oddLow, pres: swPen > 0 ? sp / swPen : 0 };
  };

  // ---- 1) falsche Töne: unerklärte, harmonisch konsistente, laute Anstiege mit eigenem Grundton
  let loudestExp = 0;
  for (const p of exp) for (let i = 0; i < Math.min(4, plist[p].length); i++) if (ev.sigH[p][i] && ev.incH[p][i] >= P.tau) loudestExp = Math.max(loudestExp, ev.ampH[p][i]);
  const refAmp = Math.max(loudestExp, ev.specMax * 0.5);
  const explained = [];
  const mark = m => { for (const pt of extOf(m)) explained.push(pt); };
  // erwartete/erlaubte Töne nur maskieren, wenn ihr eigener Grundton (Bass: 2./3. Teilton) neu klingt
  const ownFund = m => {
    const list = plist[m], ih = ev.incH[m], sg = ev.sigH[m];
    const k = m >= 45 ? 2 : 4;
    for (let i = 0; i < Math.min(k, list.length); i++) if (sg[i] && ih[i] >= P.tau) return true;
    return false;
  };
  for (const m of ok) if (ownFund(m)) mark(m);
  // kürzlich gespielte oder noch klingende Töne erklären ihre Teiltöne (Schwebungen sind kein neuer Ton)
  if (recent) for (const m of recent) mark(m);
  if (sounding) for (const m of sounding) mark(m);
  const masked0 = new Set([...(recent || []), ...(sounding || [])]);
  const isExpl = pt => explained.some(b => overlaps(pt, b, 6));
  const wrong = [];
  for (let iter = 0; iter < 3; iter++) {
    let best = -1, bestS = 0;
    const qLo = cand ? Math.max(P_MIN, cand[0]) : P_MIN, qHi = cand ? Math.min(100, cand[1]) : 100;
    for (let q = qLo; q <= qHi; q++) {
      if (ok.has(q) || masked0.has(q) || wrong.some(w => w.midi === q) || inc[q] < P.tauWrong * 0.5) continue;
      const list = plist[q], ih = ev.incH[q], sg = ev.sigH[q];
      // eigener Grundton (bzw. 2. Teilton im Bass) muss neu klingen
      const h1 = sg[0] && ih[0] >= P.tau && !isExpl(list[0]);
      const h2 = list.length > 1 && sg[1] && ih[1] >= P.tau && !isExpl(list[1]);
      if (q >= 45 ? !h1 : !(h1 || h2)) continue;
      let sw = 0, si = 0, usable = 0, maxA = 0;
      const f0s = [];
      const B = inharm(q);
      for (let i = 0; i < list.length; i++) {
        if (isExpl(list[i])) continue;
        sw += list[i].w; usable++;
        if (!sg[i]) continue;
        si += list[i].w * ih[i];
        if (ih[i] > P.tau) {
          const pk = peakInfo(ev, list[i], sr);
          if (pk.tonal >= P.tonal) {
            const h = list[i].h;
            f0s.push({ h, f0: pk.f / (h * Math.sqrt(1 + B * h * h)), a: pk.a });
            maxA = Math.max(maxA, pk.a);
          }
        }
      }
      const need = q >= 82 ? 1 : q < 36 ? 3 : 2;
      if (usable < need || f0s.length < need || sw < 0.5) continue;
      if (maxA < P.wrongRelAmp * refAmp) continue;
      const nominal = list[0].f / Math.sqrt(1 + B);
      let bestCons = 0;
      for (const a of f0s) {
        if (Math.abs(1200 * Math.log2(a.f0 / nominal)) > 32) continue;
        let n = 0;
        for (const b of f0s) if (Math.abs(1200 * Math.log2(b.f0 / a.f0)) <= 14) n++;
        bestCons = Math.max(bestCons, n);
      }
      if (bestCons < need) continue;
      const v = si / sw;
      if (v >= P.tauWrong && v > bestS) { bestS = v; best = q; }
    }
    if (best < 0) break;
    wrong.push({ midi: best, s: bestS });
    mark(best);
  }
  // Obertöne eines erkannten falschen Tons nicht zusätzlich melden
  const GHOST = [12, 19, 24, 28, 31, 34, 36];
  for (let i = wrong.length - 1; i >= 0; i--) {
    if (wrong.some(o => o !== wrong[i] && GHOST.includes(wrong[i].midi - o.midi))) wrong.splice(i, 1);
  }
  const wrongSet = wrong.map(w => w.midi);

  // ---- 2) erwartete Töne (zwei Durchgänge: erst Töne mit eigenen Teiltönen, dann überdeckte)
  const present = [], missing = [], info = {};
  let strongest = 0;
  const snd = sounding ? [...sounding].filter(m => !exp.includes(m)) : [];
  const anyWrong = wrong.length > 0;
  const fundOk = (p) => {
    // eigener Grundton (bzw. 2. Teilton im Bass) neu und deutlich – Pflicht, wenn falsche Töne im Spiel sind
    const list = plist[p], ih = ev.incH[p], sg = ev.sigH[p];
    const others = [...wrongSet, ...snd];
    const okAt = i => i < list.length && sg[i] && ih[i] >= P.tau && !sharedWith(list[i], others);
    return p >= 45 ? okAt(0) : (okAt(0) || okAt(1));
  };
  // harmonische Konsistenz der eigenen Teiltöne (Resonanzen/Anschlaggeräusche liegen zufällig)
  const consistent = (p, others) => {
    const list = plist[p], ih = ev.incH[p], sg = ev.sigH[p];
    const B = inharm(p);
    const f0s = [];
    for (let i = 0; i < list.length && list[i].h <= 8; i++) {
      if (!sg[i] || ih[i] < P.tau || sharedWith(list[i], others)) continue;
      const pk = peakInfo(ev, list[i], sr);
      const h = list[i].h;
      f0s.push({ h, f0: pk.f / (h * Math.sqrt(1 + B * h * h)) });
    }
    if (!f0s.length) return null; // keine Aussage möglich
    const nominal = list[0].f / Math.sqrt(1 + B);
    if (f0s.length === 1) {
      const c = Math.abs(1200 * Math.log2(f0s[0].f0 / nominal));
      return (p >= 82 || f0s[0].h <= 2) && c <= 22;
    }
    let best = 0, bestLow = false;
    for (const a of f0s) {
      if (Math.abs(1200 * Math.log2(a.f0 / nominal)) > 35) continue;
      const grp = f0s.filter(b => Math.abs(1200 * Math.log2(b.f0 / a.f0)) <= 14);
      if (grp.length > best) { best = grp.length; bestLow = grp.some(g => g.h <= (p < 48 ? 3 : 2)); }
    }
    return best >= 2 && bestLow;
  };
  const decide = (p, pr, usePriv, maskedOk, others = []) => {
    const s = usePriv ? pr.s : inc[p];
    const deepBass = p < 36, top = p >= 100;
    const masked = !usePriv && maskedOk;
    const tau = masked ? 0.35 : deepBass || top ? P.tau * 0.6 : P.tau;
    let pass = s >= tau;
    let why = pass ? '' : 'schwach';
    const pres = usePriv ? pr.pres : ev.postLv[p];
    if (!pass && recent && recent.has(p) && s >= 0.3 && pres >= 2.0) { pass = true; why = 'wiederholt'; }
    if (pass && usePriv && !deepBass && pr.lowAny > 0) {
      if (pr.low === 0 && why !== 'wiederholt') { pass = false; why = 'grundton fehlt'; }
      else if (pr.low > 0 && relDb(pr.lowAmp) < -P.lowRelDb) { pass = false; why = 'zu leise/fremd'; }
    }
    if (pass && !ok.has(p + 12) && p < 90 && ev.even[p] > 0.3 && ev.odd[p] < P.kappa * ev.even[p]) { pass = false; why = 'oktave höher?'; }
    if (pass && usePriv && p >= 45 && pr.oddAny > 0 && pr.oddLow === 0 && why !== 'wiederholt') { pass = false; why = 'oktave höher?'; }
    if (pass && wrongSet.some(w => w === p - 12 || w === p - 24)) { pass = false; why = 'oktave tiefer?'; }
    // in unsicheren Lagen (falsche Töne dabei oder knappe Evidenz) Teiltöne auf Stimmigkeit prüfen
    if (pass && usePriv && !masked && why !== 'wiederholt' && p < 96 && (anyWrong || s < 2 * tau) && consistent(p, others) === false) { pass = false; why = 'unsauber'; }
    if (pass && anyWrong && p < 93 && why !== 'wiederholt' && !masked && plist[p].some(pt => wrongSet.some(w => extOf(w).some(b => overlaps(pt, b, 0)))) && !fundOk(p)) { pass = false; why = 'unsicher (falsche Töne)'; }
    if (pass) for (const w of wrong) {
      if (Math.abs(w.midi - p) <= 2 && w.s > 1.6 * s && pr.low === 0) { pass = false; why = 'nachbar ' + w.midi; }
    }
    return { pass, s, why };
  };
  const later = [];
  for (const p of exp) {
    const others = [...ok, ...wrongSet, ...snd].filter(o => o !== p);
    const pr = privEvidence(p, others);
    if (pr.swAll >= 0.45) {
      const r = decide(p, pr, true, false, others);
      info[p] = { s: r.s, why: r.why, priv: true };
      if (r.pass) { present.push(p); strongest = Math.max(strongest, r.s); } else missing.push(p);
    } else later.push(p);
  }
  for (const p of later) {
    // nur noch gegen tatsächlich erkannte Töne abgrenzen
    const others2 = [...present, ...wrongSet, ...snd, ...[...allowed].filter(a => inc[a] >= P.tau * 0.7)].filter(o => o !== p);
    const pr = privEvidence(p, others2);
    const usePriv = pr.swAll >= 0.45;
    const coveredByPresent = present.some(o => (p - o) % 12 === 0 || p - o === 19 || p - o === 31);
    const maskedOk = snd.some(o => (p - o) % 12 === 0 || p - o === 19 || p - o === 31) || coveredByPresent;
    const r = decide(p, pr, usePriv, maskedOk, others2);
    info[p] = { s: r.s, why: r.why, priv: usePriv };
    if (r.pass) { present.push(p); strongest = Math.max(strongest, r.s); } else missing.push(p);
  }
  return { present, missing, wrong, info, strongest };
}
