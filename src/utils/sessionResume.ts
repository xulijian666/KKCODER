export function hasSessionDialogue(sessionId: string, storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(`kkcoder_session_has_dialogue_${sessionId}`) === "true";
}

/**
 * 是否应以「恢复对话」方式打开终端（Claude Code）：
 * 仅当该会话非新建、且曾有过对话时才 resume。
 */
export function shouldResumeSession(
  sessionId: string,
  newSessionIds: string[],
  storage: Pick<Storage, "getItem"> = localStorage,
): boolean {
  if (newSessionIds.includes(sessionId)) return false;
  if (!hasSessionDialogue(sessionId, storage)) return false;
  return true;
}

/** 任意路径 CMD 一键恢复 Claude 会话 */
export function buildCmdResumeCommand(projectPath: string, agentSessionId: string): string {
  return `cd /d "${projectPath}" && claude --dangerously-skip-permissions --resume ${agentSessionId}`;
}

/** 任意路径 PowerShell 一键恢复 Claude 会话 */
export function buildPowerShellResumeCommand(projectPath: string, agentSessionId: string): string {
  return `Set-Location "${projectPath}"; claude --dangerously-skip-permissions --resume ${agentSessionId}`;
}
