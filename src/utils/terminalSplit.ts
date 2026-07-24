/**
 * 终端双槽分屏：纯状态与布局计算（最多 2 路）。
 * 状态机刻意保持扁平：single | dual，不做 N 格树。
 */

import type { CSSProperties } from "react";

export const TERMINAL_SPLIT_STORAGE_KEY = "kkcoder_terminal_split_state";
/** 标签会话拖拽载荷（text/* 在各浏览器 dragover 的 types 中更稳定） */
export const SESSION_DRAG_MIME = "text/x-kkcoder-session-id";
/** 兼容旧版 MIME，读取 drop 数据时一并尝试 */
export const SESSION_DRAG_MIME_LEGACY = "application/x-kkcoder-session-id";

export function readSessionIdFromDataTransfer(
  dataTransfer: DataTransfer | null | undefined,
): string {
  if (!dataTransfer) return "";
  const fromPrimary = dataTransfer.getData(SESSION_DRAG_MIME)?.trim();
  if (fromPrimary) return fromPrimary;
  const fromLegacy = dataTransfer.getData(SESSION_DRAG_MIME_LEGACY)?.trim();
  if (fromLegacy) return fromLegacy;
  // 注意：不要用 text/plain 回退到「任意文本」——项目树拖路径也是 text/plain，
  // 误当成 sessionId 会开出脏 pair，reconcile 后表现为左侧标签/会话消失。
  return "";
}

/** 拖拽中 types 检测：优先自定义 MIME，避免把文件路径拖拽当成会话拖拽 */
export function isSessionDragEvent(dataTransfer: DataTransfer | null | undefined): boolean {
  if (!dataTransfer) return false;
  const types = Array.from(dataTransfer.types || []);
  return (
    types.includes(SESSION_DRAG_MIME) ||
    types.includes(SESSION_DRAG_MIME_LEGACY)
  );
}

export type SplitOrientation = "horizontal" | "vertical";
export type SplitPaneSlot = "primary" | "secondary";

export interface TerminalSplitPair {
  /** 左 / 上 */
  primaryId: string;
  /** 右 / 下 */
  secondaryId: string;
}

export interface PersistedTerminalSplitState {
  primaryId: string;
  secondaryId: string;
  orientation: SplitOrientation;
  ratio: number;
  /** 上次聚焦的会话（用于恢复时优先） */
  focusedSessionId: string;
}

export const SPLIT_RATIO_MIN = 0.22;
export const SPLIT_RATIO_MAX = 0.78;
export const SPLIT_RATIO_DEFAULT = 0.5;

export function clampSplitRatio(ratio: number): number {
  if (!Number.isFinite(ratio)) return SPLIT_RATIO_DEFAULT;
  return Math.min(SPLIT_RATIO_MAX, Math.max(SPLIT_RATIO_MIN, ratio));
}

export function isSplitOrientation(value: unknown): value is SplitOrientation {
  return value === "horizontal" || value === "vertical";
}

export function parsePersistedTerminalSplitState(
  raw: string | null,
): PersistedTerminalSplitState | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<PersistedTerminalSplitState>;
    if (
      typeof parsed.primaryId !== "string" ||
      typeof parsed.secondaryId !== "string" ||
      !parsed.primaryId ||
      !parsed.secondaryId ||
      parsed.primaryId === parsed.secondaryId
    ) {
      return null;
    }
    const orientation = isSplitOrientation(parsed.orientation)
      ? parsed.orientation
      : "horizontal";
    const ratio = clampSplitRatio(
      typeof parsed.ratio === "number" ? parsed.ratio : SPLIT_RATIO_DEFAULT,
    );
    const focusedSessionId =
      typeof parsed.focusedSessionId === "string" && parsed.focusedSessionId
        ? parsed.focusedSessionId
        : parsed.primaryId;
    return {
      primaryId: parsed.primaryId,
      secondaryId: parsed.secondaryId,
      orientation,
      ratio,
      focusedSessionId,
    };
  } catch {
    return null;
  }
}

export function serializeTerminalSplitState(
  state: PersistedTerminalSplitState,
): string {
  return JSON.stringify({
    primaryId: state.primaryId,
    secondaryId: state.secondaryId,
    orientation: state.orientation,
    ratio: clampSplitRatio(state.ratio),
    focusedSessionId: state.focusedSessionId,
  });
}

/** 分屏可见会话；单屏时仅为活动会话 */
export function resolveVisibleSessionIds(
  activeSessionId: string,
  pair: TerminalSplitPair | null,
): string[] {
  if (!pair) {
    return activeSessionId ? [activeSessionId] : [];
  }
  return [pair.primaryId, pair.secondaryId];
}

export function isSessionVisibleInSplit(
  sessionId: string,
  activeSessionId: string,
  pair: TerminalSplitPair | null,
): boolean {
  return resolveVisibleSessionIds(activeSessionId, pair).includes(sessionId);
}

export function resolvePaneSlotForSession(
  sessionId: string,
  pair: TerminalSplitPair | null,
): SplitPaneSlot | null {
  if (!pair) return sessionId ? "primary" : null;
  if (sessionId === pair.primaryId) return "primary";
  if (sessionId === pair.secondaryId) return "secondary";
  return null;
}

/**
 * 激活某会话时，在 dual 下如何更新 pair：
 * - 已在某一格 → pair 不变（仅切换焦点）
 * - 不在两格内 → **只替换左侧 primary**，右侧 secondary 固定
 *   （右侧只能通过「在另一侧打开分屏」或拖到右侧改）
 */
export function resolvePairAfterActivate(
  pair: TerminalSplitPair | null,
  _previousActiveId: string,
  nextSessionId: string,
): TerminalSplitPair | null {
  if (!pair || !nextSessionId) return pair;
  if (nextSessionId === pair.primaryId || nextSessionId === pair.secondaryId) {
    return pair;
  }
  return { primaryId: nextSessionId, secondaryId: pair.secondaryId };
}

/** 关闭会话后收敛 pair；返回 null 表示退回单屏 */
export function resolvePairAfterClose(
  pair: TerminalSplitPair | null,
  closedSessionId: string,
): { pair: TerminalSplitPair | null; nextActiveId: string | null } {
  if (!pair) {
    return { pair: null, nextActiveId: null };
  }
  if (closedSessionId === pair.primaryId) {
    return { pair: null, nextActiveId: pair.secondaryId };
  }
  if (closedSessionId === pair.secondaryId) {
    return { pair: null, nextActiveId: pair.primaryId };
  }
  return { pair, nextActiveId: null };
}

/** openTabIds 变化时：缺席的格子导致退回单屏或提升另一格 */
export function reconcilePairWithOpenTabs(
  pair: TerminalSplitPair | null,
  openTabIds: string[],
): TerminalSplitPair | null {
  if (!pair) return null;
  const primaryOpen = openTabIds.includes(pair.primaryId);
  const secondaryOpen = openTabIds.includes(pair.secondaryId);
  if (primaryOpen && secondaryOpen) return pair;
  return null;
}

/**
 * 为 keep-alive 宿主计算绝对定位，避免切换格子时卸载终端实例。
 * ratio 为 primary 占比；resizer 厚度由 CSS 负责，这里只算两半区域。
 */
export function resolvePaneHostStyle(
  slot: SplitPaneSlot | "hidden",
  orientation: SplitOrientation,
  ratio: number,
): CSSProperties {
  if (slot === "hidden") {
    return {
      display: "none",
      position: "absolute",
      inset: 0,
      pointerEvents: "none",
    };
  }

  const safeRatio = clampSplitRatio(ratio);
  const primaryPercent = `${safeRatio * 100}%`;
  const secondaryPercent = `${(1 - safeRatio) * 100}%`;

  if (orientation === "horizontal") {
    if (slot === "primary") {
      return {
        display: "flex",
        flexDirection: "column",
        position: "absolute",
        top: 0,
        bottom: 0,
        left: 0,
        width: primaryPercent,
        overflow: "hidden",
      };
    }
    return {
      display: "flex",
      flexDirection: "column",
      position: "absolute",
      top: 0,
      bottom: 0,
      left: primaryPercent,
      width: secondaryPercent,
      overflow: "hidden",
    };
  }

  if (slot === "primary") {
    return {
      display: "flex",
      flexDirection: "column",
      position: "absolute",
      left: 0,
      right: 0,
      top: 0,
      height: primaryPercent,
      overflow: "hidden",
    };
  }
  return {
    display: "flex",
    flexDirection: "column",
    position: "absolute",
    left: 0,
    right: 0,
    top: primaryPercent,
    height: secondaryPercent,
    overflow: "hidden",
  };
}

/** 分割条定位 */
export function resolveSplitResizerStyle(
  orientation: SplitOrientation,
  ratio: number,
): CSSProperties {
  const safeRatio = clampSplitRatio(ratio);
  // 仅左右分屏：加宽命中区（12px），避免拖不动
  if (orientation === "horizontal") {
    return {
      position: "absolute",
      top: 0,
      bottom: 0,
      left: `calc(${safeRatio * 100}% - 6px)`,
      width: "12px",
      zIndex: 30,
      cursor: "col-resize",
      pointerEvents: "auto",
      touchAction: "none",
    };
  }
  return {
    position: "absolute",
    left: 0,
    right: 0,
    top: `calc(${safeRatio * 100}% - 6px)`,
    height: "12px",
    zIndex: 30,
    cursor: "row-resize",
    pointerEvents: "auto",
    touchAction: "none",
  };
}

/** 从打开列表中挑「另一侧」候选：优先活动会话相邻 tab */
export function pickSplitCompanionSessionId(
  openTabIds: string[],
  activeSessionId: string,
  preferredSessionId?: string,
): string | null {
  if (preferredSessionId && preferredSessionId !== activeSessionId) {
    if (openTabIds.includes(preferredSessionId)) return preferredSessionId;
  }
  if (openTabIds.length < 2 || !activeSessionId) return null;
  const activeIndex = openTabIds.indexOf(activeSessionId);
  if (activeIndex === -1) {
    return openTabIds.find((id) => id !== activeSessionId) ?? null;
  }
  const next = openTabIds[activeIndex + 1];
  if (next) return next;
  const prev = openTabIds[activeIndex - 1];
  if (prev) return prev;
  return openTabIds.find((id) => id !== activeSessionId) ?? null;
}

/**
 * 把「另一侧」会话标签挪到锚定会话右侧（标签栏视觉上成对）。
 * 便于多标签时立刻看出谁在分屏里。
 */
export function placeSessionBesideInTabOrder(
  openTabIds: string[],
  anchorSessionId: string,
  besideSessionId: string,
): string[] {
  if (!besideSessionId || besideSessionId === anchorSessionId) {
    return openTabIds;
  }

  const withoutBeside = openTabIds.filter((id) => id !== besideSessionId);
  const anchorIndex = withoutBeside.indexOf(anchorSessionId);
  if (anchorIndex === -1) {
    if (openTabIds.includes(besideSessionId)) return openTabIds;
    return [...openTabIds, besideSessionId];
  }

  const nextOrder = [...withoutBeside];
  nextOrder.splice(anchorIndex + 1, 0, besideSessionId);
  return nextOrder;
}
