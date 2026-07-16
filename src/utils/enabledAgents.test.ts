import { describe, expect, it } from "vitest";
import {
  DEFAULT_ENABLED_AGENTS,
  getVisibleAgents,
  isAgentEnabled,
  resolveEnabledAgents,
} from "./enabledAgents";

describe("enabledAgents", () => {
  it("defaults to Claude only when raw is empty", () => {
    expect(resolveEnabledAgents(null)).toEqual(DEFAULT_ENABLED_AGENTS);
    expect(getVisibleAgents(DEFAULT_ENABLED_AGENTS)).toEqual(["claude"]);
  });

  it("parses enabled flags and always keeps Claude", () => {
    const enabled = resolveEnabledAgents(
      JSON.stringify({ claude: false, pi: true, codex: true }),
    );
    expect(enabled).toEqual({ claude: true, pi: true, codex: true });
    expect(getVisibleAgents(enabled)).toEqual(["claude", "pi", "codex"]);
  });

  it("ignores invalid JSON", () => {
    expect(resolveEnabledAgents("{not-json")).toEqual(DEFAULT_ENABLED_AGENTS);
  });

  it("reports enablement correctly", () => {
    const enabled = { claude: true as const, pi: true, codex: false };
    expect(isAgentEnabled("claude", enabled)).toBe(true);
    expect(isAgentEnabled("pi", enabled)).toBe(true);
    expect(isAgentEnabled("codex", enabled)).toBe(false);
  });
});
