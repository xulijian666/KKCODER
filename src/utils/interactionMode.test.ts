import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveClaudeInteractionMode,
  shouldUseGuiChat,
} from "./interactionMode.ts";

test("defaults Claude interaction mode to GUI", () => {
  assert.equal(resolveClaudeInteractionMode(null), "gui");
  assert.equal(resolveClaudeInteractionMode("unexpected"), "gui");
  assert.equal(resolveClaudeInteractionMode("cli"), "cli");
  assert.equal(resolveClaudeInteractionMode("gui"), "gui");
});

test("routes only Claude sessions to GUI chat", () => {
  assert.equal(shouldUseGuiChat("claude", "gui"), true);
  assert.equal(shouldUseGuiChat("claude", "cli"), false);
});
