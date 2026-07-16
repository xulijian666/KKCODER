export function hasSessionDialogue(sessionId: string, storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(`kkcoder_session_has_dialogue_${sessionId}`) === "true";
}

export function shouldResumeSession(
  sessionId: string,
  newSessionIds: string[],
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  return !newSessionIds.includes(sessionId) && hasSessionDialogue(sessionId, storage);
}

/** 任意路径 CMD 一键恢复 Claude 会话 */
export function buildCmdResumeCommand(projectPath: string, agentSessionId: string): string {
  return `cd /d "${projectPath}" && claude --dangerously-skip-permissions --resume ${agentSessionId}`;
}

/** 任意路径 PowerShell 一键恢复 Claude 会话 */
export function buildPowerShellResumeCommand(projectPath: string, agentSessionId: string): string {
  return `Set-Location "${projectPath}"; claude --dangerously-skip-permissions --resume ${agentSessionId}`;
}
