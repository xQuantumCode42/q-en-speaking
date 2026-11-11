import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  safeStorage,
} from "electron";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { mkdirSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ChatGPTAuth } from "./chatgpt-auth";
import { Store } from "./store";
import { SpeechService } from "./speech";
import { WhisperTranscriber } from "./whisper";
import { maxWaveBytes } from "../shared/audio";
import { ConversationAI } from "./ai";
import { abortable } from "./abort";
import {
  id,
  conversationInputSchema,
  preferencesSchema,
  favoriteSchema,
  type Turn,
  type Favorite,
} from "../shared/schema";
import type { Reply, TalkPhase, SpeechEvent } from "../shared/api";

app.setName("Speaking Studio");
if (process.env.SPEAKING_STUDIO_TEST_DATA)
  app.setPath("userData", process.env.SPEAKING_STUDIO_TEST_DATA);
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
let window: BrowserWindow;
let store: Store;
let auth: ChatGPTAuth;
let speech: SpeechService;
let whisper: WhisperTranscriber;
let closing = false;
let active:
  | { controller: AbortController; turnId: string; conversationId: string }
  | undefined;
const ai = new ConversationAI();
function emit(channel: string, value: unknown) {
  if (window && !window.isDestroyed()) window.webContents.send(channel, value);
}
function allowedPage() {
  return process.env.SPEAKING_STUDIO_DEV === "1"
    ? "http://127.0.0.1:5174/"
    : pathToFileURL(join(__dirname, "../../dist/index.html")).href;
}
function verifySender(event: Electron.IpcMainInvokeEvent) {
  if (
    !window ||
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("未授權的視窗請求。");
  const allowed = allowedPage();
  if (event.senderFrame.url !== allowed) throw new Error("未授權的頁面來源。");
}
function register<T>(
  channel: string,
  schema: z.ZodType<T>,
  operation: (input: T) => unknown,
) {
  ipcMain.handle(channel, async (event, input): Promise<Reply<unknown>> => {
    try {
      verifySender(event);
      return { ok: true, data: await operation(schema.parse(input)) };
    } catch (error) {
      return {
        ok: false,
        error:
          error instanceof z.ZodError
            ? "資料格式不正確，請檢查輸入。"
            : error instanceof Error
              ? error.name === "TimeoutError"
                ? "連線逾時，請重試。"
                : error.message
              : "操作失敗，請重試。",
      };
    }
  });
}
function requireIdle() {
  if (active) throw new Error("請等待回覆完成，或先取消目前的回覆。");
}
async function chooseModel() {
  const state = await auth.session();
  if (!state.sharing) return;
  const models = await auth.models();
  if (!models.length)
    throw new Error("目前帳戶沒有可用模型，請確認 ChatGPT 訂閱授權。");
  const preferences = store.preferences();
  if (!models.some((model) => model.slug === preferences.model))
    store.savePreferences({ ...preferences, model: models[0].slug });
}
async function answer(turn: Turn): Promise<Turn> {
  requireIdle();
  const controller = new AbortController();
  active = { controller, turnId: turn.id, conversationId: turn.conversationId };
  let phase: TalkPhase = "authorizing";
  let lastSent = 0;
  const progress = (next: TalkPhase, characters: number) => {
    const changed = phase !== next;
    phase = next;
    if (!changed && Date.now() - lastSent < 200) return;
    lastSent = Date.now();
    emit("talk:progress", {
      conversationId: turn.conversationId,
      phase,
      characters,
    });
  };
  const timer = setTimeout(
    () =>
      controller.abort(
        new Error("AI 回覆超過 90 秒，英文訊息已保留，可按重試。"),
      ),
    90000,
  );
  try {
    progress("authorizing", 0);
    const token = await abortable(auth.accessToken(), controller.signal);
    const feedback = await abortable(
      ai.reply(
        store.conversation(turn.conversationId),
        store.turns(turn.conversationId),
        turn.userText,
        turn.model,
        token,
        controller.signal,
        progress,
      ),
      controller.signal,
    );
    controller.signal.throwIfAborted();
    const completed: Turn = {
      ...turn,
      status: "completed",
      feedback,
      error: "",
    };
    store.saveTurn(completed);
    return completed;
  } catch (error) {
    if (!closing)
      store.saveTurn({
        ...turn,
        status: "failed",
        error: error instanceof Error ? error.message : "回覆失敗，可按重試。",
      });
    throw error;
  } finally {
    clearTimeout(timer);
    active = undefined;
  }
}
function handlers() {
  register("snapshot", z.undefined(), async () => ({
    conversations: store.conversations(),
    favorites: store.favorites(),
    preferences: store.preferences(),
    chatGPT: await auth.session(),
    dataPath: app.getPath("userData"),
  }));
  register("conversation:create", conversationInputSchema, (input) => {
    requireIdle();
    return store.create(
      input.mode,
      input.mode === "casual" ? "" : input.topic,
      input.guided,
    );
  });
  register(
    "conversation:guidance",
    z.object({ id, guided: z.boolean() }).strict(),
    (input) => {
      requireIdle();
      return store.setGuided(input.id, input.guided);
    },
  );
  register("conversation:turns", id, (value) => store.turns(value));
  register("conversation:delete", id, (value) => {
    requireIdle();
    store.deleteConversation(value);
  });
  register(
    "talk:send",
    z
      .object({ conversationId: id, text: z.string().trim().min(1).max(6000) })
      .strict(),
    async (input) => {
      requireIdle();
      await speech.stop();
      requireIdle();
      const last = store.turns(input.conversationId).at(-1);
      const model = store.preferences().model;
      const turn =
        last?.status === "failed"
          ? {
              ...last,
              userText: input.text,
              status: "pending" as const,
              error: "",
              feedback: null,
              model,
            }
          : store.newTurn(input.conversationId, input.text, model);
      if (last?.status === "failed") store.saveTurn(turn);
      return answer(turn);
    },
  );
  register("talk:retry", id, (turnId) => {
    requireIdle();
    const old = store.turn(turnId);
    if (old.status === "completed") return old;
    if (store.turns(old.conversationId).at(-1)?.id !== turnId)
      throw new Error("請在最後一則訊息繼續對話。");
    const turn: Turn = {
      ...old,
      status: "pending",
      error: "",
      feedback: null,
      model: store.preferences().model,
    };
    store.saveTurn(turn);
    return answer(turn);
  });
  register("talk:cancel", z.undefined(), () =>
    active?.controller.abort(
      new Error("已取消回覆，英文訊息已保留，可按重試。"),
    ),
  );
  register(
    "favorite:add",
    z
      .object({ turnId: id, kind: z.enum(["grammar", "natural", "reply"]) })
      .strict(),
    (input) => {
      const existing = store
        .favorites()
        .find(
          (favorite) =>
            favorite.turnId === input.turnId && favorite.kind === input.kind,
        );
      if (existing) return existing;
      const turn = store.turn(input.turnId);
      if (!turn.feedback || turn.status !== "completed")
        throw new Error("回覆完成後才能收藏。");
      const feedback = turn.feedback;
      const conversation = store.conversation(turn.conversationId);
      if (input.kind === "grammar" && !feedback.grammar.hasError)
        throw new Error("這句沒有需要收藏的文法修正。");
      const favorite: Favorite = {
        id: randomUUID(),
        turnId: turn.id,
        conversationId: turn.conversationId,
        kind: input.kind,
        topic: conversation.topic || "日常閒聊",
        original:
          input.kind === "reply"
            ? turn.userText
            : input.kind === "grammar"
              ? feedback.grammar.original
              : feedback.natural.original,
        suggestion:
          input.kind === "reply"
            ? feedback.replyEnglish
            : input.kind === "grammar"
              ? feedback.grammar.corrected
              : feedback.natural.suggestion,
        explanationEnglish:
          input.kind === "reply"
            ? ""
            : input.kind === "grammar"
              ? feedback.grammar.explanationEnglish
              : feedback.natural.explanationEnglish,
        explanationChinese:
          input.kind === "reply"
            ? feedback.replyChinese
            : input.kind === "grammar"
              ? feedback.grammar.explanationChinese
              : feedback.natural.explanationChinese,
        note: "",
        tags: [],
        createdAt: new Date().toISOString(),
      };
      store.saveFavorite(favorite);
      return favorite;
    },
  );
  register("favorite:save", favoriteSchema, (value) =>
    store.saveFavorite(value),
  );
  register("favorite:remove", id, (value) => store.deleteFavorite(value));
  register("settings:save", preferencesSchema, (value) =>
    store.savePreferences(value),
  );
  register(
    "auth:sign-in",
    z
      .object({
        profileId: id.optional(),
        enableSharing: z.boolean().optional(),
      })
      .strict()
      .optional(),
    async (value) => {
      requireIdle();
      await speech.stop();
      await auth.signIn(value);
      await chooseModel();
    },
  );
  register("auth:cancel", z.undefined(), () => auth.cancelSignIn());
  register("auth:select", id, async (value) => {
    requireIdle();
    await auth.selectAccount(value);
    await chooseModel();
  });
  register("auth:sign-out", z.undefined(), () => {
    requireIdle();
    return auth.signOut();
  });
  register("auth:models", z.undefined(), () => auth.models());
  register("auth:usage", z.undefined(), () =>
    shell.openExternal("https://chatgpt.com/settings/usage"),
  );
  register("speech:info", z.undefined(), async () => ({
    ...(await speech.info()),
    available: whisper.ready,
    culture: "en",
    ...whisper.performance,
    message: whisper.ready
      ? "本機 Whisper small.en 已就緒"
      : "本機 Whisper 模型未就緒，請安裝完整版本，或執行 npm run setup:speech。",
  }));
  register(
    "speech:transcribe",
    z
      .instanceof(Uint8Array)
      .refine((value) => value.byteLength <= maxWaveBytes),
    async (value) => {
      requireIdle();
      await speech.stopSpeaking();
      return whisper.transcribe(value);
    },
  );
  register("speech:cancel-transcription", z.undefined(), () =>
    whisper.cancel(),
  );
  register("speech:speak", z.string().trim().min(1).max(6000), (text) =>
    speech.speak(text),
  );
  register("speech:silence", z.undefined(), () => speech.stopSpeaking());
  register("speech:settings", z.undefined(), () =>
    shell.openExternal("ms-settings:privacy-microphone"),
  );
}
app.on("second-instance", () => {
  if (window) {
    if (window.isMinimized()) window.restore();
    window.focus();
  }
});
app.whenReady().then(async () => {
  if (!primary) return;
  mkdirSync(app.getPath("userData"), { recursive: true });
  store = new Store(join(app.getPath("userData"), "speaking-studio.sqlite"));
  const secure = async () =>
    (await safeStorage.isAsyncEncryptionAvailable()) &&
    !(
      process.platform === "linux" &&
      safeStorage.getSelectedStorageBackend() === "basic_text"
    );
  auth = new ChatGPTAuth(app.getPath("userData"), {
    openBrowser: (url) => shell.openExternal(url),
    encrypt: async (text) => {
      if (!(await secure())) throw new Error("作業系統安全儲存無法使用。");
      return safeStorage.encryptStringAsync(text);
    },
    decrypt: async (buffer) => {
      if (!(await secure())) throw new Error("作業系統安全儲存無法使用。");
      return (await safeStorage.decryptStringAsync(buffer)).result;
    },
  });
  speech = new SpeechService(
    app.isPackaged
      ? join(process.resourcesPath, "native")
      : join(__dirname, "../../native"),
    (event: SpeechEvent) => emit("speech:event", event),
  );
  whisper = new WhisperTranscriber(
    app.isPackaged
      ? join(process.resourcesPath, "native")
      : join(__dirname, "../../native"),
    join(app.getPath("userData"), "speech-cache"),
  );
  await whisper.cleanAbandonedRecordings();
  void whisper.prepare();
  session.defaultSession.setPermissionCheckHandler(
    (contents, permission, _origin, details) =>
      permission === "media" &&
      contents === window?.webContents &&
      details.isMainFrame &&
      details.mediaType === "audio" &&
      contents?.mainFrame.url === allowedPage(),
  );
  session.defaultSession.setPermissionRequestHandler(
    (contents, permission, callback, details) =>
      callback(
        permission === "media" &&
          contents === window?.webContents &&
          details.isMainFrame &&
          details.requestingUrl === allowedPage() &&
          "mediaTypes" in details &&
          !!details.mediaTypes?.length &&
          details.mediaTypes.every((type) => type === "audio"),
      ),
  );
  window = new BrowserWindow({
    width: 1460,
    height: 960,
    minWidth: 1100,
    minHeight: 730,
    title: "Speaking Studio",
    backgroundColor: "#f6f5fa",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  window.removeMenu();
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  handlers();
  if (process.env.SPEAKING_STUDIO_DEV === "1")
    void window.loadURL("http://127.0.0.1:5174/");
  else void window.loadFile(join(__dirname, "../../dist/index.html"));
});
app.on("window-all-closed", () => app.quit());
app.on("before-quit", () => {
  closing = true;
  active?.controller.abort(new Error("App 已關閉。"));
  auth?.cancelSignIn();
  speech?.dispose();
  whisper?.dispose();
  store?.close();
});
