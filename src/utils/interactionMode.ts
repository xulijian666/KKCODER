export type ClaudeInteractionMode = "cli" | "gui";

export const CLAUDE_INTERACTION_MODE_KEY = "kkcoder_setting_claude_interaction_mode";

export const CLAUDE_INTERACTION_MODE_CHANGE_EVENT = "kkcoder-claude-interaction-mode-change";

export const resolveClaudeInteractionMode = (value: string | null): ClaudeInteractionMode => {
  return value === "gui" ? "gui" : "cli";
};

/** 仅 Claude 支持 GUI 聊天模式；pi/codex 恒走 CLI 终端 */
export const shouldUseGuiChat = (
  agentType: string,
  mode: ClaudeInteractionMode,
): boolean => {
  return agentType === "claude" && mode === "gui";
};
