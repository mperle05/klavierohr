// AudioWorklet: reicht Mikrofon-Samples in Blöcken an den Hauptthread weiter
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = 512;
    this.buf = new Float32Array(this.size);
    this.n = 0;
    this.t0 = 0;
  }
  process(inputs) {
    const input = inputs[0];
    const ch = input && input[0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        if (this.n === 0) this.t0 = currentTime + i / sampleRate;
        this.buf[this.n++] = ch[i];
        if (this.n === this.size) {
          this.port.postMessage({ samples: this.buf, time: this.t0 }, [this.buf.buffer]);
          this.buf = new Float32Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('klavierohr-capture', CaptureProcessor);
