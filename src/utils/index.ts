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
export {
  CLAUDE_INTERACTION_MODE_KEY,
  CLAUDE_INTERACTION_MODE_CHANGE_EVENT,
  resolveClaudeInteractionMode,
  shouldUseGuiChat,
  type ClaudeInteractionMode,
} from "./interactionMode";
export {
  detectChatCompletionTrigger,
  replaceChatCompletionTrigger,
  type ChatCompletionTrigger,
} from "./chatCompletion";
export { resolveTerminalWriteCommand } from "./terminalTransport";
export {
  clearSessionQueue,
  enqueueSessionTask,
  getSessionQueue,
  removeSessionTask,
  MAX_SESSION_QUEUE_SIZE,
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
export {
  notify,
  notifyInfo,
  notifySuccess,
  notifyWarning,
  notifyError,
  confirmAction,
  formatFeedbackError,
  type FeedbackTone,
  type ToastPayload,
  type ConfirmRequestOptions,
} from "./appFeedback";
export {
  FOCUS_ACTIVE_TERMINAL_EVENT,
  requestActiveTerminalFocus,
  returnFocusToActiveTerminal,
  isEditableFocusTarget,
  isFocusBlockingOverlay,
} from "./terminalFocus";
export {
  SESSION_DRAG_MIME,
  SESSION_DRAG_MIME_LEGACY,
  TERMINAL_SPLIT_STORAGE_KEY,
  isSessionDragEvent,
  readSessionIdFromDataTransfer,
  clampSplitRatio,
  pickSplitCompanionSessionId,
  placeSessionBesideInTabOrder,
  type SplitOrientation,
  type SplitPaneSlot,
  type TerminalSplitPair,
} from "./terminalSplit";
export {
  resolveTreeBoundSessionId,
  reconcileProjectTreeBindingMode,
  resolveOtherSplitSessionId,
  describeProjectTreeBindingMode,
  type ProjectTreeBindingMode,
} from "./projectTreeBinding";
