import { contextBridge, ipcRenderer } from "electron";
import type { API, Reply, SpeechEvent, Progress } from "../shared/api";
async function invoke<T>(channel: string, input?: unknown): Promise<T> {
  const result = (await ipcRenderer.invoke(channel, input)) as Reply<T>;
  if (!result.ok) throw new Error(result.error);
  return result.data;
}
const api: API = {
  snapshot: () => invoke("snapshot"),
  createConversation: (input) => invoke("conversation:create", input),
  setGuided: (input) => invoke("conversation:guidance", input),
  turns: (id) => invoke("conversation:turns", id),
  deleteConversation: (id) => invoke("conversation:delete", id),
  send: (input) => invoke("talk:send", input),
  retry: (id) => invoke("talk:retry", id),
  cancel: () => invoke("talk:cancel"),
  favorite: (input) => invoke("favorite:add", input),
  saveFavorite: (input) => invoke("favorite:save", input),
  removeFavorite: (id) => invoke("favorite:remove", id),
  settings: (input) => invoke("settings:save", input),
  signIn: (input) => invoke("auth:sign-in", input),
  cancelSignIn: () => invoke("auth:cancel"),
  selectAccount: (id) => invoke("auth:select", id),
  signOut: () => invoke("auth:sign-out"),
  models: () => invoke("auth:models"),
  manageUsage: () => invoke("auth:usage"),
  speechInfo: () => invoke("speech:info"),
  transcribe: (wave) => invoke("speech:transcribe", wave),
  cancelTranscription: () => invoke("speech:cancel-transcription"),
  speak: (text) => invoke("speech:speak", text),
  stopSpeaking: () => invoke("speech:silence"),
  microphoneSettings: () => invoke("speech:settings"),
  onSpeech: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: SpeechEvent) =>
      listener(value);
    ipcRenderer.on("speech:event", handler);
    return () => {
      ipcRenderer.removeListener("speech:event", handler);
    };
  },
  onProgress: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, value: Progress) =>
      listener(value);
    ipcRenderer.on("talk:progress", handler);
    return () => {
      ipcRenderer.removeListener("talk:progress", handler);
    };
  },
};
contextBridge.exposeInMainWorld("speakingStudio", Object.freeze(api));
