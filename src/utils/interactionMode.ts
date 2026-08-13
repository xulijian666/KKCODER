export type ClaudeInteractionMode = "cli" | "gui";

export const CLAUDE_INTERACTION_MODE_KEY = "kkcoder_setting_claude_interaction_mode";

export const CLAUDE_INTERACTION_MODE_CHANGE_EVENT = "kkcoder-claude-interaction-mode-change";

export const resolveClaudeInteractionMode = (value: string | null): ClaudeInteractionMode => {
  return value === "gui" ? "gui" : "cli";
};

/** Claude Code 的交互模式：gui 时才走聊天界面（仅 Claude 存在，恒 claude 会话） */
export const shouldUseGuiChat = (
  agentType: string,
  mode: ClaudeInteractionMode,
): boolean => {
  return agentType === "claude" && mode === "gui";
};
