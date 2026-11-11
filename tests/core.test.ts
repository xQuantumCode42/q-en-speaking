import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Store } from "../electron/store";
import { ConversationAI } from "../electron/ai";
import {
  validateFeedback,
  conversationInputSchema,
  type Feedback,
  type Favorite,
} from "../shared/schema";
import { readResponsesStream } from "../electron/transport";
const feedback: Feedback = {
  replyEnglish: "That sounds fun. What did you enjoy most?",
  replyChinese: "聽起來很有趣。你最喜歡什麼？",
  grammar: {
    hasError: true,
    original: "I go yesterday",
    corrected: "I went yesterday",
    explanationEnglish: "Use the past tense for yesterday.",
    explanationChinese: "昨天發生的事使用過去式。",
  },
  natural: {
    original: "I go yesterday",
    suggestion: "I went there yesterday.",
    explanationEnglish: "There makes the destination clear in this context.",
    explanationChinese: "在這個語境中加上 there 可以指明地點。",
  },
};
test("SQLite restart retains conversations, complete responses, favorites and notes; pending turns recover as retryable", () => {
  const directory = mkdtempSync(join(tmpdir(), "speaking-core-"));
  try {
    const file = join(directory, "test.sqlite");
    let store = new Store(file);
    const conversation = store.create("topic", "旅行");
    const completed = store.newTurn(
      conversation.id,
      "I go yesterday",
      "fixture-model",
    );
    store.saveTurn({ ...completed, status: "completed", feedback });
    const favorite: Favorite = {
      id: randomUUID(),
      turnId: completed.id,
      conversationId: conversation.id,
      kind: "grammar",
      topic: "旅行",
      original: "I go yesterday",
      suggestion: "I went yesterday",
      explanationEnglish: "Past tense",
      explanationChinese: "過去式",
      note: "練習過去式",
      tags: ["旅行"],
      createdAt: new Date().toISOString(),
    };
    store.saveFavorite(favorite);
    store.newTurn(conversation.id, "Another message", "fixture-model");
    store.close();
    store = new Store(file);
    assert.equal(store.conversations()[0].topic, "旅行");
    assert.deepEqual(store.turns(conversation.id)[0].feedback, feedback);
    assert.equal(store.turns(conversation.id)[1].status, "failed");
    assert.equal(store.favorites()[0].note, "練習過去式");
    store.deleteConversation(conversation.id);
    assert.equal(store.favorites().length, 1);
    assert.throws(() => store.turn(completed.id));
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("topic validation requires a topic only for topic mode, and feedback requires real grammar reasons", () => {
  assert.doesNotThrow(() =>
    conversationInputSchema.parse({ mode: "casual", topic: "" }),
  );
  assert.throws(() =>
    conversationInputSchema.parse({ mode: "topic", topic: "" }),
  );
  assert.deepEqual(validateFeedback(feedback), feedback);
  assert.throws(() =>
    validateFeedback({
      ...feedback,
      grammar: { ...feedback.grammar, corrected: "" },
    }),
  );
  assert.doesNotThrow(() =>
    validateFeedback({
      ...feedback,
      grammar: {
        hasError: false,
        original: "",
        corrected: "",
        explanationEnglish: "",
        explanationChinese: "",
      },
    }),
  );
});
test("AI uses subscription SSE, keeps topic and recent context, and validates completed structured coaching", async () => {
  const network = globalThis.fetch;
  let called = false;
  try {
    globalThis.fetch = async (url, init) => {
      called = true;
      assert.equal(url, "https://api.openai.com/v1/responses");
      const body = JSON.parse(init!.body as string);
      assert.equal(body.store, false);
      assert.equal(body.stream, true);
      assert.equal(body.max_output_tokens, undefined);
      assert.ok(body.instructions.includes("旅行"));
      assert.equal(body.input.at(-1).content, "I go yesterday");
      assert.equal(body.text.format.strict, true);
      return new Response(
        "data: " +
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
    const store = new Store(":memory:");
    const conversation = store.create("topic", "旅行");
    const result = await new ConversationAI().reply(
      conversation,
      [],
      "I go yesterday",
      "fixture-model",
      "fixture-access",
      new AbortController().signal,
      () => {},
    );
    assert.deepEqual(result, feedback);
    assert.equal(called, true);
    store.close();
  } finally {
    globalThis.fetch = network;
  }
});
test("AI rejects corrections that quote a different utterance, incomplete streams, and hanging streams on cancel", async () => {
  const network = globalThis.fetch;
  const store = new Store(":memory:");
  const conversation = store.create("casual", "");
  try {
    globalThis.fetch = async () =>
      new Response(
        "data: " +
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
    await assert.rejects(
      () =>
        new ConversationAI().reply(
          conversation,
          [],
          "A different sentence",
          "fixture-model",
          "fixture-access",
          new AbortController().signal,
          () => {},
        ),
      /本次英文原句/,
    );
    await assert.rejects(
      () =>
        readResponsesStream(
          new Response(
            'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
          ),
        ),
      /中斷/,
    );
    const controller = new AbortController();
    const reading = readResponsesStream(
      new Response(
        new ReadableStream({
          pull() {
            return new Promise(() => {});
          },
          cancel() {
            return new Promise(() => {});
          },
        }),
      ),
      controller.signal,
    );
    controller.abort(new Error("cancelled"));
    await assert.rejects(() => reading, /cancelled/);
  } finally {
    globalThis.fetch = network;
    store.close();
  }
});
