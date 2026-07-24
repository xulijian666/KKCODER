import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import {
  clampSplitRatio,
  parsePersistedTerminalSplitState,
  pickSplitCompanionSessionId,
  reconcilePairWithOpenTabs,
  resolvePairAfterActivate,
  resolvePairAfterClose,
  resolvePaneHostStyle,
  resolvePaneSlotForSession,
  resolveSplitResizerStyle,
  resolveVisibleSessionIds,
  serializeTerminalSplitState,
  isSessionDragEvent,
  readSessionIdFromDataTransfer,
  SPLIT_RATIO_DEFAULT,
  TERMINAL_SPLIT_STORAGE_KEY,
  type SplitOrientation,
  type SplitPaneSlot,
  type TerminalSplitPair,
} from "../utils/terminalSplit";
import { requestActiveTerminalFocus } from "../utils/terminalFocus";
import { notifyWarning } from "../utils/appFeedback";

export interface UseTerminalSplitOptions {
  openTabIds: string[];
  activeSessionId: string;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  /** 标签恢复完成后再尝试读持久化分屏 */
  restoreEnabled?: boolean;
  /** 确保会话进入 openTabIds（侧栏/菜单打开分屏时） */
  ensureTabOpen?: (sessionId: string) => void;
  /** 批量保证多个会话标签已打开（拖拽分屏时同步） */
  ensureTabsOpen?: (sessionIds: string[]) => void;
}

export interface UseTerminalSplitResult {
  isDual: boolean;
  pair: TerminalSplitPair | null;
  orientation: SplitOrientation;
  ratio: number;
  isResizing: boolean;
  focusedPane: SplitPaneSlot;
  visibleSessionIds: string[];
  paneSlotFor: (sessionId: string) => SplitPaneSlot | null;
  hostStyleFor: (sessionId: string) => CSSProperties;
  resizerStyle: CSSProperties | null;
  canEnterSplit: boolean;
  enterSplitWithSession: (sessionId: string) => void;
  enterSplitWithCompanion: () => void;
  /** 单屏拖标签到右侧：目标会话钉为 secondary */
  enterSplitByDropAsSecondary: (sessionId: string) => void;
  exitSplit: () => void;
  toggleSplit: () => void;
  focusPane: (slot: SplitPaneSlot) => void;
  activateSession: (sessionId: string) => void;
  notifySessionClosed: (sessionId: string) => string | null;
  collapseToSingle: (sessionId: string) => void;
  startResize: (event: ReactMouseEvent | ReactPointerEvent) => void;
  resetRatio: () => void;
  handleSessionDropOnPane: (
    event: ReactDragEvent,
    slot: SplitPaneSlot,
  ) => boolean;
  handleSessionDragOverPane: (event: ReactDragEvent) => void;
  /** 单屏：在整个终端根节点上 dragover / drop（按左右半区分屏） */
  handleSessionDragOverRoot: (event: ReactDragEvent) => void;
  handleSessionDropOnRoot: (event: ReactDragEvent) => boolean;
  dropHighlightSlot: SplitPaneSlot | null;
  setDropHighlightSlot: Dispatch<SetStateAction<SplitPaneSlot | null>>;
}

export function useTerminalSplit({
  openTabIds,
  activeSessionId,
  setActiveSessionId,
  restoreEnabled = true,
  ensureTabOpen,
  ensureTabsOpen,
}: UseTerminalSplitOptions): UseTerminalSplitResult {
  const [pair, setPair] = useState<TerminalSplitPair | null>(null);
  const [orientation] = useState<SplitOrientation>("horizontal");
  const [ratio, setRatio] = useState(SPLIT_RATIO_DEFAULT);
  const [isResizing, setIsResizing] = useState(false);
  const [dropHighlightSlot, setDropHighlightSlot] = useState<SplitPaneSlot | null>(
    null,
  );
  const [hasRestored, setHasRestored] = useState(false);
  const splitRootRef = useRef<HTMLElement | null>(null);

  const pairRef = useRef(pair);
  pairRef.current = pair;
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const openTabIdsRef = useRef(openTabIds);
  openTabIdsRef.current = openTabIds;

  const isDual = pair !== null;

  const focusedPane: SplitPaneSlot = useMemo(() => {
    if (!pair) return "primary";
    if (activeSessionId === pair.secondaryId) return "secondary";
    return "primary";
  }, [activeSessionId, pair]);

  const visibleSessionIds = useMemo(
    () => resolveVisibleSessionIds(activeSessionId, pair),
    [activeSessionId, pair],
  );

  const canEnterSplit = openTabIds.length >= 2 && Boolean(activeSessionId);

  useEffect(() => {
    if (hasRestored || !restoreEnabled) return;

    const persisted = parsePersistedTerminalSplitState(
      localStorage.getItem(TERMINAL_SPLIT_STORAGE_KEY),
    );

    if (!persisted) {
      setHasRestored(true);
      return;
    }

    if (openTabIds.length < 2) {
      // 标签可能晚一帧到达；短暂等待后再放弃
      const timer = window.setTimeout(() => {
        if (openTabIdsRef.current.length < 2) {
          setHasRestored(true);
        }
      }, 120);
      return () => window.clearTimeout(timer);
    }

    setHasRestored(true);
    if (
      !openTabIds.includes(persisted.primaryId) ||
      !openTabIds.includes(persisted.secondaryId)
    ) {
      localStorage.removeItem(TERMINAL_SPLIT_STORAGE_KEY);
      return;
    }

    setPair({
      primaryId: persisted.primaryId,
      secondaryId: persisted.secondaryId,
    });
    // 产品仅支持左右分屏，忽略历史 vertical
    setRatio(clampSplitRatio(persisted.ratio));
    const focusId = openTabIds.includes(persisted.focusedSessionId)
      ? persisted.focusedSessionId
      : persisted.primaryId;
    setActiveSessionId(focusId);
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 80);
  }, [hasRestored, openTabIds, restoreEnabled, setActiveSessionId]);

  useEffect(() => {
    if (!hasRestored) return;
    if (!pair) {
      localStorage.removeItem(TERMINAL_SPLIT_STORAGE_KEY);
      return;
    }
    localStorage.setItem(
      TERMINAL_SPLIT_STORAGE_KEY,
      serializeTerminalSplitState({
        primaryId: pair.primaryId,
        secondaryId: pair.secondaryId,
        orientation: "horizontal",
        ratio,
        focusedSessionId: activeSessionId || pair.primaryId,
      }),
    );
  }, [activeSessionId, hasRestored, pair, ratio]);

  useEffect(() => {
    setPair((previous) => reconcilePairWithOpenTabs(previous, openTabIds));
  }, [openTabIds]);

  const paneSlotFor = useCallback(
    (sessionId: string): SplitPaneSlot | null => {
      if (!sessionId) return null;
      if (!pair) {
        return sessionId === activeSessionId ? "primary" : null;
      }
      return resolvePaneSlotForSession(sessionId, pair);
    },
    [activeSessionId, pair],
  );

  const hostStyleFor = useCallback(
    (sessionId: string): CSSProperties => {
      if (!pair) {
        const isVisible = sessionId === activeSessionId;
        return isVisible
          ? {
              display: "flex",
              flexDirection: "column",
              position: "absolute",
              inset: 0,
              overflow: "hidden",
            }
          : {
              display: "none",
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            };
      }
      const slot = resolvePaneSlotForSession(sessionId, pair);
      if (!slot) {
        return resolvePaneHostStyle("hidden", orientation, ratio);
      }
      return resolvePaneHostStyle(slot, orientation, ratio);
    },
    [activeSessionId, orientation, pair, ratio],
  );

  const resizerStyle = useMemo(() => {
    if (!pair) return null;
    // 仅左右分屏；加宽命中区，避免拖不动
    return resolveSplitResizerStyle("horizontal", ratio);
  }, [pair, ratio]);

  const activateSession = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;
      const previousActive = activeSessionIdRef.current;
      setPair((current) =>
        resolvePairAfterActivate(current, previousActive, sessionId),
      );
      setActiveSessionId(sessionId);
      requestActiveTerminalFocus({ delayMs: 56, sessionId });
    },
    [setActiveSessionId],
  );

  const enterSplitWithSession = useCallback(
    (sessionId: string) => {
      const activeId = activeSessionIdRef.current;
      if (!sessionId) return;

      // 无活动会话：仅打开该会话
      if (!activeId) {
        ensureTabOpen?.(sessionId);
        setActiveSessionId(sessionId);
        return;
      }

      // 右键「在另一侧打开 / 与相邻分屏」：active 固定左侧，目标固定右侧
      if (sessionId === activeId) {
        const companion = pickSplitCompanionSessionId(
          openTabIdsRef.current,
          activeId,
        );
        if (!companion) {
          notifyWarning("至少再打开一个标签才能分屏");
          return;
        }
        ensureTabOpen?.(companion);
        setPair({ primaryId: activeId, secondaryId: companion });
        setActiveSessionId(companion);
        requestActiveTerminalFocus({ delayMs: 72, sessionId: companion });
        window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
        return;
      }

      ensureTabOpen?.(sessionId);
      setPair({ primaryId: activeId, secondaryId: sessionId });
      setActiveSessionId(sessionId);
      requestActiveTerminalFocus({ delayMs: 72, sessionId });
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
    },
    [ensureTabOpen, setActiveSessionId],
  );

  /**
   * 单屏时把某标签拖到右侧区域：
   * - 被拖拽的会话固定到右侧 secondary
   * - 另一侧会话固定到左侧 primary（优先当前活动会话；拖的就是活动会话时用相邻标签）
   * - 两侧都必须在 openTabIds 内，否则会立刻被 reconcile 拆掉分屏，表现为「左侧标签消失」
   */
  const enterSplitByDropAsSecondary = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;

      const openIds = openTabIdsRef.current;
      // 必须是当前已打开的标签；否则不要用脏数据开分屏
      if (!openIds.includes(sessionId)) {
        notifyWarning("只能把已打开的标签拖到右侧分屏");
        return;
      }

      const activeId = activeSessionIdRef.current;
      const secondaryId = sessionId;

      let primaryId: string | null = null;
      if (activeId && activeId !== secondaryId && openIds.includes(activeId)) {
        primaryId = activeId;
      } else {
        primaryId = pickSplitCompanionSessionId(openIds, secondaryId);
      }

      if (!primaryId || primaryId === secondaryId || !openIds.includes(primaryId)) {
        notifyWarning("至少再打开一个标签才能分屏");
        setActiveSessionId(secondaryId);
        return;
      }

      // 同步保证两侧都在 openTabIds（防止 reconcile 立刻清掉 pair）
      ensureTabsOpen?.([primaryId, secondaryId]);
      ensureTabOpen?.(primaryId);
      ensureTabOpen?.(secondaryId);

      setPair({ primaryId, secondaryId });
      setActiveSessionId(secondaryId);
      requestActiveTerminalFocus({ delayMs: 72, sessionId: secondaryId });
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
    },
    [ensureTabOpen, ensureTabsOpen, setActiveSessionId],
  );

  const enterSplitWithCompanion = useCallback(() => {
    const activeId = activeSessionIdRef.current;
    const companion = pickSplitCompanionSessionId(openTabIdsRef.current, activeId);
    if (!activeId || !companion) {
      notifyWarning("至少再打开一个标签才能分屏");
      return;
    }
    enterSplitWithSession(companion);
  }, [enterSplitWithSession]);

  const exitSplit = useCallback(() => {
    setPair(null);
    window.setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
      requestActiveTerminalFocus({
        delayMs: 56,
        sessionId: activeSessionIdRef.current || undefined,
      });
    }, 40);
  }, []);

  const toggleSplit = useCallback(() => {
    if (pairRef.current) {
      exitSplit();
      return;
    }
    enterSplitWithCompanion();
  }, [enterSplitWithCompanion, exitSplit]);

  const focusPane = useCallback(
    (slot: SplitPaneSlot) => {
      const current = pairRef.current;
      if (!current) return;
      const sessionId =
        slot === "primary" ? current.primaryId : current.secondaryId;
      if (!sessionId || sessionId === activeSessionIdRef.current) {
        requestActiveTerminalFocus({ delayMs: 0, sessionId });
        return;
      }
      setActiveSessionId(sessionId);
      requestActiveTerminalFocus({ delayMs: 40, sessionId });
    },
    [setActiveSessionId],
  );

  const notifySessionClosed = useCallback((sessionId: string): string | null => {
    const result = resolvePairAfterClose(pairRef.current, sessionId);
    setPair(result.pair);
    return result.nextActiveId;
  }, []);

  const collapseToSingle = useCallback(
    (sessionId: string) => {
      setPair(null);
      setActiveSessionId(sessionId);
      requestActiveTerminalFocus({ delayMs: 56, sessionId });
    },
    [setActiveSessionId],
  );

  const startResize = useCallback((event: ReactMouseEvent | ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const root = target.closest(".terminal-split-root") as HTMLElement | null;
    splitRootRef.current = root;

    // pointer capture：避免鼠标移入终端/webview 后丢事件导致拖不动
    const pointerEvent = event.nativeEvent as PointerEvent;
    if (
      typeof pointerEvent.pointerId === "number" &&
      target.setPointerCapture
    ) {
      try {
        target.setPointerCapture(pointerEvent.pointerId);
      } catch {
        // 部分环境不支持 capture，仍走 document 监听
      }
    }

    setIsResizing(true);
  }, []);

  const resetRatio = useCallback(() => {
    setRatio(SPLIT_RATIO_DEFAULT);
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
  }, []);

  useEffect(() => {
    if (!isResizing) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.body.classList.add("terminal-split-resizing");

    const handlePointerMove = (event: PointerEvent) => {
      const root =
        splitRootRef.current ||
        (document.querySelector(".terminal-split-root") as HTMLElement | null);
      if (!root) return;
      const bounds = root.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const nextRatio = (event.clientX - bounds.left) / bounds.width;
      setRatio(clampSplitRatio(nextRatio));
      window.dispatchEvent(new Event("resize"));
    };

    const handlePointerUp = () => {
      setIsResizing(false);
      splitRootRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("terminal-split-resizing");
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    };

    // 同时监听 mouse 与 pointer，兼容不同宿主
    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    document.addEventListener("mousemove", handlePointerMove as EventListener);
    document.addEventListener("mouseup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      document.removeEventListener("mousemove", handlePointerMove as EventListener);
      document.removeEventListener("mouseup", handlePointerUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("terminal-split-resizing");
    };
  }, [isResizing]);

  const handleSessionDragOverPane = useCallback((event: ReactDragEvent) => {
    if (!isSessionDragEvent(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  /**
   * 单屏：根据指针在 split root 内的左右半区决定 drop 槽位。
   * 右半区 → secondary（开启分屏）；左半区 → 仅激活。
   */
  const resolveSingleModeDropSlot = useCallback(
    (clientX: number): SplitPaneSlot => {
      const root =
        splitRootRef.current ||
        (document.querySelector(".terminal-split-root") as HTMLElement | null);
      if (!root) return "primary";
      const bounds = root.getBoundingClientRect();
      if (bounds.width <= 0) return "primary";
      const isRightHalf = clientX > bounds.left + bounds.width * 0.5;
      return isRightHalf ? "secondary" : "primary";
    },
    [],
  );

  const handleSessionDragOverRoot = useCallback(
    (event: ReactDragEvent) => {
      if (!isSessionDragEvent(event.dataTransfer)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      // 双屏时由各 pane 自己高亮；单屏时根据左右半区提示
      if (pairRef.current) return;
      const slot = resolveSingleModeDropSlot(event.clientX);
      setDropHighlightSlot(slot === "secondary" ? "secondary" : null);
    },
    [resolveSingleModeDropSlot],
  );

  const handleSessionDropOnRoot = useCallback(
    (event: ReactDragEvent): boolean => {
      if (!isSessionDragEvent(event.dataTransfer)) return false;
      const sessionId = readSessionIdFromDataTransfer(event.dataTransfer);
      setDropHighlightSlot(null);
      if (!sessionId) return false;

      event.preventDefault();
      event.stopPropagation();

      // 已在双屏：root 不处理，交给具体 pane
      if (pairRef.current) return false;

      const slot = resolveSingleModeDropSlot(event.clientX);
      if (slot === "secondary") {
        enterSplitByDropAsSecondary(sessionId);
        return true;
      }
      activateSession(sessionId);
      return true;
    },
    [activateSession, enterSplitByDropAsSecondary, resolveSingleModeDropSlot],
  );

  const handleSessionDropOnPane = useCallback(
    (event: ReactDragEvent, slot: SplitPaneSlot): boolean => {
      const sessionId = readSessionIdFromDataTransfer(event.dataTransfer);
      setDropHighlightSlot(null);
      if (!sessionId) return false;
      event.preventDefault();
      event.stopPropagation();

      const current = pairRef.current;

      // 单屏：落到「右半」语义槽 → 开启分屏并钉到右侧
      if (!current) {
        if (slot === "secondary") {
          enterSplitByDropAsSecondary(sessionId);
          return true;
        }
        activateSession(sessionId);
        return true;
      }

      // 双屏：左侧可换会话；右侧仅在明确 drop 到右半时更换（不随点击）
      if (slot === "primary") {
        if (sessionId === current.primaryId) {
          activateSession(sessionId);
          return true;
        }
        if (sessionId === current.secondaryId) {
          // 左右对调
          setPair({
            primaryId: current.secondaryId,
            secondaryId: current.primaryId,
          });
          setActiveSessionId(sessionId);
          requestActiveTerminalFocus({ delayMs: 56, sessionId });
          return true;
        }
        setPair({
          primaryId: sessionId,
          secondaryId: current.secondaryId,
        });
        setActiveSessionId(sessionId);
        requestActiveTerminalFocus({ delayMs: 56, sessionId });
        return true;
      }

      // secondary 槽：显式拖入才改右侧
      if (sessionId === current.secondaryId) {
        activateSession(sessionId);
        return true;
      }
      if (sessionId === current.primaryId) {
        setPair({
          primaryId: current.secondaryId,
          secondaryId: current.primaryId,
        });
        setActiveSessionId(sessionId);
        requestActiveTerminalFocus({ delayMs: 56, sessionId });
        return true;
      }
      setPair({
        primaryId: current.primaryId,
        secondaryId: sessionId,
      });
      setActiveSessionId(sessionId);
      requestActiveTerminalFocus({ delayMs: 56, sessionId });
      return true;
    },
    [activateSession, enterSplitByDropAsSecondary, setActiveSessionId],
  );

  return {
    isDual,
    pair,
    orientation,
    ratio,
    isResizing,
    focusedPane,
    visibleSessionIds,
    paneSlotFor,
    hostStyleFor,
    resizerStyle,
    canEnterSplit,
    enterSplitWithSession,
    enterSplitWithCompanion,
    enterSplitByDropAsSecondary,
    exitSplit,
    toggleSplit,
    focusPane,
    activateSession,
    notifySessionClosed,
    collapseToSingle,
    startResize,
    resetRatio,
    handleSessionDropOnPane,
    handleSessionDragOverPane,
    handleSessionDragOverRoot,
    handleSessionDropOnRoot,
    dropHighlightSlot,
    setDropHighlightSlot,
  };
}
