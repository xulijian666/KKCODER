import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveClaudeInteractionMode,
  shouldUseGuiChat,
} from "./interactionMode.ts";

test("defaults Claude interaction mode to CLI", () => {
  assert.equal(resolveClaudeInteractionMode(null), "cli");
  assert.equal(resolveClaudeInteractionMode("unexpected"), "cli");
});

test("routes only Claude sessions to GUI chat", () => {
  assert.equal(shouldUseGuiChat("claude", "gui"), true);
  assert.equal(shouldUseGuiChat("claude", "cli"), false);
});
