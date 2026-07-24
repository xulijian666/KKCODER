export function hasSessionDialogue(sessionId: string, storage: Pick<Storage, "getItem"> = localStorage): boolean {
  return storage.getItem(`kkcoder_session_has_dialogue_${sessionId}`) === "true";
}

export interface ShouldResumeSessionOptions {
  /** Codex 必须已绑定真实 agentSessionId 才允许 resume */
  agentType?: string;
  agentSessionId?: string;
}

/**
 * 是否应以「恢复对话」方式打开终端。
 * Codex 与 Claude 不同：首次无法预生成 session id，仅当已捕获到真实 id 且曾有对话时才 resume。
 */
export function shouldResumeSession(
  sessionId: string,
  newSessionIds: string[],
  storage: Pick<Storage, "getItem"> = localStorage,
  options?: ShouldResumeSessionOptions,
): boolean {
  if (newSessionIds.includes(sessionId)) return false;
  if (!hasSessionDialogue(sessionId, storage)) return false;
  if (options?.agentType === "codex") {
    return Boolean(options.agentSessionId?.trim());
  }
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
