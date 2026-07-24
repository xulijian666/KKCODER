import assert from "node:assert/strict";
import test from "node:test";

test("terminalFocus exports stable focus event name", async () => {
  const { FOCUS_ACTIVE_TERMINAL_EVENT } = await import("./terminalFocus.ts");
  assert.equal(FOCUS_ACTIVE_TERMINAL_EVENT, "kkcoder-focus-active-terminal");
});

test("requestActiveTerminalFocus is a callable function", async () => {
  const { requestActiveTerminalFocus, returnFocusToActiveTerminal } = await import(
    "./terminalFocus.ts"
  );
  assert.equal(typeof requestActiveTerminalFocus, "function");
  assert.equal(typeof returnFocusToActiveTerminal, "function");
});
