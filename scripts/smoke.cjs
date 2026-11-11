// OAuth and AI replies are fixtures. Chromium capture + local Whisper use a real
// synthetic English WAV, never the physical microphone or speaker.
const { _electron } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const directory = path.resolve(".test-data", `desktop-${Date.now()}`);
fs.mkdirSync(directory, { recursive: true });
const audioFile = path.join(directory, "microphone.wav");
const generated = require("node:child_process").spawnSync(
  "powershell.exe",
  [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    path.resolve("native/speech.ps1"),
    "-Mode",
    "Generate",
    "-AudioFile",
    audioFile,
  ],
  {
    input: "I went to the park yesterday. I enjoyed the sunny weather.",
    encoding: "utf8",
    windowsHide: true,
    timeout: 15000,
  },
);
assert.equal(generated.status, 0, generated.stderr);
const env = { ...process.env, SPEAKING_STUDIO_TEST_DATA: directory };
delete env.ELECTRON_RUN_AS_NODE;
let app;
async function launch() {
  app = await _electron.launch({
    ...(process.env.SPEAKING_STUDIO_EXECUTABLE
      ? { executablePath: process.env.SPEAKING_STUDIO_EXECUTABLE }
      : {}),
    args: [
      ...(process.env.SPEAKING_STUDIO_EXECUTABLE ? [] : ["."]),
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${audioFile}`,
    ],
    env,
  });
  const page = await app.firstWindow();
  await page.getByRole("heading", { name: "口說練習", exact: true }).waitFor();
  return page;
}
async function fixtures() {
  await app.evaluate(({ shell, ipcMain, BrowserWindow }) => {
    const crypto = process.getBuiltinModule("node:crypto");
    const keys = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwk = keys.publicKey.export({ format: "jwk" });
    const network = globalThis.fetch;
    let nonce = "";
    globalThis.aiCalls = 0;
    globalThis.stall = false;
    globalThis.spokenReplies = [];
    ipcMain.removeHandler("speech:speak");
    ipcMain.handle("speech:speak", (_event, text) => {
      globalThis.spokenReplies.push(text);
      const contents = BrowserWindow.getAllWindows()[0].webContents;
      contents.send("speech:event", { type: "speaking" });
      contents.send("speech:event", { type: "speak-ended" });
      return { ok: true, data: undefined };
    });
    shell.openExternal = async (value) => {
      const url = new URL(value);
      if (url.hostname !== "auth.openai.com") return;
      nonce = url.searchParams.get("nonce");
      const callback = new URL(url.searchParams.get("redirect_uri"));
      callback.searchParams.set("state", url.searchParams.get("state"));
      callback.searchParams.set("code", "fixture-code");
      callback.searchParams.set("client_id", "oaiapp_speaking_fixture");
      await network(callback);
    };
    globalThis.fetch = async (value, init) => {
      const url = String(value);
      if (url.endsWith("/.well-known/jwks.json"))
        return new Response(
          JSON.stringify({
            keys: [
              { ...jwk, kid: "speaking-fixture", alg: "RS256", use: "sig" },
            ],
          }),
        );
      if (url.endsWith("/oauth/token")) {
        const header = Buffer.from(
          JSON.stringify({ alg: "RS256", kid: "speaking-fixture" }),
        ).toString("base64url");
        const payload = Buffer.from(
          JSON.stringify({
            iss: "https://auth.openai.com",
            aud: "oaiapp_speaking_fixture",
            sub: "fixture-speaker",
            email: "speaker@example.test",
            nonce,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 3600,
          }),
        ).toString("base64url");
        const signed = `${header}.${payload}`;
        const signature = crypto
          .sign("RSA-SHA256", Buffer.from(signed), keys.privateKey)
          .toString("base64url");
        return new Response(
          JSON.stringify({
            access_token: "fixture-speaking-access",
            refresh_token: "fixture-speaking-refresh",
            id_token: `${signed}.${signature}`,
            token_type: "Bearer",
            expires_in: 3600,
            scope:
              "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
          }),
        );
      }
      if (url.endsWith("/models"))
        return new Response(
          JSON.stringify({
            models: [
              {
                slug: "fixture-speaking-model",
                display_name: "測試對話模型",
                visibility: "list",
              },
            ],
          }),
        );
      if (url.endsWith("/oauth/revoke"))
        return new Response(null, { status: 200 });
      if (!url.endsWith("/responses")) throw new Error("Unexpected request");
      if (globalThis.stall) return new Promise(() => {});
      globalThis.aiCalls++;
      const body = JSON.parse(init.body);
      if (
        body.stream !== true ||
        body.store !== false ||
        body.max_output_tokens !== undefined ||
        init.headers.Authorization !== "Bearer fixture-speaking-access"
      )
        throw new Error("Invalid subscription request");
      globalThis.lastAIRequest = body;
      const text = body.input.at(-1).content;
      const error = text.includes("I go yesterday");
      const feedback = {
        replyEnglish:
          "That sounds like a lovely way to spend the day. What did you enjoy most about it?",
        replyChinese: "聽起來那是很棒的一天。你最喜歡哪個部分？",
        grammar: error
          ? {
              hasError: true,
              original: "I go yesterday",
              corrected: "I went yesterday",
              explanationEnglish:
                "Use the past tense when talking about yesterday.",
              explanationChinese: "談論昨天發生的事情時，要使用過去式。",
            }
          : {
              hasError: false,
              original: "",
              corrected: "",
              explanationEnglish: "",
              explanationChinese: "",
            },
        natural: {
          original: text,
          suggestion: error
            ? "I went there yesterday."
            : "That sounds really interesting.",
          explanationEnglish:
            "This is a natural everyday way to express the idea.",
          explanationChinese: "這是日常對話中常見的自然表達方式。",
        },
      };
      return new Response(
        "data: " +
          JSON.stringify({
            type: "response.output_text.delta",
            delta: "fixture progress",
          }) +
          "\n\ndata: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              status: "completed",
              output: [
                {
                  content: [
                    { type: "output_text", text: JSON.stringify(feedback) },
                  ],
                },
              ],
            },
          }) +
          "\n\n",
      );
    };
  });
}
(async () => {
  try {
    let page = await launch();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page
      .getByRole("button", { name: "開始一段對話 →", exact: true })
      .click();
    await page.getByRole("button", { name: "開始對話 →", exact: true }).click();
    await page.getByLabel("英文訊息").fill("I go yesterday.");
    await page.getByRole("button", { name: "送出 →", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "請先到設定使用 ChatGPT 登入" })
      .waitFor();
    assert.equal(
      await page.getByLabel("英文訊息").inputValue(),
      "I go yesterday.",
    );
    await fixtures();
    await page.getByRole("button", { name: /設定/ }).click();
    await page
      .getByRole("button", { name: "Continue with ChatGPT", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "已啟用 · 使用 ChatGPT 訂閱" })
      .waitFor();
    assert.equal(
      fs
        .readFileSync(path.join(directory, "chatgpt-session.encrypted"))
        .includes("fixture-speaking-access"),
      false,
    );
    // Refresh the real native probe after startup, separately from mic fixtures.
    await page
      .getByRole("button", { name: "重新檢查語音元件", exact: true })
      .click();
    await page
      .getByRole("status")
      .filter({ hasText: "本機 Whisper small.en 已就緒" })
      .waitFor();
    await page.getByRole("button", { name: /口說練習/ }).click();
    await page.getByLabel("英文訊息").fill("");
    const recordingStarted = Date.now();
    await page.getByRole("button", { name: "◉ 開始說話", exact: true }).click();
    await page
      .getByRole("button", { name: "■ 停止並確認文字", exact: true })
      .waitFor();
    await page.waitForFunction(
      () =>
        /park/i.test(
          document.querySelector('[aria-label="即時辨識"]')?.textContent ?? "",
        ),
      undefined,
      { timeout: 60000 },
    );
    assert.ok(
      await page
        .getByRole("button", { name: "■ 停止並確認文字", exact: true })
        .isVisible(),
    );
    console.log(
      `Live transcript fixture appeared after ${Date.now() - recordingStarted} ms`,
    );
    assert.equal(await page.getByLabel("英文訊息").inputValue(), "");
    assert.equal(await page.getByText("音量偏低", { exact: false }).count(), 0);
    assert.equal(
      await page.getByText("已收到聲音", { exact: true }).count(),
      0,
    );
    await page.screenshot({ path: path.join(directory, "microphone.png") });
    await page
      .getByRole("button", { name: "■ 停止並確認文字", exact: true })
      .click();
    await page.waitForFunction(
      () =>
        /park|sunny weather/i.test(
          document.querySelector('textarea[aria-label="英文訊息"]').value,
        ),
      undefined,
      { timeout: 120000 },
    );
    console.log(
      "PASS: real AudioWorklet PCM capture -> live Whisper text while recording -> final editable transcript; no volume warnings",
    );
    await page.getByLabel("英文訊息").fill("I go yesterday.");
    await page.getByRole("button", { name: "送出 →", exact: true }).click();
    await page.locator(".assistant-message").waitFor();
    await page.waitForFunction(async () => {
      const snapshot = await window.speakingStudio.snapshot();
      return snapshot.preferences.autoReadReplies === true;
    });
    await page.waitForFunction(() => !document.querySelector(".thinking"));
    assert.deepEqual(await app.evaluate(() => globalThis.spokenReplies), [
      "That sounds like a lovely way to spend the day. What did you enjoy most about it?",
    ]);
    await page
      .getByRole("button", { name: "收藏文法修正", exact: true })
      .click();
    await page
      .getByRole("button", { name: "收藏自然說法", exact: true })
      .click();
    let snapshot = await page.evaluate(() => window.speakingStudio.snapshot());
    assert.equal(snapshot.favorites.length, 2);
    const casual = snapshot.conversations[0];
    assert.equal(
      (await page.evaluate((id) => window.speakingStudio.turns(id), casual.id))
        .length,
      1,
    );
    await page.screenshot({ path: path.join(directory, "conversation.png") });
    await page.getByRole("button", { name: /星號收藏/ }).click();
    await page
      .locator(".favorite-card")
      .filter({ hasText: "I went yesterday" })
      .click();
    await page.getByLabel("個人筆記").fill("練習過去式");
    await page.getByLabel("收藏標籤").fill("旅行,文法");
    await page.getByRole("button", { name: "保存筆記", exact: true }).click();
    await page.getByLabel("搜尋收藏").fill("過去式");
    assert.equal(await page.locator(".favorite-card").count(), 1);
    await page.getByRole("button", { name: /設定/ }).click();
    await page.getByLabel("自動朗讀新的 AI 英文回覆").uncheck();
    await page.getByRole("button", { name: "保存設定", exact: true }).click();
    await page.waitForFunction(
      async () =>
        !(await window.speakingStudio.snapshot()).preferences.autoReadReplies,
    );
    await page
      .getByRole("button", { name: "＋ 開始新對話", exact: true })
      .click();
    await page.getByRole("button", { name: /主題對話/ }).click();
    await page.getByRole("button", { name: /旅行探索/ }).click();
    await page.getByRole("button", { name: "開始對話 →", exact: true }).click();
    await page.getByLabel("英文訊息").fill("I like traveling.");
    await page.getByRole("button", { name: "送出 →", exact: true }).click();
    await page.locator(".assistant-message").waitFor();
    assert.ok(
      (
        await app.evaluate(() => globalThis.lastAIRequest.instructions)
      ).includes("旅行探索"),
    );
    await page
      .getByText("這句文法沒有需要修正的地方。", { exact: true })
      .waitFor();
    await app.evaluate(() => {
      globalThis.stall = true;
    });
    await page.getByLabel("英文訊息").fill("I have another question.");
    await page.getByRole("button", { name: "送出 →", exact: true }).click();
    await page.getByRole("button", { name: "取消回覆", exact: true }).click();
    await page
      .getByRole("alert")
      .filter({ hasText: "已取消回覆" })
      .waitFor({ timeout: 2000 });
    await app.evaluate(() => {
      globalThis.stall = false;
    });
    await page.getByRole("button", { name: "重試回覆", exact: true }).click();
    await page.waitForFunction(
      () => document.querySelectorAll(".assistant-message").length === 2,
    );
    assert.equal(
      await app.evaluate(() => globalThis.lastAIRequest.input.length),
      3,
    );
    assert.equal(await app.evaluate(() => globalThis.spokenReplies.length), 1);
    await app.close();
    page = await launch();
    snapshot = await page.evaluate(() => window.speakingStudio.snapshot());
    assert.equal(snapshot.conversations.length, 2);
    assert.equal(snapshot.favorites.length, 2);
    assert.ok(snapshot.favorites.some((item) => item.note === "練習過去式"));
    assert.equal(snapshot.chatGPT.sharing, true);
    assert.equal(snapshot.preferences.autoReadReplies, false);
    await fixtures();
    await page.getByRole("button", { name: /設定/ }).click();
    await page.getByLabel("自動朗讀新的 AI 英文回覆").check();
    await page.getByRole("button", { name: "保存設定", exact: true }).click();
    await page.getByRole("button", { name: /口說練習/ }).click();
    assert.equal(await app.evaluate(() => globalThis.spokenReplies.length), 0);
    await page
      .getByRole("button", { name: "＋ 開始新對話", exact: true })
      .click();
    await page.getByRole("button", { name: /主題對話/ }).click();
    await page.getByLabel("自訂主題").fill("Weekend routines");
    await page.screenshot({ path: path.join(directory, "topics.png") });
    await page.getByRole("button", { name: "開始對話 →", exact: true }).click();
    assert.equal(
      (await page.evaluate(() => window.speakingStudio.snapshot()))
        .conversations[0].topic,
      "Weekend routines",
    );
    const security = await app.evaluate(({ BrowserWindow }) => {
      const preferences =
        BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
      return {
        nodeIntegration: preferences.nodeIntegration,
        contextIsolation: preferences.contextIsolation,
        sandbox: preferences.sandbox,
      };
    });
    assert.deepEqual(security, {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    });
    assert.deepEqual(errors, []);
    console.log(
      "PASS: speaking desktop OAuth/transcript review/chat/auto-read new replies/disable auto-read/no history playback/grammar/natural phrasing/favorites/notes/topics/cancel/retry/reopen/security",
    );
    console.log("Artifacts:", directory);
  } finally {
    if (app) await app.close().catch(() => {});
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
