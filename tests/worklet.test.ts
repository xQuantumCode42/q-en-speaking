import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

test("audio thread flush keeps the final incomplete block and stops accepting samples", () => {
  const messages: unknown[] = [];
  let Processor: any;
  runInNewContext(readFileSync("public/capture-worklet.js", "utf8"), {
    Float32Array,
    AudioWorkletProcessor: class {
      port = {
        onmessage: undefined,
        postMessage: (data: unknown) => messages.push(data),
      };
    },
    registerProcessor: (_name: string, constructor: unknown) => {
      Processor = constructor;
    },
  });
  const processor = new Processor();
  const input = Float32Array.from({ length: 3000 }, (_, index) => index / 3000);
  for (let offset = 0; offset < input.length; offset += 128)
    processor.process([[input.subarray(offset, offset + 128)]]);
  processor.port.onmessage({ data: "flush" });
  const chunks = messages.filter(
    (message): message is Float32Array => message instanceof Float32Array,
  );
  assert.deepEqual(
    Float32Array.from(chunks.flatMap((chunk) => Array.from(chunk))),
    input,
  );
  assert.equal(messages.at(-1), "flushed");
  const count = messages.length;
  processor.process([[new Float32Array(4096)]]);
  assert.equal(messages.length, count);
});
