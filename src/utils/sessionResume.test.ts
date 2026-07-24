import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildCmdResumeCommand,
  buildPowerShellResumeCommand,
  hasSessionDialogue,
  shouldResumeSession,
} from "./sessionResume.ts";

describe("sessionResume commands", () => {
  const path = "D:\\MyCode\\KKCODER";
  const id = "7ae87af6-df90-4cae-81e2-0c34c26eb1e8";

  it("builds a one-line CMD resume command", () => {
    assert.equal(
      buildCmdResumeCommand(path, id),
      `cd /d "D:\\MyCode\\KKCODER" && claude --dangerously-skip-permissions --resume 7ae87af6-df90-4cae-81e2-0c34c26eb1e8`,
    );
  });

  it("builds a one-line PowerShell resume command", () => {
    assert.equal(
      buildPowerShellResumeCommand(path, id),
      `Set-Location "D:\\MyCode\\KKCODER"; claude --dangerously-skip-permissions --resume 7ae87af6-df90-4cae-81e2-0c34c26eb1e8`,
    );
  });
});

describe("sessionResume dialogue flags", () => {
  it("detects dialogue and reopen eligibility", () => {
    const storage = {
      getItem: (key: string) => (key === "kkcoder_session_has_dialogue_s1" ? "true" : null),
    };
    assert.equal(hasSessionDialogue("s1", storage), true);
    assert.equal(shouldResumeSession("s1", [], storage), true);
    assert.equal(shouldResumeSession("s1", ["s1"], storage), false);
  });

  it("requires codex agentSessionId before resume", () => {
    const storage = {
      getItem: (key: string) => (key === "kkcoder_session_has_dialogue_s1" ? "true" : null),
    };
    assert.equal(
      shouldResumeSession("s1", [], storage, { agentType: "codex", agentSessionId: "" }),
      false,
    );
    assert.equal(
      shouldResumeSession("s1", [], storage, {
        agentType: "codex",
        agentSessionId: "019f8fe1-1bac-7293-b0c4-b811a5cf95ca",
      }),
      true,
    );
  });
});
