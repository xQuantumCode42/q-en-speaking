// Runs on the audio thread. Output remains silent; only mono PCM is transferred.
class CaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.length = 0;
    this.active = true;
    this.port.onmessage = ({ data }) => {
      if (data === "flush") {
        this.active = false;
        this.flush();
        this.port.postMessage("flushed");
      }
    };
  }
  flush() {
    if (!this.length) return;
    const samples = this.buffer.slice(0, this.length);
    this.port.postMessage(samples, [samples.buffer]);
    this.length = 0;
  }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (this.active && channel) {
      for (const sample of channel) {
        this.buffer[this.length++] = sample;
        if (this.length === this.buffer.length) this.flush();
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", CaptureProcessor);
