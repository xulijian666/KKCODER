import { useEffect, useMemo, useState } from "react";
import type { TerminalSplitPair } from "../utils/terminalSplit";
import {
  reconcileProjectTreeBindingMode,
  resolveOtherSplitSessionId,
  resolveTreeBoundSessionId,
  type ProjectTreeBindingMode,
} from "../utils/projectTreeBinding";

export interface UseProjectTreeBindingOptions {
  isDualSplit: boolean;
  activeSessionId: string;
  splitPair: TerminalSplitPair | null;
}

export interface UseProjectTreeBindingResult {
  bindingMode: ProjectTreeBindingMode;
  setBindingMode: (mode: ProjectTreeBindingMode) => void;
  treeBoundSessionId: string;
  otherSplitSessionId: string | null;
  isPinned: boolean;
}

/**
 * 分屏下项目树绑定：follow-focus | primary | secondary。
 * 单屏强制跟随聚焦。
 */
export function useProjectTreeBinding({
  isDualSplit,
  activeSessionId,
  splitPair,
}: UseProjectTreeBindingOptions): UseProjectTreeBindingResult {
  const [bindingMode, setBindingModeRaw] =
    useState<ProjectTreeBindingMode>("follow-focus");

  useEffect(() => {
    setBindingModeRaw((previous) =>
      reconcileProjectTreeBindingMode(previous, isDualSplit),
    );
  }, [isDualSplit]);

  const setBindingMode = (mode: ProjectTreeBindingMode) => {
    setBindingModeRaw(reconcileProjectTreeBindingMode(mode, isDualSplit));
  };

  const treeBoundSessionId = useMemo(
    () =>
      resolveTreeBoundSessionId(bindingMode, activeSessionId, splitPair),
    [activeSessionId, bindingMode, splitPair],
  );

  const otherSplitSessionId = useMemo(
    () => resolveOtherSplitSessionId(treeBoundSessionId, splitPair),
    [splitPair, treeBoundSessionId],
  );

  return {
    bindingMode,
    setBindingMode,
    treeBoundSessionId,
    otherSplitSessionId,
    isPinned: bindingMode !== "follow-focus",
  };
}
