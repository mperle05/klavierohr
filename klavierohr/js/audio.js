// audio.js — AudioContext, Mikrofon → Detektor, Klavierklang (Samples), Metronom, Latenzmessung
import { Detector } from './detector.js';

const SAMPLES = ['A0', 'C1', 'Ds1', 'Fs1', 'A1', 'C2', 'Ds2', 'Fs2', 'A2', 'C3', 'Ds3', 'Fs3', 'A3', 'C4', 'Ds4', 'Fs4', 'A4', 'C5', 'Ds5', 'Fs5', 'A5', 'C6', 'Ds6', 'Fs6', 'A6', 'C7', 'Ds7', 'Fs7', 'A7', 'C8'];
const SEMI = { C: 0, Ds: 3, Fs: 6, A: 9 };
function sampleMidi(n) { const k = n.startsWith('Ds') || n.startsWith('Fs') ? n.slice(0, 2) : n[0]; return 12 * (parseInt(n.slice(k.length), 10) + 1) + SEMI[k]; }

export class AudioEngine {
  constructor(settings) {
    this.settings = settings;
    this.ctx = null;
    this.detector = null;
    this.stream = null;
    this.muteUntil = 0;
    this.piano = new Map();
    this.pianoLoading = null;
    this.onLevel = null;
    this.voices = new Set();
  }

  async ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.clickBus = this.ctx.createGain();
      this.clickBus.gain.value = this.settings.metronomeVolume ?? 0.6;
      this.clickBus.connect(this.master);
      this.pianoBus = this.ctx.createGain();
      this.pianoBus.gain.value = 0.9;
      this.pianoBus.connect(this.master);
      this.buildClicks();
    }
    if (this.ctx.state !== 'running') {
      try { await this.ctx.resume(); } catch { }
    }
    return this.ctx;
  }

  now() { return this.ctx ? this.ctx.currentTime : 0; }
  get sampleRate() { return this.ctx?.sampleRate || 48000; }
  get outputLatency() { return (this.ctx?.outputLatency || 0) + (this.ctx?.baseLatency || 0); }

  // ---------------------------------------------------------------- Mikrofon
  get micActive() { return !!this.stream; }

  async startMic() {
    await this.ensure();
    if (this.stream) return this.detector;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Dieses Gerät/dieser Browser erlaubt keinen Mikrofonzugriff (nur über https).');
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
    });
    const ctx = this.ctx;
    this.detector = new Detector(ctx.sampleRate, {
      a4: this.settings.a4 || 440,
      tuningCents: this.settings.tuningCents || 0,
    });
    this.applySensitivity();
    this.src = ctx.createMediaStreamSource(this.stream);
    this.sink = ctx.createGain();
    this.sink.gain.value = 0;
    this.sink.connect(ctx.destination);
    const handle = (samples, time) => {
      this.detector.paused = ctx.currentTime < this.muteUntil;
      this.detector.push(samples, time);
    };
    try {
      if (!ctx.audioWorklet) throw new Error('no worklet');
      await ctx.audioWorklet.addModule(new URL('./capture-worklet.js', import.meta.url).href);
      this.node = new AudioWorkletNode(ctx, 'klavierohr-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1] });
      this.node.port.onmessage = e => handle(e.data.samples, e.data.time);
    } catch {
      const sp = ctx.createScriptProcessor(1024, 1, 1);
      sp.onaudioprocess = e => {
        const d = e.inputBuffer.getChannelData(0);
        handle(new Float32Array(d), e.playbackTime - 1024 / ctx.sampleRate);
      };
      this.node = sp;
    }
    this.src.connect(this.node);
    this.node.connect(this.sink);
    return this.detector;
  }

  applySensitivity() {
    if (!this.detector) return;
    const s = this.settings.sensitivity ?? 0.5; // 0 … 1
    this.detector.odfRel = 2.3 - s * 1.0;        // 2.3 … 1.3
    this.detector.odfAbsMin = 8 - s * 4;
  }

  stopMic() {
    try { this.src?.disconnect(); this.node?.disconnect(); } catch { }
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = null; this.node = null; this.src = null;
  }

  muteInput(seconds) {
    this.muteUntil = Math.max(this.muteUntil, this.now() + seconds);
  }

  // ---------------------------------------------------------------- Klavier
  loadPiano() {
    if (this.pianoLoading) return this.pianoLoading;
    this.pianoLoading = (async () => {
      await this.ensure();
      const base = new URL('../audio/piano/', import.meta.url);
      await Promise.all(SAMPLES.map(async n => {
        try {
          const res = await fetch(new URL(n + '.mp3', base));
          const arr = await res.arrayBuffer();
          const buf = await new Promise((ok, err) => this.ctx.decodeAudioData(arr, ok, err));
          this.piano.set(sampleMidi(n), buf);
        } catch (e) { console.warn('Sample', n, e); }
      }));
    })();
    return this.pianoLoading;
  }

  playNote(midi, when = 0, dur = 0.8, vel = 0.75) {
    if (!this.ctx || !this.piano.size) return;
    const t = Math.max(when, this.now());
    let best = null, bd = 1e9;
    for (const [m, b] of this.piano) { const d = Math.abs(m - midi); if (d < bd) { bd = d; best = [m, b]; } }
    if (!best) return;
    const src = this.ctx.createBufferSource();
    src.buffer = best[1];
    src.playbackRate.value = Math.pow(2, (midi - best[0]) / 12);
    const g = this.ctx.createGain();
    const v = Math.max(0.05, Math.min(1, vel));
    g.gain.setValueAtTime(v * v, t);
    const off = t + Math.max(0.05, dur);
    g.gain.setValueAtTime(v * v, off);
    g.gain.exponentialRampToValueAtTime(0.0008, off + 0.25);
    src.connect(g); g.connect(this.pianoBus);
    src.start(t);
    src.stop(off + 0.3);
    this.voices.add(src);
    src.onended = () => this.voices.delete(src);
    // eigene Wiedergabe nicht als Spiel werten
    this.muteUntil = Math.max(this.muteUntil, off + 0.35);
  }

  stopAllNotes() {
    for (const v of this.voices) { try { v.stop(); } catch { } }
    this.voices.clear();
    this.muteUntil = Math.min(this.muteUntil, this.now() + 0.3);
  }

  // ---------------------------------------------------------------- Metronom
  buildClicks() {
    // Hohe, schmalbandige Klicks (≈7–9 kHz): liegen oberhalb des Analysebereichs,
    // damit das Metronom nicht als Klavierton/Anschlag erkannt wird.
    const sr = this.ctx.sampleRate;
    const mk = (f, dur, amp) => {
      const n = Math.round(dur * sr);
      const b = this.ctx.createBuffer(1, n, sr);
      const d = b.getChannelData(0);
      for (let i = 0; i < n; i++) {
        const w = Math.sin(Math.PI * i / n) ** 2;
        d[i] = amp * w * Math.sin(2 * Math.PI * f * i / sr);
      }
      return b;
    };
    const nyq = sr / 2;
    this.clickNormal = mk(Math.min(7600, nyq * 0.8), 0.035, 0.55);
    this.clickAccent = mk(Math.min(8800, nyq * 0.85), 0.045, 0.85);
    // breitbandiger Messklick für die Latenzmessung
    const n = Math.round(0.006 * sr);
    const b = this.ctx.createBuffer(1, n, sr);
    const d = b.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < n; i++) { s = (s * 16807) % 2147483647; d[i] = ((s / 2147483647) - 0.5) * 1.6 * Math.exp(-i / (0.0015 * sr)); }
    this.clickMeasure = b;
    // Holzblock (nur mit Kopfhörern sinnvoll)
    const wn = Math.round(0.05 * sr);
    const wb = this.ctx.createBuffer(1, wn, sr);
    const wd = wb.getChannelData(0);
    for (let i = 0; i < wn; i++) { const t = i / sr; wd[i] = 0.7 * Math.exp(-t * 90) * (Math.sin(2 * Math.PI * 1150 * t) + 0.4 * Math.sin(2 * Math.PI * 2650 * t)); }
    this.clickWood = wb;
  }

  click(when, accent = false, kind = null) {
    if (!this.ctx) return;
    const k = kind || this.settings.clickSound || 'high';
    const src = this.ctx.createBufferSource();
    src.buffer = k === 'wood' ? this.clickWood : k === 'measure' ? this.clickMeasure : (accent ? this.clickAccent : this.clickNormal);
    const g = this.ctx.createGain();
    g.gain.value = k === 'wood' && accent ? 1.0 : k === 'wood' ? 0.65 : 1;
    src.connect(g); g.connect(k === 'measure' ? this.master : this.clickBus);
    src.start(Math.max(when, this.now()));
  }

  setMetronomeVolume(v) { if (this.clickBus) this.clickBus.gain.value = v; }

  // ---------------------------------------------------------------- Latenz
  // Spielt Messklicks über den Lautsprecher und misst, wann das Mikrofon sie hört.
  async measureLatency() {
    const det = await this.startMic();
    const onsets = [];
    const off = det.on('onset', e => onsets.push(e.time));
    const t0 = this.now() + 0.5;
    const times = [];
    for (let k = 0; k < 8; k++) { const t = t0 + k * 0.5; times.push(t); this.click(t, false, 'measure'); }
    await new Promise(r => setTimeout(r, (0.5 * 8 + 1.0) * 1000));
    off();
    const ds = [];
    for (const t of times) {
      const c = onsets.filter(o => o >= t - 0.01 && o <= t + 0.3).sort((a, b) => a - b)[0];
      if (c !== undefined) ds.push(c - t);
    }
    if (ds.length < 5) return { ok: false, n: ds.length };
    ds.sort((a, b) => a - b);
    const med = ds[ds.length >> 1];
    const mad = ds.map(d => Math.abs(d - med)).sort((a, b) => a - b)[ds.length >> 1];
    if (mad > 0.012) return { ok: false, n: ds.length, mad };
    return { ok: true, latency: med, n: ds.length, mad };
  }

  // Mitspielen zum Klick: Nutzer spielt auf jeden Schlag einen Ton
  async measureLatencyByPlaying(onBeat) {
    const det = await this.startMic();
    const onsets = [];
    const off = det.on('onset', e => onsets.push(e.time));
    const beat = 0.6, t0 = this.now() + 0.6;
    const times = [];
    for (let k = 0; k < 12; k++) {
      const t = t0 + k * beat;
      this.click(t, k % 4 === 0);
      if (k >= 4) times.push(t);
      if (onBeat) setTimeout(() => onBeat(k), (t - this.now()) * 1000);
    }
    await new Promise(r => setTimeout(r, (beat * 12 + 0.8) * 1000));
    off();
    const ds = [];
    for (const t of times) {
      const c = onsets.filter(o => o >= t - 0.25 && o <= t + 0.45).sort((a, b) => Math.abs(a - t) - Math.abs(b - t))[0];
      if (c !== undefined) ds.push(c - t);
    }
    if (ds.length < 5) return { ok: false, n: ds.length };
    ds.sort((a, b) => a - b);
    return { ok: true, latency: ds[ds.length >> 1], n: ds.length };
  }
}
