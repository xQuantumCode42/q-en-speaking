import { useEffect, useRef, useState } from "react";
import type {
  Conversation,
  Turn,
  Favorite,
  Preferences,
} from "../shared/schema";
import { topics, defaultPreferences } from "../shared/schema";
import { openingExercise } from "../shared/guidance";
import { GuidanceCard } from "./GuidanceCard";
import type {
  Snapshot,
  SpeechInfo,
  Progress,
  ChatGPTModel,
} from "../shared/api";

const api = window.speakingStudio;
import {
  MicrophoneCapture,
  microphoneDevices,
  type MicrophoneDevice,
} from "./microphone";
const feedbackLabels = {
  grammar: "文法修正",
  natural: "自然說法",
  reply: "對話回覆",
};
const phaseLabels = {
  authorizing: "確認訂閱授權",
  connecting: "連線 ChatGPT",
  reasoning: "整理對話語境",
  generating: "產生回覆與建議",
  validating: "驗證回覆內容",
};
export default function App() {
  const [data, setData] = useState<Snapshot>();
  const [page, setPage] = useState<"practice" | "favorites" | "settings">(
    "practice",
  );
  const [activeId, setActiveId] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [newConversation, setNewConversation] = useState(false);
  const [deleteId, setDeleteId] = useState("");
  const [busy, setBusy] = useState(false);
  const [guidanceSaving, setGuidanceSaving] = useState(false);
  const [progress, setProgress] = useState<Progress>();
  const [elapsed, setElapsed] = useState(0);
  const [speech, setSpeech] = useState<SpeechInfo>();
  const [listening, setListening] = useState(false);
  const [micBusy, setMicBusy] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [inputLevel, setInputLevel] = useState(0);
  const [liveText, setLiveText] = useState("");
  const [liveError, setLiveError] = useState("");
  const previewAllowed = useRef(false);
  const previewPending = useRef<Promise<void> | undefined>(undefined);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [speaking, setSpeaking] = useState(false);
  const [focusedTurn, setFocusedTurn] = useState("");
  const [search, setSearch] = useState("");
  const [tag, setTag] = useState("");
  const [editing, setEditing] = useState<Favorite>();
  const current = useRef(activeId);
  current.current = activeId;
  const capture = useRef(new MicrophoneCapture());
  const audioGeneration = useRef(0);
  const lastRecording = useRef<Uint8Array | undefined>(undefined);
  const request = useRef(false);
  const drafts = useRef(new Map<string, string>());
  const transcript = useRef<HTMLDivElement>(null);
  const conversation = data?.conversations.find((item) => item.id === activeId);
  const preferences = data?.preferences ?? defaultPreferences;
  const latestReply = [...turns]
    .reverse()
    .find((turn) => turn.status === "completed");
  const opening = conversation?.guided
    ? openingExercise(conversation)
    : undefined;
  const selectedTurn =
    turns.find((turn) => turn.id === focusedTurn) ??
    [...turns].reverse().find((turn) => turn.status === "completed");
  async function refresh() {
    const snapshot = await api.snapshot();
    setData(snapshot);
    return snapshot;
  }
  async function changeGuided(guided: boolean) {
    if (!conversation || guidanceSaving) return;
    const { id, guided: previous } = conversation;
    setGuidanceSaving(true);
    setData(
      (snapshot) =>
        snapshot && {
          ...snapshot,
          conversations: snapshot.conversations.map((item) =>
            item.id === id ? { ...item, guided } : item,
          ),
        },
    );
    try {
      await api.setGuided({ id, guided });
      await refresh();
    } catch (error) {
      setData(
        (snapshot) =>
          snapshot && {
            ...snapshot,
            conversations: snapshot.conversations.map((item) =>
              item.id === id ? { ...item, guided: previous } : item,
            ),
          },
      );
      throw error;
    } finally {
      setGuidanceSaving(false);
    }
  }
  async function run(operation: () => Promise<unknown>) {
    setError("");
    try {
      await operation();
    } catch (error) {
      setError((error as Error).message);
    }
  }
  function changeDraft(value: string) {
    setDraft(value);
    drafts.current.set(current.current, value);
  }
  useEffect(() => {
    void microphoneDevices()
      .then(setMicrophones)
      .catch(() => {});
    void run(async () => {
      const snapshot = await refresh();
      if (snapshot.conversations.length)
        setActiveId(snapshot.conversations[0].id);
    });
    void api
      .speechInfo()
      .then(setSpeech)
      .catch((error) =>
        setSpeech({
          available: false,
          culture: "",
          canSpeak: false,
          message: error.message,
        }),
      );
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences.theme]);
  useEffect(
    () =>
      api.onSpeech((event) => {
        if (event.type === "error") {
          setSpeaking(false);
          setError(event.message ?? "語音裝置無法使用。");
        }
        if (event.type === "speaking") setSpeaking(true);
        if (event.type === "speak-ended") setSpeaking(false);
      }),
    [],
  );
  useEffect(
    () =>
      api.onProgress((value) => {
        if (value.conversationId === current.current) setProgress(value);
      }),
    [],
  );
  useEffect(() => {
    if (!activeId) return;
    setTurns([]);
    setFocusedTurn("");
    setDraft(drafts.current.get(activeId) ?? "");
    void run(async () => {
      const result = await api.turns(activeId);
      if (current.current === activeId) setTurns(result);
    });
  }, [activeId]);
  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [busy]);
  useEffect(() => {
    if (!listening) return;
    const started = Date.now();
    const timer = setInterval(
      () => setRecordingSeconds(Math.floor((Date.now() - started) / 1000)),
      250,
    );
    return () => clearInterval(timer);
  }, [listening]);
  useEffect(
    () => () => {
      void capture.current.cancel();
      void api.cancelTranscription();
    },
    [],
  );
  useEffect(() => {
    const element = transcript.current;
    if (!element) return;
    if (!turns.length) {
      element.scrollTop = 0;
      return;
    }
    const latest = turns.at(-1);
    const reply =
      conversation?.guided && latest?.status === "completed"
        ? element.querySelector<HTMLElement>(`[data-reply-id="${latest.id}"]`)
        : null;
    // Keep the new question visible instead of jumping below its long guide.
    element.scrollTop = reply
      ? element.scrollTop +
        reply.getBoundingClientRect().top -
        element.getBoundingClientRect().top
      : element.scrollHeight;
  }, [turns, progress, conversation?.guided]);
  async function stopAudio() {
    audioGeneration.current++;
    previewAllowed.current = false;
    setLiveText("");
    setLiveError("");
    lastRecording.current = undefined;
    await capture.current.cancel();
    await api.cancelTranscription();
    await previewPending.current;
    await api.stopSpeaking();
    setListening(false);
    setTranscribing(false);
    setInputLevel(0);
    setSpeaking(false);
  }
  async function navigate(next: typeof page, id?: string) {
    await stopAudio();
    if (id) setActiveId(id);
    setPage(next);
    setError("");
    setSearch("");
  }
  async function mic() {
    if (micBusy) return;
    setMicBusy(true);
    setError("");
    try {
      if (listening) await finishRecording();
      else {
        lastRecording.current = undefined;
        setLiveText("");
        setLiveError("");
        const generation = ++audioGeneration.current;
        const id = current.current;
        previewAllowed.current = true;
        await api.stopSpeaking();
        await capture.current.start(
          preferences.microphoneId,
          setInputLevel,
          () => {
            void finishRecording();
          },
          (wave) => previewRecording(wave, generation, id),
        );
        if (audioGeneration.current !== generation) {
          await capture.current.cancel();
          return;
        }
        setRecordingSeconds(0);
        setListening(true);
        void microphoneDevices()
          .then(setMicrophones)
          .catch(() => {});
      }
    } catch (error) {
      previewAllowed.current = false;
      setListening(false);
      const name = (error as Error).name;
      setError(
        name === "NotAllowedError"
          ? "麥克風權限遭拒，請允許桌面應用程式使用麥克風。"
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? "找不到選定的麥克風，請改選其他輸入裝置。"
            : (error as Error).message,
      );
    } finally {
      setMicBusy(false);
    }
  }
  function previewRecording(
    wave: Uint8Array,
    generation: number,
    id: string,
  ): boolean {
    if (
      !previewAllowed.current ||
      previewPending.current ||
      generation !== audioGeneration.current
    )
      return false;
    let pending!: Promise<void>;
    pending = (async () => {
      try {
        const text = await api.transcribe(wave);
        if (
          previewAllowed.current &&
          generation === audioGeneration.current &&
          id === current.current
        ) {
          setLiveText(text);
          setLiveError("");
        }
      } catch {
        if (previewAllowed.current && generation === audioGeneration.current)
          setLiveError("即時辨識尚未完成，停止後會再確認完整文字。");
      } finally {
        if (previewPending.current === pending)
          previewPending.current = undefined;
      }
    })();
    previewPending.current = pending;
    return true;
  }
  async function transcribeRecording(
    wave: Uint8Array,
    generation = audioGeneration.current,
    id = current.current,
  ) {
    setTranscribing(true);
    setError("");
    try {
      const text = await api.transcribe(wave);
      if (generation !== audioGeneration.current || id !== current.current)
        return;
      const value = [drafts.current.get(id) ?? "", text]
        .filter(Boolean)
        .join(" ");
      if (value.length > 6000)
        throw new Error(
          "辨識後文字超過 6000 字，請先縮短輸入框內的內容，再重試轉文字。",
        );
      changeDraft(value);
      setLiveText("");
      setLiveError("");
      lastRecording.current = undefined;
      setNotice("已轉成文字，請確認內容後再送出。");
    } catch (error) {
      if (generation === audioGeneration.current)
        setError((error as Error).message);
    } finally {
      if (generation === audioGeneration.current) setTranscribing(false);
    }
  }
  async function finishRecording() {
    const generation = audioGeneration.current;
    const id = current.current;
    previewAllowed.current = false;
    setListening(false);
    setTranscribing(true);
    setInputLevel(0);
    try {
      const wave = await capture.current.finish();
      if (generation !== audioGeneration.current) return;
      lastRecording.current = wave;
      if (previewPending.current) {
        await api.cancelTranscription();
        await previewPending.current;
      }
      if (generation !== audioGeneration.current) return;
      await transcribeRecording(wave, generation, id);
    } catch (error) {
      if (generation === audioGeneration.current) {
        setTranscribing(false);
        setError((error as Error).message);
      }
    }
  }
  async function respond(retryId?: string) {
    if (listening || transcribing || micBusy) {
      setNotice("請先停止錄音，等待轉文字完成並確認英文內容，再送出。");
      return;
    }
    if (request.current || !conversation || (!retryId && !draft.trim())) return;
    request.current = true;
    setBusy(true);
    setElapsed(0);
    setError("");
    setProgress({
      conversationId: conversation.id,
      phase: "authorizing",
      characters: 0,
    });
    const id = conversation.id;
    const text = draft.trim();
    try {
      await stopAudio();
      const promise = retryId
        ? api.retry(retryId)
        : api.send({ conversationId: id, text });
      // Keep early failures handled while reading the persisted user message.
      void promise.catch(() => {});
      const optimistic = await api.turns(id);
      if (current.current === id) setTurns(optimistic);
      const result = await promise;
      if (current.current === id) {
        setTurns(await api.turns(id));
        setFocusedTurn(result.id);
        changeDraft("");
      }
      await refresh();
      if (
        current.current === id &&
        preferences.autoReadReplies &&
        result.feedback
      ) {
        // Playback belongs to this newly completed request, never history loading.
        void readAloud(result.feedback.replyEnglish);
      }
    } catch (error) {
      setError((error as Error).message);
      try {
        if (current.current === id) setTurns(await api.turns(id));
        await refresh();
      } catch {}
    } finally {
      request.current = false;
      setBusy(false);
    }
  }
  async function star(turn: Turn, kind: Favorite["kind"]) {
    await run(async () => {
      const existing = data?.favorites.find(
        (item) => item.turnId === turn.id && item.kind === kind,
      );
      if (existing) {
        await api.removeFavorite(existing.id);
        setNotice("已取消收藏。");
      } else {
        await api.favorite({ turnId: turn.id, kind });
        setNotice("已收藏，可到星號收藏加入筆記。");
      }
      await refresh();
    });
  }
  function starred(turnId: string, kind: Favorite["kind"]) {
    return (
      data?.favorites.some(
        (item) => item.turnId === turnId && item.kind === kind,
      ) ?? false
    );
  }
  async function savePreferences(value: Preferences) {
    await api.settings(value);
    await refresh();
  }
  async function readAloud(text: string) {
    setSpeaking(true);
    await run(async () => {
      try {
        await api.speak(text);
      } finally {
        setSpeaking(false);
      }
    });
  }
  const favorites =
    data?.favorites.filter(
      (item) =>
        (
          item.original +
          " " +
          item.suggestion +
          " " +
          item.topic +
          " " +
          item.note +
          " " +
          item.tags.join(" ")
        )
          .toLowerCase()
          .includes(search.toLowerCase()) &&
        (!tag || item.tags.includes(tag)),
    ) ?? [];
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-mark">
            s<span>·</span>
          </span>
          <div>
            Speaking Studio<small>說出想法，自然一點。</small>
          </div>
        </div>
        <button
          className="primary new-button"
          disabled={busy}
          onClick={() =>
            void run(async () => {
              await stopAudio();
              setNewConversation(true);
            })
          }
        >
          ＋ 開始新對話
        </button>
        <nav>
          <button
            className={page === "practice" ? "nav active" : "nav"}
            disabled={busy}
            onClick={() => void run(() => navigate("practice"))}
          >
            <span>◌</span>口說練習
          </button>
          <button
            className={page === "favorites" ? "nav active" : "nav"}
            disabled={busy}
            onClick={() => void run(() => navigate("favorites"))}
          >
            <span>☆</span>星號收藏<b>{data?.favorites.length ?? 0}</b>
          </button>
          <button
            className={page === "settings" ? "nav active" : "nav"}
            disabled={busy}
            onClick={() => void run(() => navigate("settings"))}
          >
            <span>⚙</span>設定
          </button>
        </nav>
        <div className="nav-label">最近的對話</div>
        <div className="history-list">
          {data?.conversations.map((item) => (
            <div
              className={
                "history-entry " +
                (page === "practice" && item.id === activeId ? "selected" : "")
              }
              key={item.id}
            >
              <button
                disabled={busy}
                onClick={() => void run(() => navigate("practice", item.id))}
              >
                <small>
                  {item.mode === "casual" ? "FREE TALK" : "TOPIC TALK"}
                </small>
                <strong>{item.title}</strong>
                <span>
                  {new Date(item.updatedAt).toLocaleDateString("zh-TW")}
                </span>
              </button>
              <button
                className="history-delete"
                aria-label={`刪除對話 ${item.title}`}
                disabled={busy}
                onClick={() => setDeleteId(item.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="sidebar-foot">
          <i /> 本機保存對話與收藏
          <small>
            {data?.chatGPT.sharing
              ? "ChatGPT 訂閱已連線"
              : "登入 ChatGPT 後開始對話"}
          </small>
        </div>
      </aside>
      <main className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">YOUR ENGLISH, IN YOUR OWN WORDS</span>
            <h1>
              {page === "practice"
                ? "口說練習"
                : page === "favorites"
                  ? "星號收藏"
                  : "設定"}
            </h1>
          </div>
          <div className="top-actions">
            <button
              onClick={() =>
                void run(() =>
                  savePreferences({
                    ...preferences,
                    theme: preferences.theme === "light" ? "dark" : "light",
                  }),
                )
              }
            >
              {preferences.theme === "light" ? "☾ 深色" : "☀ 淺色"}
            </button>
            <span
              className={
                "account-status " + (data?.chatGPT.sharing ? "connected" : "")
              }
            >
              ● {data?.chatGPT.sharing ? "使用 ChatGPT 訂閱" : "尚未連線"}
            </span>
          </div>
        </header>
        {error && (
          <div className="banner error" role="alert">
            {error}
            <button onClick={() => setError("")}>關閉</button>
          </div>
        )}
        {notice && (
          <div className="banner" role="status">
            {notice}
            <button onClick={() => setNotice("")}>關閉</button>
          </div>
        )}
        {!data ? (
          <div className="empty">正在開啟練習空間…</div>
        ) : page === "settings" ? (
          <Settings
            data={data}
            speech={speech}
            onRefresh={async () => {
              await refresh();
            }}
            onPreferences={savePreferences}
            onError={setError}
            onProbe={async () => setSpeech(await api.speechInfo())}
          />
        ) : page === "favorites" ? (
          <section className="favorites-page">
            <div className="section-heading">
              <div>
                <span className="eyebrow">WORDS WORTH KEEPING</span>
                <h2>把好的說法，變成自己的。</h2>
                <p>留住文法修正、自然表達與值得再說一次的回覆。</p>
              </div>
              <span>{data.favorites.length} 筆收藏</span>
            </div>
            <div className="search-row">
              <input
                aria-label="搜尋收藏"
                placeholder="搜尋英文、中文、主題或筆記…"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              <select
                aria-label="標籤篩選"
                value={tag}
                onChange={(event) => setTag(event.target.value)}
              >
                <option value="">所有標籤</option>
                {Array.from(
                  new Set(data.favorites.flatMap((item) => item.tags)),
                ).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </div>
            <div className="favorite-grid">
              {favorites.map((item) => (
                <button
                  className="favorite-card"
                  key={item.id}
                  onClick={() => setEditing(item)}
                >
                  <span className="card-kicker">
                    ★ {feedbackLabels[item.kind]} · {item.topic}
                  </span>
                  <blockquote>{item.suggestion}</blockquote>
                  <p className="muted">{item.explanationChinese}</p>
                  <small>原句：{item.original}</small>
                  <div className="tags">
                    {item.tags.map((value) => (
                      <span key={value}>{value}</span>
                    ))}
                  </div>
                  {item.note && <p className="note-preview">{item.note}</p>}
                </button>
              ))}
            </div>
            {!favorites.length && (
              <div className="empty">
                <span>☆</span>
                <h3>
                  {search || tag ? "找不到符合的收藏" : "讓每次練習都有累積。"}
                </h3>
                <p>對話後按星號，保存對您有幫助的建議。</p>
              </div>
            )}
          </section>
        ) : !conversation ? (
          <section className="welcome">
            <div className="voice-orb">
              <span />
              <span />
              <span />
              <span />
              <span />
            </div>
            <span className="eyebrow">SMALL CONVERSATIONS. REAL PROGRESS.</span>
            <h2>把想法，說成英文。</h2>
            <p>
              從今天的小事聊起，或選一個想練習的主題。
              <br />
              練習表達，也學會更自然的說法。
            </p>
            <button
              className="primary hero-button"
              onClick={() => setNewConversation(true)}
            >
              開始一段對話 →
            </button>
            <div className="welcome-features">
              <span>◌ 英文語音辨識</span>
              <span>✧ 即時對話建議</span>
              <span>☆ 收藏練習成果</span>
            </div>
            {!data.chatGPT.sharing && (
              <button
                className="text-button"
                onClick={() => setPage("settings")}
              >
                先連接 ChatGPT 訂閱 →
              </button>
            )}
          </section>
        ) : (
          <div className="practice-layout">
            <section className="chat-panel">
              <div className="conversation-bar">
                <div>
                  <span className="topic-pill">
                    {conversation.mode === "casual"
                      ? "◌ 日常閒聊"
                      : "✧ 主題練習"}
                  </span>
                  <strong>{conversation.title}</strong>
                </div>
                <label className="translation-toggle">
                  <input
                    type="checkbox"
                    aria-label="本次對話的引導模式"
                    checked={conversation.guided}
                    disabled={busy || guidanceSaving}
                    onChange={(event) =>
                      void run(() => changeGuided(event.target.checked))
                    }
                  />
                  引導式對話
                </label>
                <label className="translation-toggle">
                  <input
                    type="checkbox"
                    checked={preferences.showChinese}
                    onChange={(event) =>
                      void run(() =>
                        savePreferences({
                          ...preferences,
                          showChinese: event.target.checked,
                        }),
                      )
                    }
                  />
                  中譯輔助
                </label>
              </div>
              <div className="transcript" ref={transcript}>
                {opening && !latestReply && (
                  <div className="guided-opening">
                    <span className="eyebrow">開場練習 · 內建題目</span>
                    <h2 lang="en">{opening.questionEnglish}</h2>
                    <p className="muted">{opening.questionChinese}</p>
                    <GuidanceCard
                      key={conversation.id}
                      guidance={opening.guidance}
                    />
                  </div>
                )}
                {!turns.length && !opening && (
                  <div className="conversation-intro">
                    <span className="mini-orb">✧</span>
                    <h2>
                      {conversation.mode === "casual"
                        ? "今天，有什麼想聊的？"
                        : `一起聊聊 ${conversation.topic}`}
                    </h2>
                    <p>
                      按下麥克風說英文，或直接輸入。
                      <br />
                      確認文字後送出，AI 會延續對話並提供表達建議。
                    </p>
                    <small>
                      練習提示：
                      {conversation.mode === "casual"
                        ? "從今天發生的一件小事開始。"
                        : "可以先說說您的經驗或想法。"}
                    </small>
                  </div>
                )}
                {turns.map((turn) => (
                  <div className="turn" key={turn.id}>
                    <div className="user-message">
                      <span className="message-label">YOU</span>
                      <p>{turn.userText}</p>
                    </div>
                    {turn.feedback && (
                      <div
                        data-reply-id={turn.id}
                        className={
                          "assistant-message " +
                          (selectedTurn?.id === turn.id ? "focused" : "")
                        }
                        onClick={() => setFocusedTurn(turn.id)}
                      >
                        <div className="assistant-label">
                          <span className="assistant-avatar">✧</span>
                          <strong>Speaking partner</strong>
                          <span className="saved-label">已保存</span>
                        </div>
                        <p className="reply-english">
                          {turn.feedback.replyEnglish}
                        </p>
                        {preferences.showChinese && (
                          <p className="reply-chinese">
                            {turn.feedback.replyChinese}
                          </p>
                        )}
                        <div className="message-actions">
                          <button
                            className={
                              starred(turn.id, "reply") ? "starred" : ""
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              void star(turn, "reply");
                            }}
                          >
                            {starred(turn.id, "reply")
                              ? "★ 已收藏"
                              : "☆ 收藏回覆"}
                          </button>
                          <button
                            disabled={
                              !speech?.canSpeak ||
                              speaking ||
                              listening ||
                              transcribing
                            }
                            onClick={(event) => {
                              event.stopPropagation();
                              void readAloud(turn.feedback!.replyEnglish);
                            }}
                          >
                            ▷ 聆聽回覆
                          </button>
                          <button onClick={() => setFocusedTurn(turn.id)}>
                            查看練習建議 →
                          </button>
                        </div>
                        {conversation.guided &&
                          latestReply?.id === turn.id &&
                          (turn.feedback.guidance ? (
                            <GuidanceCard
                              key={turn.id}
                              guidance={turn.feedback.guidance}
                            />
                          ) : (
                            <p className="guidance-pending">
                              引導式對話已開啟，從下一次 AI
                              回覆開始顯示回答引導。
                            </p>
                          ))}
                      </div>
                    )}
                    {turn.status === "failed" && (
                      <div className="failed-turn">
                        <p>{turn.error}</p>
                        <button
                          disabled={busy}
                          onClick={() => void respond(turn.id)}
                        >
                          重試回覆
                        </button>
                        <button
                          disabled={busy}
                          onClick={() => changeDraft(turn.userText)}
                        >
                          修改後重送
                        </button>
                      </div>
                    )}
                  </div>
                ))}
                {busy && (
                  <div className="thinking" role="status">
                    <span className="pulse-dot" />
                    {phaseLabels[progress?.phase ?? "connecting"]} · {elapsed}{" "}
                    秒
                    {progress?.characters
                      ? ` · 已收到 ${progress.characters} 字元`
                      : ""}
                    <button onClick={() => void run(() => api.cancel())}>
                      取消回覆
                    </button>
                  </div>
                )}
              </div>
              <form
                className="composer"
                onSubmit={(event) => {
                  event.preventDefault();
                  void respond();
                }}
              >
                <div className="composer-status">
                  <span className={listening ? "microphone-on" : ""}>
                    {listening
                      ? `● 正在錄音 ${recordingSeconds} / 60 秒，即時辨識中`
                      : transcribing
                        ? "正在本機 Whisper 轉文字…"
                        : speech?.available
                          ? "◉ 英文辨識已就緒"
                          : "○ " + (speech?.message ?? "正在檢查英文辨識…")}
                  </span>
                  {speaking && (
                    <button
                      type="button"
                      onClick={() => void run(() => api.stopSpeaking())}
                    >
                      停止朗讀
                    </button>
                  )}
                </div>
                {listening && (
                  <div className="input-meter">
                    <span>麥克風音量</span>
                    <meter
                      aria-label="麥克風音量"
                      min={0}
                      max={1}
                      value={inputLevel}
                    />
                  </div>
                )}
                {(listening || liveText) && (
                  <div
                    className="live-transcript"
                    aria-label="即時辨識"
                    role="status"
                  >
                    <small>即時辨識 · 暫定文字</small>
                    <p>{liveText || "…"}</p>
                    {liveError && <small>{liveError}</small>}
                  </div>
                )}
                {transcribing && (
                  <button type="button" onClick={() => void run(stopAudio)}>
                    取消轉文字
                  </button>
                )}
                {!transcribing && lastRecording.current && (
                  <button
                    type="button"
                    onClick={() =>
                      void transcribeRecording(lastRecording.current!)
                    }
                  >
                    重試轉文字
                  </button>
                )}
                <textarea
                  aria-label="英文訊息"
                  placeholder="說出或輸入英文，確認文字後送出…"
                  maxLength={6000}
                  value={draft}
                  disabled={busy || transcribing}
                  onChange={(event) => changeDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.ctrlKey && event.key === "Enter") {
                      event.preventDefault();
                      void respond();
                    }
                  }}
                />
                <div className="composer-actions">
                  <button
                    type="button"
                    className={"mic-button " + (listening ? "recording" : "")}
                    disabled={
                      busy ||
                      micBusy ||
                      transcribing ||
                      !speech?.available ||
                      speaking
                    }
                    onClick={() => void mic()}
                  >
                    {micBusy
                      ? "正在切換…"
                      : listening
                        ? "■ 停止並確認文字"
                        : "◉ 開始說話"}
                  </button>
                  <select
                    aria-label="輸入麥克風"
                    value={preferences.microphoneId}
                    disabled={listening || transcribing || micBusy}
                    onChange={(event) =>
                      void run(() =>
                        savePreferences({
                          ...preferences,
                          microphoneId: event.target.value,
                        }),
                      )
                    }
                  >
                    <option value="default">系統預設麥克風</option>
                    {microphones
                      .filter((device) => device.id && device.id !== "default")
                      .map((device) => (
                        <option key={device.id} value={device.id}>
                          {device.label}
                        </option>
                      ))}
                    {preferences.microphoneId !== "default" &&
                      !microphones.some(
                        (device) => device.id === preferences.microphoneId,
                      ) && (
                        <option value={preferences.microphoneId}>
                          上次選擇的麥克風（請確認已連接）
                        </option>
                      )}
                  </select>
                  <span>{draft.length}/6000</span>
                  <button
                    className="primary"
                    disabled={
                      busy ||
                      !draft.trim() ||
                      micBusy ||
                      listening ||
                      transcribing
                    }
                  >
                    送出 →
                  </button>
                </div>
                <small>
                  Whisper 在本機轉文字，每段最多 60
                  秒。只有送出的文字與對話語境會交給 AI。
                </small>
              </form>
            </section>
            <aside className="coach-panel">
              <div className="coach-heading">
                <span>✧ 表達教練</span>
                <small>一次，說得更自然一點。</small>
              </div>
              <div className="coach-content">
                {selectedTurn?.feedback ? (
                  <>
                    <div className="coach-context">
                      <small>本次原句</small>
                      <p>{selectedTurn.userText}</p>
                    </div>
                    {selectedTurn.feedback.grammar.hasError ? (
                      <FeedbackCard
                        kind="grammar"
                        original={selectedTurn.feedback.grammar.original}
                        suggestion={selectedTurn.feedback.grammar.corrected}
                        english={
                          selectedTurn.feedback.grammar.explanationEnglish
                        }
                        chinese={
                          selectedTurn.feedback.grammar.explanationChinese
                        }
                        starred={starred(selectedTurn.id, "grammar")}
                        onStar={() => void star(selectedTurn, "grammar")}
                      />
                    ) : (
                      <div className="grammar-good">
                        <span>✓</span>
                        <h3>這句文法沒有需要修正的地方。</h3>
                        <p>繼續把重點放在自然地表達想法。</p>
                      </div>
                    )}
                    <FeedbackCard
                      kind="natural"
                      original={selectedTurn.feedback.natural.original}
                      suggestion={selectedTurn.feedback.natural.suggestion}
                      english={selectedTurn.feedback.natural.explanationEnglish}
                      chinese={selectedTurn.feedback.natural.explanationChinese}
                      starred={starred(selectedTurn.id, "natural")}
                      onStar={() => void star(selectedTurn, "natural")}
                    />
                    <p className="coach-footnote">
                      建議針對送出的文字。語音辨識有誤時，請先修改原句再送出。
                    </p>
                  </>
                ) : (
                  <div className="coach-empty">
                    <span>“ ”</span>
                    <h3>從說出口，到說得順。</h3>
                    <p>送出英文後，這裡會顯示文法修正與更生活化的說法。</p>
                    <div>
                      01　把想法說出來
                      <br />
                      02　看懂一句建議
                      <br />
                      03　下次再用一次
                    </div>
                  </div>
                )}
              </div>
            </aside>
          </div>
        )}
      </main>
      {newConversation && (
        <NewConversation
          onClose={() => setNewConversation(false)}
          onCreate={async (input) => {
            await stopAudio();
            const created = await api.createConversation(input);
            await refresh();
            setActiveId(created.id);
            setPage("practice");
            setNewConversation(false);
          }}
        />
      )}
      {deleteId && (
        <div className="modal-backdrop">
          <div className="modal compact">
            <h2>刪除這段對話？</h2>
            <p>對話訊息會刪除，星號收藏中的內容會保留。</p>
            <div className="modal-actions">
              <button onClick={() => setDeleteId("")}>取消</button>
              <button
                className="danger"
                onClick={() =>
                  void run(async () => {
                    await stopAudio();
                    await api.deleteConversation(deleteId);
                    if (activeId === deleteId) setActiveId("");
                    setDeleteId("");
                    await refresh();
                  })
                }
              >
                刪除對話
              </button>
            </div>
          </div>
        </div>
      )}
      {editing && (
        <FavoriteEditor
          favorite={editing}
          onClose={() => setEditing(undefined)}
          onSave={async (favorite) => {
            await api.saveFavorite(favorite);
            await refresh();
            setEditing(undefined);
          }}
          onRemove={async () => {
            await api.removeFavorite(editing.id);
            await refresh();
            setEditing(undefined);
          }}
        />
      )}
    </div>
  );
}
function FeedbackCard({
  kind,
  original,
  suggestion,
  english,
  chinese,
  starred,
  onStar,
}: {
  kind: "grammar" | "natural";
  original: string;
  suggestion: string;
  english: string;
  chinese: string;
  starred: boolean;
  onStar: () => void;
}) {
  return (
    <section className={"feedback-card " + kind}>
      <div className="feedback-heading">
        <h3>{kind === "grammar" ? "✓ 文法修正" : "✧ 更自然的說法"}</h3>
        <button
          className={starred ? "starred" : ""}
          onClick={onStar}
          aria-label={`收藏${feedbackLabels[kind]}`}
        >
          {starred ? "★" : "☆"}
        </button>
      </div>
      <div className="before">
        <small>原句</small>
        <p>{original}</p>
      </div>
      <div className="after">
        <small>{kind === "grammar" ? "修正後" : "可以這樣說"}</small>
        <p>{suggestion}</p>
      </div>
      <p className="explanation">{english}</p>
      <p className="chinese-help">{chinese}</p>
    </section>
  );
}
function NewConversation({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (input: {
    mode: "casual" | "topic";
    topic: string;
    guided: boolean;
  }) => Promise<void>;
}) {
  const [mode, setMode] = useState<"casual" | "topic">("casual");
  const [topic, setTopic] = useState("");
  const [guided, setGuided] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal topic-modal"
        onSubmit={async (event) => {
          event.preventDefault();
          setSaving(true);
          try {
            await onCreate({
              mode,
              topic: mode === "topic" ? topic.trim() : "",
              guided,
            });
          } catch (error) {
            setError((error as Error).message);
          } finally {
            setSaving(false);
          }
        }}
      >
        <div className="modal-heading">
          <div>
            <span className="eyebrow">MAKE ROOM FOR A CONVERSATION</span>
            <h2>今天，想怎麼練習？</h2>
          </div>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="mode-options">
          <button
            type="button"
            className={mode === "casual" ? "selected" : ""}
            onClick={() => setMode("casual")}
          >
            <span>◌</span>
            <strong>日常閒聊</strong>
            <small>從生活小事開始，輕鬆接著聊。</small>
          </button>
          <button
            type="button"
            className={mode === "topic" ? "selected" : ""}
            onClick={() => setMode("topic")}
          >
            <span>✧</span>
            <strong>主題對話</strong>
            <small>選一個情境，練習想用的英文。</small>
          </button>
        </div>
        {mode === "topic" && (
          <>
            <label className="field-label">選擇練習主題</label>
            <div className="topic-grid">
              {topics.map((item) => (
                <button
                  type="button"
                  className={topic === item.name ? "selected" : ""}
                  key={item.name}
                  onClick={() => setTopic(item.name)}
                >
                  <span>{item.icon}</span>
                  <strong>{item.name}</strong>
                  <small>{item.english}</small>
                </button>
              ))}
            </div>
            <label>
              或輸入自己的主題
              <input
                aria-label="自訂主題"
                maxLength={200}
                value={topic}
                onChange={(event) => setTopic(event.target.value)}
                placeholder="例如：在咖啡店點餐、向同事介紹專案…"
              />
            </label>
          </>
        )}
        <label className="guided-choice">
          <input
            type="checkbox"
            aria-label="開啟引導式對話"
            checked={guided}
            onChange={(event) => setGuided(event.target.checked)}
          />
          <span>
            <strong>開啟引導式對話</strong>
            <small>
              英文開頭搭配中文選項，幫你想好回答的方向；需要時再展開進階引導。
            </small>
          </span>
        </label>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            className="primary"
            disabled={saving || (mode === "topic" && !topic.trim())}
          >
            開始對話 →
          </button>
        </div>
      </form>
    </div>
  );
}
function FavoriteEditor({
  favorite,
  onClose,
  onSave,
  onRemove,
}: {
  favorite: Favorite;
  onClose: () => void;
  onSave: (favorite: Favorite) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [value, setValue] = useState(favorite);
  const [tags, setTags] = useState(favorite.tags.join(", "));
  const [error, setError] = useState("");
  const [confirm, setConfirm] = useState(false);
  return (
    <div className="modal-backdrop">
      <form
        className="modal"
        onSubmit={async (event) => {
          event.preventDefault();
          try {
            await onSave({
              ...value,
              tags: Array.from(
                new Set(
                  tags
                    .split(/[,，]/)
                    .map((tag) => tag.trim())
                    .filter(Boolean),
                ),
              ),
            });
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      >
        <div className="modal-heading">
          <h2>★ {feedbackLabels[value.kind]}</h2>
          <button type="button" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="muted">主題：{value.topic}</p>
        <blockquote className="saved-phrase">{value.suggestion}</blockquote>
        <p>{value.explanationEnglish}</p>
        <p className="muted">{value.explanationChinese}</p>
        <label>
          個人筆記
          <textarea
            aria-label="個人筆記"
            maxLength={20000}
            value={value.note}
            onChange={(event) =>
              setValue({ ...value, note: event.target.value })
            }
          />
        </label>
        <label>
          標籤
          <input
            aria-label="收藏標籤"
            value={tags}
            onChange={(event) => setTags(event.target.value)}
            placeholder="以逗號分隔"
          />
        </label>
        {error && <p className="error-text">{error}</p>}
        <div className="modal-actions">
          <button
            type="button"
            className="danger-text"
            onClick={() => {
              if (!confirm) {
                setConfirm(true);
                return;
              }
              void onRemove().catch((error) => setError(error.message));
            }}
          >
            {confirm ? "確定取消收藏" : "取消收藏"}
          </button>
          <button type="button" onClick={onClose}>
            關閉
          </button>
          <button className="primary">保存筆記</button>
        </div>
      </form>
    </div>
  );
}
function Settings({
  data,
  speech,
  onRefresh,
  onPreferences,
  onError,
  onProbe,
}: {
  data: Snapshot;
  speech?: SpeechInfo;
  onRefresh: () => Promise<void>;
  onPreferences: (preferences: Preferences) => Promise<void>;
  onError: (message: string) => void;
  onProbe: () => Promise<void>;
}) {
  const [models, setModels] = useState<ChatGPTModel[]>([]);
  const [preferences, setPreferences] = useState(data.preferences);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [probing, setProbing] = useState(false);
  const account = data.chatGPT;
  useEffect(() => setPreferences(data.preferences), [data.preferences]);
  useEffect(() => {
    let ignore = false;
    if (!account.sharing) {
      setModels([]);
      return;
    }
    void api
      .models()
      .then((value) => {
        if (!ignore) setModels(value);
      })
      .catch((error) => {
        if (!ignore) setMessage(error.message);
      });
    return () => {
      ignore = true;
    };
  }, [account.activeProfileId, account.sharing]);
  async function connect(operation: () => Promise<unknown>) {
    setBusy(true);
    setMessage("");
    try {
      await operation();
    } catch (error) {
      setMessage((error as Error).message);
    } finally {
      try {
        await onRefresh();
      } catch (error) {
        onError((error as Error).message);
      }
      setBusy(false);
    }
  }
  return (
    <section className="settings-page">
      <div className="section-heading">
        <div>
          <h2>準備好，讓英文更靠近日常。</h2>
          <p>連接訂閱、確認麥克風，建立自己的練習節奏。</p>
        </div>
      </div>
      <div className="settings-card">
        <h3>ChatGPT 訂閱</h3>
        <p>
          登入自己的帳戶，並允許 Speaking Studio 使用方案中的用量。口說辨識由
          Windows 在本機完成，確認後送出的文字才會交給 AI。
        </p>
        {!!account.profiles.length && (
          <label>
            帳戶
            <select
              aria-label="ChatGPT 帳戶"
              value={account.activeProfileId ?? ""}
              disabled={busy || account.signingIn}
              onChange={(event) =>
                void connect(() => api.selectAccount(event.target.value))
              }
            >
              {account.profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.email} · {profile.id.slice(0, 6)}
                  {profile.connected ? "" : "（已登出）"}
                </option>
              ))}
            </select>
          </label>
        )}
        <p className="status-pill" role="status">
          {account.sharing
            ? "已啟用 · 使用 ChatGPT 訂閱"
            : account.connected
              ? "已登入，請啟用訂閱使用授權"
              : "尚未登入 ChatGPT"}
        </p>
        <div className="button-row">
          <button
            className="primary"
            disabled={busy || account.signingIn}
            onClick={() =>
              void connect(() =>
                api.signIn({ profileId: account.activeProfileId ?? undefined }),
              )
            }
          >
            Continue with ChatGPT
          </button>
          {account.connected && !account.sharing && (
            <button
              disabled={busy}
              onClick={() =>
                void connect(() =>
                  api.signIn({
                    profileId: account.activeProfileId!,
                    enableSharing: true,
                  }),
                )
              }
            >
              啟用訂閱使用授權
            </button>
          )}
          {!!account.profiles.length && (
            <button
              disabled={busy || account.signingIn}
              onClick={() => void connect(() => api.signIn())}
            >
              新增帳戶
            </button>
          )}
          {account.connected && (
            <button
              disabled={busy || account.signingIn}
              onClick={() =>
                void connect(async () => {
                  const result = await api.signOut();
                  setMessage(
                    result.remoteRevoked
                      ? "已登出。"
                      : "已在本機登出；遠端撤銷尚未確認，請到 ChatGPT 設定中斷連線。",
                  );
                })
              }
            >
              登出
            </button>
          )}
          <button
            onClick={() =>
              void api.manageUsage().catch((error) => onError(error.message))
            }
          >
            管理 ChatGPT 用量
          </button>
        </div>
        {(busy || account.signingIn) && (
          <p role="status">
            請在瀏覽器完成登入與授權。
            <button onClick={() => void api.cancelSignIn()}>取消登入</button>
          </p>
        )}
        {(message || account.error) && (
          <p className="error-text" role="alert">
            {message || account.error}
          </p>
        )}
      </div>
      <form
        className="settings-card"
        onSubmit={(event) => {
          event.preventDefault();
          void connect(() => onPreferences(preferences));
        }}
      >
        <h3>對話與外觀</h3>
        <label>
          回覆模型
          <select
            aria-label="回覆模型"
            disabled={!account.sharing}
            value={preferences.model}
            onChange={(event) =>
              setPreferences({ ...preferences, model: event.target.value })
            }
          >
            {!models.some((model) => model.slug === preferences.model) && (
              <option value={preferences.model}>
                {account.sharing ? "請選擇可用模型" : "登入後載入模型"}
              </option>
            )}
            {models.map((model) => (
              <option value={model.slug} key={model.slug}>
                {model.displayName}
              </option>
            ))}
          </select>
        </label>
        <div className="settings-row">
          <label>
            明暗模式
            <select
              value={preferences.theme}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  theme: event.target.value as Preferences["theme"],
                })
              }
            >
              <option value="light">淺色</option>
              <option value="dark">深色</option>
            </select>
          </label>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={preferences.showChinese}
              onChange={(event) =>
                setPreferences({
                  ...preferences,
                  showChinese: event.target.checked,
                })
              }
            />
            顯示 AI 回覆的繁中輔助
          </label>
        </div>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={preferences.autoReadReplies}
            onChange={(event) =>
              setPreferences({
                ...preferences,
                autoReadReplies: event.target.checked,
              })
            }
          />
          自動朗讀新的 AI 英文回覆
        </label>
        <button className="primary" disabled={busy}>
          保存設定
        </button>
      </form>
      <div className="settings-card">
        <h3>麥克風與英文朗讀</h3>
        <p role="status">{speech?.message ?? "正在檢查 Windows 語音元件…"}</p>
        <p className="muted">
          辨識語言：{speech?.culture || "尚未就緒"} · 英文朗讀：
          {speech?.canSpeak ? "可使用" : "尚未就緒"}
        </p>
        <p className="muted">
          辨識加速：
          {speech?.warmingUp
            ? "正在初始化 GPU"
            : speech?.acceleration === "cuda"
              ? "NVIDIA GPU"
              : speech?.acceleration === "cpu"
                ? "CPU"
                : "自動選擇 GPU／CPU"}
          {speech?.durationMs !== undefined &&
            ` · 最近一次轉錄 ${(speech.durationMs / 1000).toFixed(2)} 秒`}
        </p>
        <p>
          使用 Chromium 收音，可在對話輸入框旁選擇麥克風，錄音時會顯示音量。
          每段最多 60 秒，錄音時持續顯示本機 Whisper
          的暫定文字，停止後確認完整內容再送出。
        </p>
        <p className="muted">
          辨識引擎：Whisper small.en（Q5_1）／whisper.cpp，取代舊的 Windows
          聽寫引擎。 錄音不會上傳，辨識不需要 API Key；英文朗讀仍使用 Windows
          本機聲音。
        </p>
        <div className="button-row">
          <button
            disabled={probing}
            onClick={async () => {
              setProbing(true);
              try {
                await onProbe();
              } catch (error) {
                onError((error as Error).message);
              } finally {
                setProbing(false);
              }
            }}
          >
            {probing ? "正在檢查…" : "重新檢查語音元件"}
          </button>
          <button
            onClick={() =>
              void api
                .microphoneSettings()
                .catch((error) => onError(error.message))
            }
          >
            Windows 麥克風權限
          </button>
        </div>
        <p className="muted small">
          英文朗讀若未就緒，請在 Windows 安裝英文語音元件。
        </p>
      </div>
      <div className="settings-card">
        <h3>本機資料</h3>
        <p>
          對話、收藏與筆記保存於
          SQLite。登入憑證由作業系統安全機制加密保存。錄音僅在記憶體內轉文字，不寫入音訊檔；
          辨識失敗時可保留這段錄音於記憶體內重試，離開對話後釋放。
        </p>
        <code>{data.dataPath}</code>
      </div>
    </section>
  );
}
