import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const settingsSource = readFileSync(
  new URL("./SettingsModal.tsx", import.meta.url),
  "utf8",
);
const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");

test("persists and announces the opt-in Claude native terminal setting", () => {
  assert.match(settingsSource, /CLAUDE_TERMINAL_MODE_KEY/);
  assert.match(settingsSource, /resolveClaudeTerminalMode/);
  assert.match(settingsSource, /Claude Code 兼容终端模式/);
  assert.match(settingsSource, /kkcoder-claude-terminal-mode-change/);
  assert.match(
    settingsSource,
    /localStorage\.setItem\(CLAUDE_TERMINAL_MODE_KEY, claudeTerminalMode\)/,
  );
  assert.match(settingsSource, /新打开或重新打开/);
});

test("routes only newly opened Claude tabs through the isolated compatibility component", () => {
  assert.match(appSource, /import \{ CompatibilityTerminalTab \}/);
  assert.match(appSource, /shouldUseNativeTerminal/);
  assert.match(appSource, /kkcoder-claude-terminal-mode-change/);
  assert.match(appSource, /resolveTerminalWriteCommand/);
  assert.match(appSource, /kkcoder-compat-terminal-submitted/);
  assert.match(appSource, /terminalModeBySession/);
  assert.match(appSource, /<CompatibilityTerminalTab/);
  assert.match(appSource, /<TerminalTab/);
  assert.match(
    appSource,
    /shouldUseNativeTerminal\(s\.type, sessionTerminalMode\)/,
  );
});
