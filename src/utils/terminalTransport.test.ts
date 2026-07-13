import assert from "node:assert/strict";
import test from "node:test";

test("selects the isolated write command only for Claude compatibility sessions", async () => {
  const { resolveTerminalWriteCommand } = await import("./terminalTransport.ts");

  assert.equal(resolveTerminalWriteCommand("claude", "native"), "write_to_compat_terminal");
  assert.equal(resolveTerminalWriteCommand("claude", "standard"), "write_to_terminal");
  assert.equal(resolveTerminalWriteCommand("pi", "native"), "write_to_terminal");
  assert.equal(resolveTerminalWriteCommand("codex", "native"), "write_to_terminal");
});
