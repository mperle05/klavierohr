// dsp.js — FFT, Fenster und ein einfaches Klavier-Teiltonmodell

export class FFT {
  constructor(n) {
    if (n & (n - 1)) throw new Error('FFT size must be power of 2');
    this.n = n;
    this.re = new Float64Array(n);
    this.im = new Float64Array(n);
    this.rev = new Uint32Array(n);
    const bits = Math.log2(n);
    for (let i = 0; i < n; i++) {
      let r = 0;
      for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b);
      this.rev[i] = r;
    }
    this.cos = new Float64Array(n / 2);
    this.sin = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) {
      this.cos[i] = Math.cos(-2 * Math.PI * i / n);
      this.sin[i] = Math.sin(-2 * Math.PI * i / n);
    }
  }
  // input: Float32Array/Float64Array (len <= n, rest zero), out: magnitudes length n/2+1
  magnitude(input, len, out, scale = 1) {
    const n = this.n, re = this.re, im = this.im, rev = this.rev;
    for (let i = 0; i < n; i++) {
      const j = rev[i];
      re[j] = i < len ? input[i] : 0;
      im[j] = 0;
    }
    for (let size = 2; size <= n; size <<= 1) {
      const half = size >> 1, step = n / size;
      for (let start = 0; start < n; start += size) {
        for (let k = 0, t = 0; k < half; k++, t += step) {
          const a = start + k, b = a + half;
          const wr = this.cos[t], wi = this.sin[t];
          const xr = re[b] * wr - im[b] * wi;
          const xi = re[b] * wi + im[b] * wr;
          re[b] = re[a] - xr; im[b] = im[a] - xi;
          re[a] += xr; im[a] += xi;
        }
      }
    }
    for (let k = 0; k <= n / 2; k++) out[k] = Math.sqrt(re[k] * re[k] + im[k] * im[k]) * scale;
    return out;
  }
}

const hannCache = new Map();
export function hann(len) {
  let w = hannCache.get(len);
  if (!w) {
    w = new Float32Array(len);
    for (let i = 0; i < len; i++) w[i] = 0.5 - 0.5 * Math.cos(2 * Math.PI * (i + 0.5) / len);
    hannCache.set(len, w);
    if (hannCache.size > 64) hannCache.delete(hannCache.keys().next().value);
  }
  return w;
}

export const midiToFreq = (m, a4 = 440) => a4 * Math.pow(2, (m - 69) / 12);

// Inharmonizität B(p): grob nach Messungen an einem Flügel, mit Spielraum für Klaviere
export function inharm(p) {
  if (p >= 36) return 1.2e-4 * Math.pow(2, (p - 36) / 12 * 0.9);
  return 1.2e-4 * Math.pow(2, (36 - p) / 12);
}
// Streckung der Stimmung (Railsback) in Cent
export function stretchCents(p) {
  if (p < 48) return -(48 - p) * 1.0;
  if (p > 72) return (p - 72) * 0.6;
  return 0;
}
// Anzahl der ausgewerteten Teiltöne und deren Gewichte je Register
export function partialWeights(p) {
  let w;
  if (p >= 90) w = [1, 0.25];
  else if (p >= 82) w = [1, 0.35, 0.12];
  else if (p >= 72) w = [1, 0.55, 0.4, 0.2, 0.15];
  else if (p >= 57) w = [1, 0.85, 0.6, 0.5, 0.4, 0.3, 0.25, 0.2];
  else if (p >= 45) w = [0.8, 1, 0.8, 0.6, 0.5, 0.45, 0.4, 0.35, 0.3, 0.25];
  else if (p >= 33) w = [0.45, 1, 0.9, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3];
  else w = [0.2, 0.6, 1, 0.9, 0.85, 0.8, 0.7, 0.6, 0.55, 0.5, 0.45, 0.4, 0.35, 0.3];
  return w;
}

export const NOTE_NAMES_DE = ['C', 'Cis', 'D', 'Es', 'E', 'F', 'Fis', 'G', 'Gis', 'A', 'B', 'H'];
export function noteNameDe(m) {
  return NOTE_NAMES_DE[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}
