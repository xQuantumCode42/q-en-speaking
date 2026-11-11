import type { Conversation, Turn, Favorite, Preferences } from "./schema";
export type ChatGPTSession = {
  profiles: {
    id: string;
    email: string;
    connected: boolean;
    sharing: boolean;
  }[];
  activeProfileId: string | null;
  connected: boolean;
  sharing: boolean;
  signingIn: boolean;
  error?: string;
};
export type ChatGPTModel = { slug: string; displayName: string };
export type TalkPhase =
  "authorizing" | "connecting" | "reasoning" | "generating" | "validating";
export type Progress = {
  conversationId: string;
  phase: TalkPhase;
  characters: number;
};
export type SpeechInfo = {
  available: boolean;
  culture: string;
  canSpeak: boolean;
  message: string;
  acceleration?: "auto" | "cuda" | "cpu";
  durationMs?: number;
  warmingUp?: boolean;
};
export type SpeechEvent = {
  type:
    | "listening"
    | "partial"
    | "final"
    | "stopped"
    | "error"
    | "unclear"
    | "speaking"
    | "speak-ended";
  text?: string;
  confidence?: number;
  message?: string;
};
export type Snapshot = {
  conversations: Conversation[];
  favorites: Favorite[];
  preferences: Preferences;
  chatGPT: ChatGPTSession;
  dataPath: string;
};
export interface API {
  snapshot(): Promise<Snapshot>;
  createConversation(input: {
    mode: "casual" | "topic";
    topic: string;
  }): Promise<Conversation>;
  turns(conversationId: string): Promise<Turn[]>;
  deleteConversation(conversationId: string): Promise<void>;
  send(input: { conversationId: string; text: string }): Promise<Turn>;
  retry(turnId: string): Promise<Turn>;
  cancel(): Promise<void>;
  favorite(input: {
    turnId: string;
    kind: Favorite["kind"];
  }): Promise<Favorite>;
  saveFavorite(input: Favorite): Promise<void>;
  removeFavorite(id: string): Promise<void>;
  settings(preferences: Preferences): Promise<void>;
  signIn(input?: {
    profileId?: string;
    enableSharing?: boolean;
  }): Promise<void>;
  cancelSignIn(): Promise<void>;
  selectAccount(id: string): Promise<void>;
  signOut(): Promise<{ remoteRevoked: boolean }>;
  models(): Promise<ChatGPTModel[]>;
  manageUsage(): Promise<void>;
  speechInfo(): Promise<SpeechInfo>;
  transcribe(wave: Uint8Array): Promise<string>;
  cancelTranscription(): Promise<void>;
  speak(text: string): Promise<void>;
  stopSpeaking(): Promise<void>;
  microphoneSettings(): Promise<void>;
  onSpeech(listener: (event: SpeechEvent) => void): () => void;
  onProgress(listener: (event: Progress) => void): () => void;
}
export type Reply<T> = { ok: true; data: T } | { ok: false; error: string };
