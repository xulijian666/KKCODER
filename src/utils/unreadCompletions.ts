export function addUnreadCompletion(
  unreadSessionIds: string[],
  completedSessionId: string,
  activeSessionId: string,
  isWindowFocused = true
): string[] {
  // 窗口聚焦且是当前活动会话时完成：用户正看着，不提示
  if (isWindowFocused && completedSessionId === activeSessionId) return unreadSessionIds;
  if (unreadSessionIds.includes(completedSessionId)) return unreadSessionIds;
  return [...unreadSessionIds, completedSessionId];
}

export function markSessionRead(
  unreadSessionIds: string[],
  sessionId: string
): string[] {
  if (!sessionId || !unreadSessionIds.includes(sessionId)) return unreadSessionIds;
  return unreadSessionIds.filter((id) => id !== sessionId);
}

export function getUnreadCompletionCount(unreadSessionIds: string[]): number {
  return unreadSessionIds.length;
}
