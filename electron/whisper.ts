import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { availableParallelism } from "node:os";
import { validateWave, encodeWave, sampleRate } from "../shared/audio";

export class WhisperTranscriber {
  private worker?: ChildProcessWithoutNullStreams;
  private cancelled = false;
  private running = false;
  private gpuFailed = false;
  private lastBackend: "cuda" | "cpu" | "auto" = "auto";
  private lastDurationMs?: number;
  private warmup?: Promise<void>;
  private primed = false;
  constructor(
    private nativeDirectory: string,
    private temporaryDirectory: string,
    private useGpu = true,
  ) {}
  get performance() {
    return {
      acceleration: this.lastBackend,
      durationMs: this.lastDurationMs,
      warmingUp: !!this.warmup,
    };
  }
  private get gpuAvailable() {
    return (
      this.useGpu &&
      !this.gpuFailed &&
      existsSync(join(this.nativeDirectory, "whisper-cuda", "whisper-cli.exe"))
    );
  }
  async prepare(): Promise<void> {
    if (this.warmup) return this.warmup;
    if (this.primed || !this.ready || !this.gpuAvailable) return;
    this.cancelled = false;
    this.warmup = this.recognize(encodeWave(new Float32Array(sampleRate)), true)
      .then((result) => {
        this.lastBackend = result.gpuActive ? "cuda" : "cpu";
        if (!result.gpuActive) this.gpuFailed = true;
      })
      .catch(() => {
        if (!this.cancelled) this.gpuFailed = true;
      })
      .finally(() => {
        this.primed = !this.cancelled;
        this.warmup = undefined;
      });
    return this.warmup;
  }
  get ready() {
    return (
      process.platform === "win32" &&
      [
        "whisper-cli.exe",
        "whisper.dll",
        "ggml.dll",
        "ggml-base.dll",
        "ggml-cpu.dll",
      ].every((name) =>
        existsSync(join(this.nativeDirectory, "whisper", name)),
      ) &&
      existsSync(join(this.nativeDirectory, "models", "ggml-small.en-q5_1.bin"))
    );
  }
  async transcribe(bytes: Uint8Array): Promise<string> {
    if (this.running) throw new Error("正在轉文字，請稍候或先取消。");
    if (!this.ready)
      throw new Error(
        "本機 Whisper 模型未就緒，請重新安裝完整版本，或在開發環境執行 npm run setup:speech。",
      );
    validateWave(bytes);
    this.running = true;
    this.cancelled = false;
    const started = performance.now();
    const deadline = started + 120000;
    try {
      await this.prepare();
      if (this.cancelled) throw new Error("已取消轉文字。");
      const gpu = this.gpuAvailable;
      let result: { text: string; gpuActive: boolean };
      if (gpu) {
        try {
          result = await this.recognize(bytes, true, deadline);
          if (!result.gpuActive) this.gpuFailed = true;
        } catch (error) {
          if (this.cancelled) throw error;
          this.gpuFailed = true;
          result = await this.recognize(bytes, false, deadline);
        }
      } else result = await this.recognize(bytes, false, deadline);
      this.lastBackend = result.gpuActive ? "cuda" : "cpu";
      const text = result.text
        .replace(/\[[^\]\r\n]{0,100}\]/g, " ")
        .replace(/\s+/g, " ")
        .trim();
      if (!text) throw new Error("這段錄音沒有辨識到英文，請重試。");
      if (text.length > 6000) throw new Error("辨識文字過長，請縮短錄音。");
      this.lastDurationMs = Math.round(performance.now() - started);
      return text;
    } finally {
      this.running = false;
    }
  }
  private recognize(
    bytes: Uint8Array,
    gpu: boolean,
    deadline = performance.now() + 120000,
  ): Promise<{ text: string; gpuActive: boolean }> {
    return new Promise((resolveResult, reject) => {
      if (this.cancelled) {
        reject(new Error("已取消轉文字。"));
        return;
      }
      const runtime = gpu ? "whisper-cuda" : "whisper";
      // Relative model path + stdin avoid this native CLI's Unicode argument limitation.
      const worker = spawn(
        join(this.nativeDirectory, runtime, "whisper-cli.exe"),
        [
          "-m",
          "../models/ggml-small.en-q5_1.bin",
          "-f",
          "-",
          "-l",
          "en",
          "-t",
          String(Math.min(8, availableParallelism())),
          "-nt",
          ...(gpu ? [] : ["-ng", "--no-prints"]),
          "-of",
          "transcript",
        ],
        {
          cwd: join(this.nativeDirectory, runtime),
          windowsHide: true,
          stdio: "pipe",
        },
      );
      this.worker = worker;
      let timedOut = false;
      const timeout = setTimeout(
        () => {
          timedOut = true;
          worker.kill();
        },
        Math.max(
          1,
          Math.min(gpu ? 30000 : 120000, deadline - performance.now()),
        ),
      );
      let text = "";
      let gpuActive = false;
      worker.stdout.setEncoding("utf8");
      worker.stdout.on("data", (chunk: string) => {
        text += chunk;
        if (text.length > 64000) worker.kill();
      });
      worker.stderr.setEncoding("utf8");
      let diagnostic = "";
      worker.stderr.on("data", (chunk: string) => {
        diagnostic = (diagnostic + chunk).slice(-16000);
        if (
          /ggml_cuda_init: found [1-9]|CUDA[0-9]+.*buffer|using CUDA[0-9]+ backend/.test(
            diagnostic,
          )
        )
          gpuActive = true;
      });
      worker.stdin.on("error", () => {});
      worker.stdin.end(Buffer.from(bytes));
      worker.on("error", () => {
        clearTimeout(timeout);
        reject(
          new Error(
            "無法啟動本機 Whisper，請確認完整安裝檔與 Windows x64 執行環境。",
          ),
        );
      });
      worker.on("close", (code) => {
        clearTimeout(timeout);
        if (this.worker === worker) this.worker = undefined;
        if (this.cancelled) reject(new Error("已取消轉文字。"));
        else if (timedOut)
          reject(new Error("本機辨識超過兩分鐘，請縮短錄音後再試。"));
        else if (code !== 0)
          reject(new Error("本機 Whisper 辨識失敗，請重試或縮短錄音。"));
        else resolveResult({ text, gpuActive });
      });
    });
  }
  cancel() {
    if (!this.running) return;
    this.cancelled = true;
    this.worker?.kill();
  }
  dispose() {
    this.cancelled = true;
    this.worker?.kill();
  }
  async cleanAbandonedRecordings() {
    // Only the fixed app-owned audio cache, including recordings left by a crash.
    const target = resolve(this.temporaryDirectory);
    if (!target.endsWith(sep + "speech-cache"))
      throw new Error("Invalid speech cache path");
    await rm(target, { recursive: true, force: true });
  }
}
