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
  const [pendingRestoreIds, setPendingRestoreIds] = useState<string[]>([]);
  const [pendingActiveId, setPendingActiveId] = useState("");
  const [showRestoreToast, setShowRestoreToast] = useState(false);
  const [showRestoreModal, setShowRestoreModal] = useState(false);

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
      if (showRestoreToast) {
        setShowRestoreToast(false);
      }
    },
    [openTabIds, showRestoreToast],
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

  const handleRestoreSingle = useCallback((sessionId: string) => {
    setOpenTabIds((previous) =>
      previous.includes(sessionId) ? previous : [...previous, sessionId],
    );
    setActiveSessionId(sessionId);
    setPendingRestoreIds((previous) => {
      const remaining = previous.filter((id) => id !== sessionId);
      if (remaining.length === 0) {
        setShowRestoreModal(false);
        setShowRestoreToast(false);
      }
      return remaining;
    });
  }, []);

  const handleRestoreAll = useCallback(() => {
    if (pendingRestoreIds.length === 0) return;
    setOpenTabIds((previous) => {
      const merged = [...previous];
      for (const sessionId of pendingRestoreIds) {
        if (!merged.includes(sessionId)) merged.push(sessionId);
      }
      return merged;
    });
    if (pendingActiveId) {
      setActiveSessionId(pendingActiveId);
    } else if (pendingRestoreIds.length > 0) {
      setActiveSessionId(pendingRestoreIds[pendingRestoreIds.length - 1]);
    }
    setPendingRestoreIds([]);
    setShowRestoreModal(false);
    setShowRestoreToast(false);
  }, [pendingActiveId, pendingRestoreIds]);

  const handleRestoreIgnore = useCallback(() => {
    setPendingRestoreIds([]);
    setShowRestoreModal(false);
    setShowRestoreToast(false);
  }, []);

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
    event.dataTransfer.setData("text/plain", index.toString());
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

  const handleDrop = useCallback((event: DragEvent) => {
    event.preventDefault();
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
    highlightSessionId,
    setHighlightSessionId,
    tabContextMenu,
    setTabContextMenu,
    renamingTabId,
    setRenamingTabId,
    renamingTabText,
    setRenamingTabText,
    pendingRestoreIds,
    setPendingRestoreIds,
    pendingActiveId,
    setPendingActiveId,
    showRestoreToast,
    setShowRestoreToast,
    showRestoreModal,
    setShowRestoreModal,
    handleSelectSession,
    handleCloseTab,
    handleRestoreSingle,
    handleRestoreAll,
    handleRestoreIgnore,
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
