import assert from "node:assert/strict";
import test from "node:test";

test("copies a terminal selection instead of sending Ctrl+C", async () => {
  const { resolveCtrlCAction } = await import("./terminalKeyPolicy.ts");
  assert.equal(resolveCtrlCAction(true, "draft", false), "copy");
});

test("sends one interrupt only when there is input to clear", async () => {
  const { resolveCtrlCAction } = await import("./terminalKeyPolicy.ts");
  assert.equal(resolveCtrlCAction(false, "draft", false), "interrupt");
  assert.equal(resolveCtrlCAction(false, "", false), "suppress");
  assert.equal(resolveCtrlCAction(false, "draft", true), "suppress");
});
