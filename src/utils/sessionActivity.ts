export interface SessionActivityLike {
  createdAt?: string;
  lastUserMessageAt?: string;
}

export interface SessionActivityCollectionLike {
  sessions: SessionActivityLike[];
}

function parseSessionDate(value?: string): number {
  if (!value) return 0;

  const normalized = value.includes("T") ? value : `${value.replace(" ", "T")}Z`;
  const timestamp = new Date(normalized).getTime();
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function getSessionActivityTimestamp(session: SessionActivityLike): number {
  return parseSessionDate(session.lastUserMessageAt) || parseSessionDate(session.createdAt);
}

export function formatRelativeSessionActivityTime(
  session: SessionActivityLike,
  now: Date = new Date(),
): string {
  const activityTimestamp = getSessionActivityTimestamp(session);
  if (!activityTimestamp) return "刚刚";

  const diffMs = now.getTime() - activityTimestamp;
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return "刚刚";
  if (diffMins < 60) return `${diffMins}分钟前`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}小时前`;

  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}天前`;
}

export function sortSessionsByActivityDesc<T extends SessionActivityLike>(sessions: T[]): T[] {
  return [...sessions].sort((left, right) => {
    return getSessionActivityTimestamp(right) - getSessionActivityTimestamp(left);
  });
}

export function sortProjectEntriesByActivityDesc<T extends SessionActivityCollectionLike>(
  projectEntries: readonly [string, T][],
): [string, T][] {
  return [...projectEntries].sort((left, right) => {
    const leftMax = Math.max(0, ...left[1].sessions.map(getSessionActivityTimestamp));
    const rightMax = Math.max(0, ...right[1].sessions.map(getSessionActivityTimestamp));
    return rightMax - leftMax;
  });
}

export function updateSessionLastUserMessageAt<
  T extends {
    id: string;
    lastUserMessageAt?: string;
  },
>(sessions: T[], sessionId: string, submittedAt: string): T[] {
  return sessions.map((session) =>
    session.id === sessionId
      ? {
          ...session,
          lastUserMessageAt: submittedAt,
        }
      : session,
  );
}
