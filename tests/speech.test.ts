import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
test(
  "Windows native speech decodes a real English WAV without opening a microphone or speaker",
  { skip: process.platform !== "win32" },
  () => {
    const directory = mkdtempSync(join(tmpdir(), "speaking-audio-"));
    const wave = join(directory, "fixture.wav");
    const script = resolve("native/speech.ps1");
    const run = (mode: string, input = "") => {
      const result = spawnSync(
        "powershell.exe",
        [
          "-NoLogo",
          "-NoProfile",
          "-NonInteractive",
          "-ExecutionPolicy",
          "Bypass",
          "-File",
          script,
          "-Mode",
          mode,
          "-AudioFile",
          wave,
        ],
        { input, encoding: "utf8", windowsHide: true, timeout: 60000 },
      );
      assert.equal(result.status, 0, result.stderr);
      return result.stdout
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => JSON.parse(line));
    };
    try {
      const probe = run("Probe").find((event) => event.type === "info");
      assert.ok(probe);
      if (!probe.available || !probe.canSpeak) return;
      assert.ok(
        run(
          "Generate",
          "I went to the park yesterday. I enjoyed the sunny weather.",
        ).some((event) => event.type === "speak-ended"),
      );
      const result = run("File")
        .filter((event) => event.type === "final")
        .map((event) => event.text)
        .join(" ");
      assert.match(result, /park/i);
      assert.match(result, /weather/i);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
