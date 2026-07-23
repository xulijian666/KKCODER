export { generateUUID } from "./uuid";
export { log } from "./log";
export { getFolderName } from "./pathHelpers";
export {
  applyTheme,
  readStoredTheme,
  persistTheme,
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
} from "./theme";
export {
  addUnreadCompletion,
  getUnreadCompletionCount,
  markSessionRead,
} from "./unreadCompletions";
export { updateSessionLastUserMessageAt } from "./sessionActivity";
export { readSessionCleanupSettings } from "./sessionCleanup";
export { shouldResumeSession } from "./sessionResume";
export { syncTaskbarUnreadBadge } from "./taskbarBadge";
export {
  CLAUDE_TERMINAL_MODE_KEY,
  resolveClaudeTerminalMode,
  shouldUseNativeTerminal,
  type ClaudeTerminalMode,
} from "./terminalMode";
export { resolveTerminalWriteCommand } from "./terminalTransport";
export {
  clearSessionQueue,
  enqueueSessionTask,
  getSessionQueue,
  removeSessionTask,
  type QueueBySession,
} from "./sessionQueue";
export {
  ENABLED_AGENTS_KEY,
  ENABLED_AGENTS_CHANGE_EVENT,
  DEFAULT_ENABLED_AGENTS,
  resolveEnabledAgents,
  loadEnabledAgents,
  saveEnabledAgents,
  getVisibleAgents,
  isAgentEnabled,
  type AgentType,
  type EnabledAgents,
} from "./enabledAgents";
