import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const componentUrl = new URL("./NativeTerminalTab.tsx", import.meta.url);

test("uses only the isolated compatibility PTY command surface", () => {
  assert.equal(existsSync(componentUrl), true, "NativeTerminalTab.tsx must exist");
  const source = readFileSync(componentUrl, "utf8");

  for (const command of [
    "spawn_compat_terminal",
    "write_to_compat_terminal",
    "resize_compat_terminal",
    "close_compat_terminal",
  ]) {
    assert.match(source, new RegExp(`invoke\\(\\"${command}\\"`));
  }

  assert.match(source, /@xterm\/xterm/);
  assert.match(source, /compat-terminal-output-/);
  assert.match(source, /TextDecoder\("utf-8"\)/);
  assert.match(source, /captureUserInputData/);
  assert.match(source, /deriveSessionTitleFromInput/);
  assert.match(source, /kkcoder-insert-conversation-tag/);
  assert.match(source, /kkcoder-compat-terminal-submitted/);
  assert.match(source, /play_notification_sound/);
  assert.match(source, /onStateChange/);
  assert.match(source, /onCommandComplete/);
  assert.match(source, /attachCustomKeyEventHandler/);
  assert.match(source, /resolveCtrlCAction/);
  assert.match(source, /registerAtomicInputTag/);
  assert.match(source, /tryDeleteTrailingAtomicInputTag/);
  assert.match(source, /Backspace/);
  assert.match(source, /addEventListener\("paste"/);
  assert.match(source, /minimumContrastRatio:\s*4\.5/);
  assert.match(source, /"\\x03"/);
  assert.doesNotMatch(source, /invoke\("spawn_terminal"/);
  assert.doesNotMatch(source, /invoke\("write_to_terminal"/);
  assert.doesNotMatch(source, /invoke\("spawn_native_terminal"/);
});
