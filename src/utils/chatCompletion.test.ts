import assert from "node:assert/strict";
import test from "node:test";
import {
  detectChatCompletionTrigger,
  replaceChatCompletionTrigger,
} from "./chatCompletion.ts";

test("detects file mentions at token boundaries", () => {
  assert.deepEqual(detectChatCompletionTrigger("read @src/App", 13), {
    kind: "file",
    query: "src/App",
    start: 5,
    end: 13,
  });
  assert.equal(detectChatCompletionTrigger("email@test", 10), null);
});

test("detects slash completion only at line start", () => {
  assert.deepEqual(detectChatCompletionTrigger("  /grill", 8), {
    kind: "slash",
    query: "grill",
    start: 2,
    end: 8,
  });
  assert.equal(detectChatCompletionTrigger("run /grill", 10), null);
});

test("replaces only the active completion token", () => {
  const trigger = detectChatCompletionTrigger("use @App now", 8);
  assert.ok(trigger);
  assert.deepEqual(replaceChatCompletionTrigger("use @App now", trigger, "@src/App.tsx "), {
    text: "use @src/App.tsx  now",
    caret: 17,
  });
});
