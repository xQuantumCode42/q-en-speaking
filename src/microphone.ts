import { encodeWave, sampleRate, maxRecordingSeconds } from "../shared/audio";

export type MicrophoneDevice = { id: string; label: string };
export async function microphoneDevices(): Promise<MicrophoneDevice[]> {
  const devices = await navigator.mediaDevices.enumerateDevices();
  return devices
    .filter(
      (device) =>
        device.kind === "audioinput" && device.deviceId !== "communications",
    )
    .map((device, index) => ({
      id: device.deviceId,
      label: device.label || `麥克風 ${index + 1}`,
    }));
}
export class MicrophoneCapture {
  private stream?: MediaStream;
  private node?: AudioWorkletNode;
  private context?: AudioContext;
  private previewTimer?: ReturnType<typeof setInterval>;
  private limitTimer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private samples = new Float32Array(sampleRate * maxRecordingSeconds);
  private length = 0;
  private voicedLength = 0;
  private flushed?: () => void;
  private finishing = false;

  async start(
    deviceId: string,
    onLevel: (level: number) => void,
    onLimit: () => void,
    onPreview: (wave: Uint8Array) => boolean,
  ) {
    if (this.context) throw new Error("麥克風正在使用中。");
    const generation = ++this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId:
          deviceId && deviceId !== "default" ? { exact: deviceId } : undefined,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
      video: false,
    });
    if (generation !== this.generation) {
      stream.getTracks().forEach((track) => track.stop());
      throw new Error("已取消啟動麥克風。");
    }
    this.stream = stream;
    try {
      const context = new AudioContext({ sampleRate });
      this.context = context;
      await context.audioWorklet.addModule(
        new URL("./capture-worklet.js", window.location.href).href,
      );
      if (generation !== this.generation) {
        if (context.state !== "closed") await context.close();
        return;
      }
      await context.resume();
      if (context.sampleRate !== sampleRate)
        throw new Error("無法使用 16kHz 收音，請重新選擇麥克風。");
      this.length = 0;
      this.voicedLength = 0;
      this.finishing = false;
      const node = new AudioWorkletNode(context, "pcm-capture");
      this.node = node;
      node.port.onmessage = ({ data }) => {
        if (generation !== this.generation) return;
        if (data === "flushed") {
          this.flushed?.();
          return;
        }
        if (!(data instanceof Float32Array)) return;
        const count = Math.min(data.length, this.samples.length - this.length);
        this.samples.set(data.subarray(0, count), this.length);
        this.length += count;
        const rms = Math.sqrt(
          data.reduce((sum, value) => sum + value * value, 0) / data.length,
        );
        if (rms > 0.003) this.voicedLength = this.length;
        onLevel(Math.min(1, rms * 5));
      };
      context.createMediaStreamSource(stream).connect(node);
      node.connect(context.destination);
      let lastVoice = 0;
      this.previewTimer = setInterval(() => {
        if (
          this.finishing ||
          this.length < sampleRate * 1.2 ||
          this.voicedLength <= lastVoice
        )
          return;
        if (onPreview(encodeWave(this.samples.subarray(0, this.length))))
          lastVoice = this.voicedLength;
      }, 400);
      this.limitTimer = setTimeout(onLimit, maxRecordingSeconds * 1000);
      stream.getAudioTracks()[0].onended = onLimit;
    } catch (error) {
      await this.cancel();
      throw error;
    }
  }
  private release() {
    clearInterval(this.previewTimer);
    clearTimeout(this.limitTimer);
    this.stream?.getTracks().forEach((track) => {
      track.onended = null;
      track.stop();
    });
    this.stream = undefined;
  }
  async finish(): Promise<Uint8Array> {
    const context = this.context;
    const node = this.node;
    const generation = this.generation;
    if (!context || !node || this.finishing)
      throw new Error("沒有進行中的錄音。");
    this.finishing = true;
    clearInterval(this.previewTimer);
    clearTimeout(this.limitTimer);
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.flushed = undefined;
          reject(new Error("收音結束逾時，請重新錄音。"));
        }, 2000);
        this.flushed = () => {
          clearTimeout(timer);
          resolve();
        };
        node.port.postMessage("flush");
      });
      if (generation !== this.generation) throw new Error("已取消錄音。");
      if (this.length < sampleRate / 10)
        throw new Error("錄音太短，請說完一句英文再停止。");
      return encodeWave(this.samples.subarray(0, this.length));
    } finally {
      if (generation === this.generation) {
        this.release();
        this.context = undefined;
        this.node = undefined;
        this.samples.fill(0);
        this.length = 0;
      }
      node.disconnect();
      node.port.close();
      if (context.state !== "closed") await context.close();
    }
  }
  async cancel() {
    this.generation++;
    this.release();
    this.flushed?.();
    this.flushed = undefined;
    this.node?.disconnect();
    this.node?.port.close();
    this.node = undefined;
    const context = this.context;
    this.context = undefined;
    this.samples.fill(0);
    this.length = 0;
    if (context && context.state !== "closed") await context.close();
  }
}
