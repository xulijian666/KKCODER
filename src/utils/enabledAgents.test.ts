import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_ENABLED_AGENTS,
  getVisibleAgents,
  isAgentEnabled,
  resolveEnabledAgents,
} from "./enabledAgents.ts";

describe("enabledAgents", () => {
  it("defaults to Claude only", () => {
    assert.deepEqual(resolveEnabledAgents(null), DEFAULT_ENABLED_AGENTS);
    assert.deepEqual(getVisibleAgents(DEFAULT_ENABLED_AGENTS), ["claude"]);
  });

  it("ignores legacy pi/codex flags from storage (Pi/Codex 集成已移除)", () => {
    const enabled = resolveEnabledAgents(
      JSON.stringify({ claude: false, pi: true, codex: true }),
    );
    assert.deepEqual(enabled, { claude: true });
    assert.deepEqual(getVisibleAgents(enabled), ["claude"]);
  });

  it("ignores invalid JSON", () => {
    assert.deepEqual(resolveEnabledAgents("{not-json"), DEFAULT_ENABLED_AGENTS);
  });

  it("reports Claude always enabled", () => {
    assert.equal(isAgentEnabled("claude", DEFAULT_ENABLED_AGENTS), true);
  });
});
