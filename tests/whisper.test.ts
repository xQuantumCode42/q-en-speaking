import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  existsSync,
  mkdirSync,
  copyFileSync,
  linkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { WhisperTranscriber } from "../electron/whisper";
import { encodeWave, validateWave } from "../shared/audio";

function canonicalWave(file: string) {
  const bytes = readFileSync(file);
  let offset = 12;
  while (offset + 8 <= bytes.length) {
    const name = bytes.toString("ascii", offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    if (name === "fmt ") {
      assert.equal(bytes.readUInt16LE(offset + 8), 1);
      assert.equal(bytes.readUInt16LE(offset + 10), 1);
      assert.equal(bytes.readUInt32LE(offset + 12), 16000);
      assert.equal(bytes.readUInt16LE(offset + 22), 16);
    }
    if (name === "data")
      return encodeWave(
        Float32Array.from(
          { length: size / 2 },
          (_, index) => bytes.readInt16LE(offset + 8 + index * 2) / 32768,
        ),
      );
    offset += 8 + size + (size % 2);
  }
  throw new Error("No PCM audio in fixture");
}
test("audio IPC rejects malformed, silent and oversized input", () => {
  assert.throws(() => validateWave(new Uint8Array(20000)), /格式/);
  assert.throws(
    () => validateWave(encodeWave(new Float32Array(16000))),
    /沒有辨識到英文/,
  );
  assert.throws(() => encodeWave(new Float32Array(16000 * 61)), /60/);
  const wave = encodeWave(
    Float32Array.from(
      { length: 16000 },
      (_, index) => Math.sin(index / 10) / 5,
    ),
  );
  assert.doesNotThrow(() => validateWave(wave));
  wave[24] = 0;
  assert.throws(() => validateWave(wave), /格式/);
});
test(
  "real local Whisper transcribes English WAV and cancels without audio files on disk",
  { skip: process.platform !== "win32", timeout: 120000 },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "speaking-whisper-"));
    const cache = join(directory, "speech-cache");
    const transcriber = new WhisperTranscriber(resolve("native"), cache);
    try {
      assert.ok(
        transcriber.ready,
        "Run npm run setup:speech before speech tests",
      );
      const file = join(directory, "fixture.wav");
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          resolve("native/speech.ps1"),
          "-Mode",
          "Generate",
          "-AudioFile",
          file,
        ],
        {
          input: "I went to the park yesterday. I enjoyed the sunny weather.",
          encoding: "utf8",
          windowsHide: true,
          timeout: 15000,
        },
      );
      assert.equal(result.status, 0, result.stderr);
      const wave = canonicalWave(file);
      const started = Date.now();
      const text = await transcriber.transcribe(wave);
      console.log(`Whisper audio fixture: ${Date.now() - started} ms; ${text}`);
      assert.match(text, /went to the park yesterday/i);
      assert.match(text, /sunny weather/i);
      const warmedStart = Date.now();
      assert.equal(await transcriber.transcribe(wave), text);
      console.log(
        `Warm speech fixture: ${Date.now() - warmedStart} ms; backend ${transcriber.performance.acceleration}`,
      );
      const fallbackNative = join(directory, "fallback-native");
      mkdirSync(join(fallbackNative, "models"), { recursive: true });
      mkdirSync(join(fallbackNative, "whisper"));
      mkdirSync(join(fallbackNative, "whisper-cuda"));
      linkSync(
        resolve("native/models/ggml-small.en-q5_1.bin"),
        join(fallbackNative, "models/ggml-small.en-q5_1.bin"),
      );
      for (const name of [
        "whisper-cli.exe",
        "whisper.dll",
        "ggml.dll",
        "ggml-base.dll",
        "ggml-cpu.dll",
      ])
        copyFileSync(
          resolve("native/whisper", name),
          join(fallbackNative, "whisper", name),
        );
      writeFileSync(
        join(fallbackNative, "whisper-cuda/whisper-cli.exe"),
        "invalid runtime fixture",
      );
      const fallback = new WhisperTranscriber(
        fallbackNative,
        join(directory, "fallback-cache"),
      );
      assert.equal(await fallback.transcribe(wave), text);
      assert.equal(fallback.performance.acceleration, "cpu");
      assert.equal(existsSync(cache), false);
      const pending = transcriber.transcribe(wave);
      await assert.rejects(transcriber.transcribe(wave), /正在轉文字/);
      setTimeout(() => transcriber.cancel(), 30);
      await assert.rejects(pending, /已取消/);
      assert.equal(existsSync(cache), false);
    } finally {
      transcriber.cancel();
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
