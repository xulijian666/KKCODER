import assert from "node:assert/strict";
import test from "node:test";

test("defaults Claude terminal mode to standard", async () => {
  const { resolveClaudeTerminalMode } = await import("./terminalMode.ts");

  assert.equal(resolveClaudeTerminalMode(null), "standard");
  assert.equal(resolveClaudeTerminalMode("unexpected"), "standard");
});

test("enables native mode only for Claude sessions", async () => {
  const { resolveClaudeTerminalMode, shouldUseNativeTerminal } = await import("./terminalMode.ts");
  const mode = resolveClaudeTerminalMode("native");

  assert.equal(mode, "native");
  assert.equal(shouldUseNativeTerminal("claude", mode), true);
  assert.equal(shouldUseNativeTerminal("pi", mode), false);
  assert.equal(shouldUseNativeTerminal("codex", mode), false);
});
