import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../electron/store";
import { ConversationAI } from "../electron/ai";
import { openingExercise } from "../shared/guidance";
import {
  guidanceSchema,
  validateFeedback,
  type Feedback,
} from "../shared/schema";

const guidance = openingExercise({ mode: "casual" }).guidance;
const feedback: Feedback = {
  replyEnglish: "That sounds relaxing. What do you like to watch?",
  replyChinese: "聽起來很放鬆。你喜歡看什麼？",
  grammar: {
    hasError: false,
    original: "",
    corrected: "",
    explanationEnglish: "",
    explanationChinese: "",
  },
  natural: {
    original: "I watch movies",
    suggestion: "I enjoy watching movies.",
    explanationEnglish: "Another everyday way to express this.",
    explanationChinese: "另一種日常表達方式。",
  },
  guidance,
};
function stream(value: unknown) {
  return new Response(
    "data: " +
      JSON.stringify({
        type: "response.completed",
        response: {
          status: "completed",
          output: [
            { content: [{ type: "output_text", text: JSON.stringify(value) }] },
          ],
        },
      }) +
      "\n\n",
  );
}
test("legacy conversations and feedback remain readable; guided setting and hints persist", () => {
  const directory = mkdtempSync(join(tmpdir(), "speaking-guidance-"));
  const file = join(directory, "test.sqlite");
  try {
    let store = new Store(file);
    const legacy = store.create("casual", "");
    const guided = store.create("topic", "旅行", true);
    const turn = store.newTurn(guided.id, "I watch movies", "fixture");
    store.saveTurn({ ...turn, status: "completed", feedback });
    store.close();
    const db = new DatabaseSync(file);
    const { guided: _unused, ...old } = legacy;
    db.prepare("UPDATE conversations SET data=? WHERE id=?").run(
      JSON.stringify(old),
      legacy.id,
    );
    db.close();
    store = new Store(file);
    assert.equal(store.conversation(legacy.id).guided, false);
    assert.equal(
      store.conversations().find((item) => item.id === legacy.id)?.guided,
      false,
    );
    assert.equal(store.conversation(guided.id).guided, true);
    assert.deepEqual(store.turn(turn.id).feedback?.guidance, guidance);
    store.setGuided(guided.id, false);
    assert.equal(store.conversation(guided.id).guided, false);
    assert.deepEqual(store.turn(turn.id).feedback?.guidance, guidance);
    store.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test("guided schema rejects incomplete hints and duplicate Chinese directions", () => {
  assert.doesNotThrow(() => guidanceSchema.parse(guidance));
  assert.doesNotThrow(() => validateFeedback(feedback));
  assert.throws(() =>
    validateFeedback({
      ...feedback,
      guidance: { ...guidance, options: guidance.options.slice(0, 1) },
    }),
  );
  assert.throws(() =>
    validateFeedback({
      ...feedback,
      guidance: { ...guidance, options: Array(3).fill(guidance.options[0]) },
    }),
  );
  assert.throws(() =>
    validateFeedback({
      ...feedback,
      guidance: {
        ...guidance,
        options: guidance.options.map((option) => ({
          ...option,
          sampleEnglish: "",
        })),
      },
    }),
  );
  assert.doesNotThrow(() =>
    guidanceSchema.parse(openingExercise({ mode: "topic" }).guidance),
  );
});
test("guided AI adds opening context, requests required structured hints and rejects missing hints", async () => {
  const network = globalThis.fetch;
  const store = new Store(":memory:");
  const conversation = store.create("casual", "", true);
  const ai = new ConversationAI();
  const reply = () =>
    ai.reply(
      conversation,
      [],
      "I watch movies",
      "fixture",
      "fixture",
      new AbortController().signal,
      () => {},
    );
  try {
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(init!.body as string);
      assert.ok(body.instructions.includes("GUIDED_CONVERSATION"));
      assert.equal(body.input[0].role, "assistant");
      assert.equal(
        body.input[0].content,
        openingExercise(conversation).questionEnglish,
      );
      assert.equal(body.input.at(-1).content, "I watch movies");
      assert.ok(body.text.format.schema.required.includes("guidance"));
      assert.equal(body.store, false);
      return stream(feedback);
    };
    assert.deepEqual((await reply()).guidance, guidance);
    const { guidance: _omitted, ...missing } = feedback;
    globalThis.fetch = async () => stream(missing);
    await assert.rejects(reply(), /格式不完整/);
  } finally {
    globalThis.fetch = network;
    store.close();
  }
});
