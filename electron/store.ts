import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import {
  defaultPreferences,
  feedbackSchema,
  type Conversation,
  type Turn,
  type Favorite,
  type Preferences,
} from "../shared/schema";
export class Store {
  private db: DatabaseSync;
  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS turns(id TEXT PRIMARY KEY,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS favorites(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,data TEXT NOT NULL); PRAGMA user_version=1;",
    );
    // A previous process cannot still be serving a pending turn after a restart.
    const pending = this.db.prepare("SELECT data FROM turns").all();
    for (const row of pending) {
      const turn = JSON.parse(row.data as string) as Turn;
      if (turn.status === "pending")
        this.saveTurn({
          ...turn,
          status: "failed",
          error: "上次對話在回覆完成前關閉，可按重試繼續。",
        });
    }
  }
  conversations(): Conversation[] {
    return this.db
      .prepare(
        "SELECT data FROM conversations ORDER BY json_extract(data,'$.updatedAt') DESC",
      )
      .all()
      .map((row) => ({ guided: false, ...JSON.parse(row.data as string) }));
  }
  conversation(id: string): Conversation {
    const row = this.db
      .prepare("SELECT data FROM conversations WHERE id=?")
      .get(id);
    if (!row) throw new Error("對話不存在。");
    return { guided: false, ...JSON.parse(row.data as string) };
  }
  create(mode: Conversation["mode"], topic: string, guided = false) {
    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: randomUUID(),
      mode,
      topic,
      guided,
      title: mode === "casual" ? "日常閒聊" : topic,
      createdAt: now,
      updatedAt: now,
    };
    this.db
      .prepare("INSERT INTO conversations VALUES(?,?)")
      .run(conversation.id, JSON.stringify(conversation));
    return conversation;
  }
  setGuided(id: string, guided: boolean): Conversation {
    const conversation = { ...this.conversation(id), guided };
    this.db
      .prepare("UPDATE conversations SET data=? WHERE id=?")
      .run(JSON.stringify(conversation), id);
    return conversation;
  }
  turns(id: string): Turn[] {
    this.conversation(id);
    return this.db
      .prepare("SELECT data FROM turns WHERE conversation_id=? ORDER BY rowid")
      .all(id)
      .map((row) => JSON.parse(row.data as string));
  }
  turn(id: string): Turn {
    const row = this.db.prepare("SELECT data FROM turns WHERE id=?").get(id);
    if (!row) throw new Error("對話訊息不存在。");
    return JSON.parse(row.data as string);
  }
  saveTurn(turn: Turn) {
    if (turn.feedback) feedbackSchema.parse(turn.feedback);
    const conversation = this.conversation(turn.conversationId);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      this.db
        .prepare(
          "INSERT INTO turns VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
        )
        .run(turn.id, turn.conversationId, JSON.stringify(turn));
      this.db.prepare("UPDATE conversations SET data=? WHERE id=?").run(
        JSON.stringify({
          ...conversation,
          updatedAt: new Date().toISOString(),
        }),
        conversation.id,
      );
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  newTurn(conversationId: string, userText: string, model: string) {
    const turn: Turn = {
      id: randomUUID(),
      conversationId,
      userText,
      feedback: null,
      status: "pending",
      error: "",
      createdAt: new Date().toISOString(),
      model,
    };
    this.saveTurn(turn);
    return turn;
  }
  deleteConversation(id: string) {
    this.db.prepare("DELETE FROM conversations WHERE id=?").run(id);
  }
  favorites(): Favorite[] {
    return this.db
      .prepare("SELECT data FROM favorites ORDER BY rowid DESC")
      .all()
      .map((row) => JSON.parse(row.data as string));
  }
  saveFavorite(favorite: Favorite) {
    this.db
      .prepare(
        "INSERT INTO favorites VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(favorite.id, JSON.stringify(favorite));
  }
  deleteFavorite(id: string) {
    this.db.prepare("DELETE FROM favorites WHERE id=?").run(id);
  }
  preferences(): Preferences {
    const row = this.db
      .prepare("SELECT data FROM settings WHERE key=?")
      .get("preferences");
    return row
      ? { ...defaultPreferences, ...JSON.parse(row.data as string) }
      : defaultPreferences;
  }
  savePreferences(preferences: Preferences) {
    this.db
      .prepare("INSERT OR REPLACE INTO settings VALUES(?,?)")
      .run("preferences", JSON.stringify(preferences));
  }
  close() {
    this.db.close();
  }
}
