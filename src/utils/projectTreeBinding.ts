/**
 * 分屏下项目文件树的绑定策略：单树，绑定左 / 右 / 跟随聚焦。
 */

import type { TerminalSplitPair } from "./terminalSplit";

export type ProjectTreeBindingMode = "follow-focus" | "primary" | "secondary";

export const PROJECT_TREE_BINDING_MODES: ProjectTreeBindingMode[] = [
  "follow-focus",
  "primary",
  "secondary",
];

export function isProjectTreeBindingMode(
  value: unknown,
): value is ProjectTreeBindingMode {
  return (
    value === "follow-focus" || value === "primary" || value === "secondary"
  );
}

/**
 * 解析当前应对哪一个会话展示项目树。
 * 单屏或 follow-focus：活动会话；钉住时：对应分屏槽位。
 */
export function resolveTreeBoundSessionId(
  mode: ProjectTreeBindingMode,
  activeSessionId: string,
  pair: TerminalSplitPair | null,
): string {
  if (!pair || mode === "follow-focus") {
    return activeSessionId;
  }
  if (mode === "primary") {
    return pair.primaryId;
  }
  return pair.secondaryId;
}

/** 退出分屏或槽位消失时，钉住模式回退到跟随聚焦 */
export function reconcileProjectTreeBindingMode(
  mode: ProjectTreeBindingMode,
  isDualSplit: boolean,
): ProjectTreeBindingMode {
  if (!isDualSplit && mode !== "follow-focus") {
    return "follow-focus";
  }
  return mode;
}

/** 分屏时「另一侧」会话（用于插入到另一侧） */
export function resolveOtherSplitSessionId(
  boundSessionId: string,
  pair: TerminalSplitPair | null,
): string | null {
  if (!pair || !boundSessionId) return null;
  if (boundSessionId === pair.primaryId) return pair.secondaryId;
  if (boundSessionId === pair.secondaryId) return pair.primaryId;
  return null;
}

export function describeProjectTreeBindingMode(
  mode: ProjectTreeBindingMode,
): string {
  if (mode === "primary") return "钉在左侧";
  if (mode === "secondary") return "钉在右侧";
  return "跟随聚焦";
}
