import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { createInterface } from "node:readline";
import { z } from "zod";
import type { SpeechEvent, SpeechInfo } from "../shared/api";
const eventSchema = z.object({
  type: z.enum([
    "listening",
    "partial",
    "final",
    "stopped",
    "error",
    "unclear",
    "speaking",
    "speak-ended",
  ]),
  text: z.string().max(10000).optional(),
  confidence: z.number().optional(),
  code: z.string().optional(),
});
const deviceError =
  "無法使用麥克風或英文語音引擎。請確認預設輸入裝置，並允許桌面應用程式存取麥克風。";
export class SpeechService {
  private recognition?: ChildProcessWithoutNullStreams;
  private playback?: ChildProcessWithoutNullStreams;
  private stopping?: Promise<void>;
  constructor(
    private nativeDirectory: string,
    private notify: (event: SpeechEvent) => void,
  ) {}
  private worker(mode: string) {
    const executable = join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    return spawn(
      executable,
      [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        join(this.nativeDirectory, "speech.ps1"),
        "-Mode",
        mode,
      ],
      { windowsHide: true, stdio: "pipe" },
    );
  }
  async info(): Promise<SpeechInfo> {
    if (process.platform !== "win32")
      return {
        available: false,
        culture: "",
        canSpeak: false,
        message: "目前麥克風辨識支援 Windows；仍可輸入英文練習。",
      };
    return new Promise((resolve) => {
      const worker = this.worker("Probe");
      let settled = false;
      const finish = (value: SpeechInfo) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        worker.kill();
        resolve(value);
      };
      const failure = {
        available: false,
        culture: "",
        canSpeak: false,
        message:
          "請在 Windows 語言設定安裝 English (United States) 的語音辨識元件，然後重新開啟 App。",
      };
      const timer = setTimeout(() => finish(failure), 15000);
      createInterface({ input: worker.stdout }).on("line", (line) => {
        try {
          const result = z
            .object({
              type: z.literal("info"),
              available: z.boolean(),
              culture: z.string(),
              canSpeak: z.boolean(),
            })
            .parse(JSON.parse(line));
          finish({
            ...result,
            message: result.available ? "英文辨識已就緒" : failure.message,
          });
        } catch {}
      });
      worker.on("error", () => finish(failure));
      worker.on("exit", () => finish(failure));
      worker.stderr.resume();
    });
  }
  async start() {
    if (this.recognition) throw new Error("麥克風正在使用中。");
    await this.stopSpeaking();
    if (process.platform !== "win32")
      throw new Error("目前麥克風辨識支援 Windows。");
    const worker = this.worker("Listen");
    this.recognition = worker;
    return new Promise<void>((resolve, reject) => {
      let ready = false;
      let failed = false;
      const fail = (message: string) => {
        if (failed) return;
        failed = true;
        this.notify({ type: "error", message });
        if (!ready) reject(new Error(message));
        worker.kill();
      };
      const timer = setTimeout(
        () => fail("啟動麥克風逾時，請檢查 Windows 麥克風權限。"),
        15000,
      );
      createInterface({ input: worker.stdout }).on("line", (line) => {
        const parsed = eventSchema.safeParse(
          (() => {
            try {
              return JSON.parse(line);
            } catch {
              return null;
            }
          })(),
        );
        if (!parsed.success) return;
        const event = parsed.data;
        if (event.type === "error") {
          clearTimeout(timer);
          fail(
            event.code === "no-english-recognizer"
              ? "請先安裝 Windows 英文語音辨識元件。"
              : deviceError,
          );
          return;
        }
        if (event.type === "listening") {
          ready = true;
          clearTimeout(timer);
          resolve();
        }
        this.notify(event);
      });
      worker.on("error", () => {
        clearTimeout(timer);
        fail(deviceError);
      });
      worker.on("exit", () => {
        clearTimeout(timer);
        if (this.recognition === worker) this.recognition = undefined;
        if (!ready && !failed) reject(new Error(deviceError));
        this.notify({ type: "stopped" });
      });
      worker.stderr.resume();
    });
  }
  async stop(): Promise<void> {
    if (this.stopping) return this.stopping;
    const worker = this.recognition;
    if (!worker) return;
    this.stopping = new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        worker.kill();
        resolve();
      }, 5000);
      worker.once("exit", () => {
        clearTimeout(timer);
        resolve();
      });
      if (!worker.stdin.destroyed) worker.stdin.end("stop\n");
      else {
        worker.kill();
        resolve();
      }
    });
    try {
      await this.stopping;
    } finally {
      this.stopping = undefined;
      if (this.recognition === worker) this.recognition = undefined;
    }
  }
  async speak(text: string) {
    await this.stop();
    await this.stopSpeaking();
    if (process.platform !== "win32")
      throw new Error("目前朗讀功能支援 Windows。");
    const worker = this.worker("Speak");
    this.playback = worker;
    return new Promise<void>((resolve, reject) => {
      let failed = false;
      const timer = setTimeout(() => {
        worker.kill();
        this.notify({ type: "error", message: "朗讀逾時，請重試。" });
      }, 120000);
      createInterface({ input: worker.stdout }).on("line", (line) => {
        try {
          const event = eventSchema.parse(JSON.parse(line));
          if (event.type === "error") {
            failed = true;
            this.notify({
              type: "error",
              message: "英文朗讀引擎無法使用，請確認 Windows 英文語音元件。",
            });
          } else this.notify(event);
        } catch {}
      });
      worker.on("error", () => {
        failed = true;
      });
      worker.on("close", () => {
        clearTimeout(timer);
        if (this.playback === worker) this.playback = undefined;
        this.notify({ type: "speak-ended" });
        if (failed) reject(new Error("無法啟動英文朗讀。"));
        else resolve();
      });
      worker.stderr.resume();
      worker.stdin.end(text);
    });
  }
  async stopSpeaking() {
    if (this.playback) {
      this.playback.kill();
      this.playback = undefined;
      this.notify({ type: "speak-ended" });
    }
  }
  dispose() {
    this.recognition?.kill();
    this.playback?.kill();
  }
}
