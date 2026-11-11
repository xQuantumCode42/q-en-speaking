export const sampleRate = 16000;
export const maxRecordingSeconds = 60;
export const maxWaveBytes = 44 + sampleRate * maxRecordingSeconds * 2;

// Canonical mono PCM16 WAV. Both IPC validation and browser encoding use this format.
export function encodeWave(samples: Float32Array): Uint8Array {
  if (!samples.length || samples.length > sampleRate * maxRecordingSeconds)
    throw new Error("錄音長度需介於 0 到 60 秒。");
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index++)
      bytes[offset + index] = value.charCodeAt(index);
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVEfmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index++) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    view.setInt16(
      44 + index * 2,
      value < 0 ? value * 32768 : value * 32767,
      true,
    );
  }
  return bytes;
}

export function validateWave(bytes: Uint8Array): void {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length < 44 + sampleRate / 5 ||
    bytes.length > maxWaveBytes
  )
    throw new Error("錄音需為 0.1 至 60 秒的英文語音。");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (offset: number, count: number) =>
    String.fromCharCode(...bytes.subarray(offset, offset + count));
  if (
    text(0, 4) !== "RIFF" ||
    text(8, 8) !== "WAVEfmt " ||
    text(36, 4) !== "data" ||
    view.getUint32(4, true) !== bytes.length - 8 ||
    view.getUint32(16, true) !== 16 ||
    view.getUint16(20, true) !== 1 ||
    view.getUint16(22, true) !== 1 ||
    view.getUint32(24, true) !== sampleRate ||
    view.getUint32(28, true) !== sampleRate * 2 ||
    view.getUint16(32, true) !== 2 ||
    view.getUint16(34, true) !== 16 ||
    view.getUint32(40, true) !== bytes.length - 44 ||
    (bytes.length - 44) % 2
  )
    throw new Error("錄音格式不正確，請重新錄音。");
  let energy = 0;
  for (let offset = 44; offset < bytes.length; offset += 2)
    energy += (view.getInt16(offset, true) / 32768) ** 2;
  if (Math.sqrt(energy / ((bytes.length - 44) / 2)) < 0.0005)
    throw new Error("這段錄音沒有辨識到英文。");
}
