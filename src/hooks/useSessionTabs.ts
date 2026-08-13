import {
  useCallback,
  useEffect,
  useState,
  type Dispatch,
  type DragEvent,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
  type WheelEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../components/Sidebar";
import { log } from "../utils/log";
import type { AgentType } from "./useSessions";

export interface TabContextMenuState {
  x: number;
  y: number;
  sessionId: string;
}

export interface UseSessionTabsOptions {
  sessionsRef: MutableRefObject<Session[]>;
  setSessionsRef: MutableRefObject<Dispatch<SetStateAction<Session[]>>>;
  clearQueueForSessionRef: MutableRefObject<(sessionId: string) => void>;
  setSessionBusyRef: MutableRefObject<Dispatch<SetStateAction<Record<string, boolean>>>>;
  setSelectedAgent: Dispatch<SetStateAction<AgentType>>;
  setGlowingSessionIds: Dispatch<SetStateAction<string[]>>;
  handleRenameSessionRef: MutableRefObject<
    (sessionId: string, newName: string) => Promise<void> | void
  >;
}

export function useSessionTabs({
  sessionsRef,
  setSessionsRef,
  clearQueueForSessionRef,
  setSessionBusyRef,
  setSelectedAgent,
  setGlowingSessionIds,
  handleRenameSessionRef,
}: UseSessionTabsOptions) {
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState("");
  const [newSessionIds, setNewSessionIds] = useState<string[]>([]);
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [highlightSessionId, setHighlightSessionId] = useState<string | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingTabText, setRenamingTabText] = useState("");

  useEffect(() => {
    const closeTabMenu = () => setTabContextMenu(null);
    window.addEventListener("click", closeTabMenu);
    return () => window.removeEventListener("click", closeTabMenu);
  }, []);

  useEffect(() => {
    const handleCloseTabContextMenu = () => setTabContextMenu(null);
    window.addEventListener("close-tab-context-menu", handleCloseTabContextMenu);
    return () => window.removeEventListener("close-tab-context-menu", handleCloseTabContextMenu);
  }, []);

  const handleSelectSession = useCallback(
    (sessionId: string) => {
      if (!openTabIds.includes(sessionId)) {
        setOpenTabIds((previous) => [...previous, sessionId]);
      }
      setActiveSessionId(sessionId);
    },
    [openTabIds],
  );

  const handleCloseTab = useCallback(
    (event: MouseEvent, sessionId: string) => {
      event.stopPropagation();
      log(`handleCloseTab triggered: id=${sessionId}`);

      invoke("close_terminal", { sessionId }).catch((error) => {
        log(`Failed to close terminal PTY process for ${sessionId}: ${error}`);
      });

      setSessionBusyRef.current((previous) => ({ ...previous, [sessionId]: false }));
      clearQueueForSessionRef.current(sessionId);

      const closedSession = sessionsRef.current.find((session) => session.id === sessionId);
      if (closedSession?.isTemp) {
        setSessionsRef.current((previous) => previous.filter((session) => session.id !== sessionId));
      }

      const updatedTabs = openTabIds.filter((tabId) => tabId !== sessionId);
      setOpenTabIds(updatedTabs);
      setNewSessionIds((previous) => previous.filter((id) => id !== sessionId));

      if (activeSessionId === sessionId) {
        setActiveSessionId(updatedTabs.length > 0 ? updatedTabs[updatedTabs.length - 1] : "");
      }
    },
    [
      activeSessionId,
      clearQueueForSessionRef,
      openTabIds,
      sessionsRef,
      setSessionBusyRef,
      setSessionsRef,
    ],
  );

  const handleSaveTabRename = useCallback(
    (sessionId: string) => {
      if (renamingTabText.trim()) {
        handleRenameSessionRef.current(sessionId, renamingTabText.trim());
      }
      setRenamingTabId(null);
    },
    [handleRenameSessionRef, renamingTabText],
  );

  const handleLocateSession = useCallback(
    (sessionId: string) => {
      const session = sessionsRef.current.find((item) => item.id === sessionId);
      if (session) {
        setSelectedAgent(session.type);
        setHighlightSessionId(sessionId);
        log(`Locating session ${sessionId} in sidebar. Selected agent type: ${session.type}`);
      }
    },
    [sessionsRef, setSelectedAgent],
  );

  const handleTabWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    if (event.currentTarget) {
      event.currentTarget.scrollLeft += event.deltaY;
    }
  }, []);

  const handleDragStart = useCallback((event: DragEvent, index: number) => {
    event.dataTransfer.effectAllowed = "move";
    // sessionId 由 SessionTabBar 写入；这里不再用 index 覆盖 text/plain
    setTimeout(() => {
      setDraggingIndex(index);
    }, 0);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent, targetIndex: number) => {
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";

      if (draggingIndex === null || draggingIndex === targetIndex) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const midpoint = rect.left + rect.width / 2;
      const clientX = event.clientX;

      if (draggingIndex > targetIndex) {
        if (clientX < midpoint) {
          const listCopy = [...openTabIds];
          const draggedItem = listCopy[draggingIndex];
          listCopy.splice(draggingIndex, 1);
          listCopy.splice(targetIndex, 0, draggedItem);
          setDraggingIndex(targetIndex);
          setOpenTabIds(listCopy);
        }
      } else if (clientX > midpoint) {
        const listCopy = [...openTabIds];
        const draggedItem = listCopy[draggingIndex];
        listCopy.splice(draggingIndex, 1);
        listCopy.splice(targetIndex, 0, draggedItem);
        setDraggingIndex(targetIndex);
        setOpenTabIds(listCopy);
      }
    },
    [draggingIndex, openTabIds],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  const clearDragging = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
    setDraggingIndex(null);
  }, []);

  const activateTab = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      setGlowingSessionIds((previous) => previous.filter((id) => id !== sessionId));
    },
    [setGlowingSessionIds],
  );

  return {
    openTabIds,
    setOpenTabIds,
    activeSessionId,
    setActiveSessionId,
    newSessionIds,
    setNewSessionIds,
    draggingIndex,
    clearDragging,
    highlightSessionId,
    setHighlightSessionId,
    tabContextMenu,
    setTabContextMenu,
    renamingTabId,
    setRenamingTabId,
    renamingTabText,
    setRenamingTabText,
    handleSelectSession,
    handleCloseTab,
    handleSaveTabRename,
    handleLocateSession,
    handleTabWheel,
    handleDragStart,
    handleDragOver,
    handleDragEnd,
    handleDrop,
    activateTab,
  };
}
