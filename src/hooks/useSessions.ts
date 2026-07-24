import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type MouseEvent,
  type MutableRefObject,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../components/Sidebar";
import { generateUUID } from "../utils/uuid";
import { log } from "../utils/log";
import { readSessionCleanupSettings } from "../utils/sessionCleanup";
import type { AgentType } from "../utils/enabledAgents";
import { formatFeedbackError, notifyError } from "../utils/appFeedback";

const CLAUDE_VERSION_CACHE_KEY = "kkcoder_cached_claude_version";

export type { AgentType } from "../utils/enabledAgents";

export interface UseSessionsOptions {
  selectedAgent: AgentType;
  /** Latest open tabs (ref avoids circular hook deps with useSessionTabs). */
  openTabIdsRef: MutableRefObject<string[]>;
  activeSessionIdRef: MutableRefObject<string>;
  setOpenTabIds: Dispatch<SetStateAction<string[]>>;
  setActiveSessionId: Dispatch<SetStateAction<string>>;
  setNewSessionIds: Dispatch<SetStateAction<string[]>>;
  clearQueueForSessionRef: MutableRefObject<(sessionId: string) => void>;
  /** Prefer a stable ref.current callback — never put a per-render lambda in deps. */
  triggerAutoRenameRef: MutableRefObject<(source: string) => void>;
  setClaudeVersion: Dispatch<SetStateAction<string>>;
  setPendingRestoreIds: Dispatch<SetStateAction<string[]>>;
  setPendingActiveId: Dispatch<SetStateAction<string>>;
  setShowRestoreToast: Dispatch<SetStateAction<boolean>>;
  setIsInitLoaded: Dispatch<SetStateAction<boolean>>;
}
export function useSessions({
  selectedAgent,
  openTabIdsRef,
  activeSessionIdRef,
  setOpenTabIds,
  setActiveSessionId,
  setNewSessionIds,
  clearQueueForSessionRef,
  triggerAutoRenameRef,
  setClaudeVersion,
  setPendingRestoreIds,
  setPendingActiveId,
  setShowRestoreToast,
  setIsInitLoaded,
}: UseSessionsOptions) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const sessionsRef = useRef<Session[]>([]);
  sessionsRef.current = sessions;

  useEffect(() => {
    const handleArchiveRestored = () => {
      invoke<Session[]>("get_sessions")
        .then((data) => {
          setSessions(data || []);
        })
        .catch((error) => console.error("Failed to reload sessions after archive restore:", error));
    };
    window.addEventListener("archive-sessions-restored", handleArchiveRestored);
    return () => window.removeEventListener("archive-sessions-restored", handleArchiveRestored);
  }, []);

  // Mount once: do not depend on parent callbacks (they change every render and re-fetch SQLite).
  useEffect(() => {
    let claudeVersionTimer: number | null = null;
    let diagnosticsTimer: number | null = null;
    let startupRenameTimer: number | null = null;
    let cancelled = false;

    const scheduleDeferredDiagnostics = () => {
      diagnosticsTimer = window.setTimeout(() => {
        try {
          const persistedLogs = JSON.parse(localStorage.getItem("kkcoder_logs") || "[]");
          if (persistedLogs.length > 0) {
            console.group("=== KkCoder 历史崩溃/运行追踪日志 ===");
            persistedLogs.forEach((entry: string) => console.log(entry));
            console.groupEnd();
          }
        } catch {
          // ignore
        }
      }, 2000);
    };

    const fetchClaudeVersion = () => {
      invoke<string>("get_claude_version")
        .then((version) => {
          if (cancelled) return;
          setClaudeVersion(version);
          localStorage.setItem(CLAUDE_VERSION_CACHE_KEY, version);
        })
        .catch(() => {});
    };

    const scheduleClaudeVersionFetch = () => {
      claudeVersionTimer = window.setTimeout(fetchClaudeVersion, 1500);
    };

    const emptyCleanupPromise = invoke<number>("cleanup_empty_sessions")
      .then((count) => {
        if (count > 0) log(`Startup empty session cleanup removed ${count} empty sessions.`);
      })
      .catch((error) => log(`Startup empty session cleanup failed: ${error}`));

    const cleanupSettings = readSessionCleanupSettings();
    const staleCleanupPromise = cleanupSettings.enabled
      ? invoke<number>("cleanup_stale_sessions", { days: cleanupSettings.days })
          .then((count) => {
            log(`Startup session cleanup moved ${count} stale sessions to trash.`);
          })
          .catch((error) => {
            log(`Startup session cleanup failed: ${error}`);
          })
      : Promise.resolve();

    log("App mounted. Fetching sessions from SQLite database...");
    Promise.all([emptyCleanupPromise, staleCleanupPromise])
      .then(() => invoke<Session[]>("get_sessions"))
      .then((data) => {
        if (cancelled) return;
        log(`Successfully fetched ${data ? data.length : 0} sessions from database.`);
        setSessions(data || []);
        if (data && data.length > 0) {
          const lastActiveId = localStorage.getItem("kkcoder_last_active_session_id");
          const lastOpenTabsStr = localStorage.getItem("kkcoder_last_open_tab_ids");
          let lastOpenTabs: string[] = [];
          try {
            if (lastOpenTabsStr) lastOpenTabs = JSON.parse(lastOpenTabsStr);
          } catch {
            // ignore
          }

          const validActiveId = data.some((session) => session.id === lastActiveId)
            ? lastActiveId
            : data[0].id;
          const validOpenTabs = lastOpenTabs.filter((tabId) =>
            data.some((session) => session.id === tabId),
          );

          if (validOpenTabs.length > 0) {
            log(`Found ${validOpenTabs.length} sessions from last time. Setting restore states...`);
            setPendingRestoreIds(validOpenTabs);
            if (validActiveId) {
              setPendingActiveId(validActiveId);
            }
            setShowRestoreToast(true);
          }
        }
        setIsInitLoaded(true);
        scheduleClaudeVersionFetch();
        scheduleDeferredDiagnostics();

        if (localStorage.getItem("kkcoder_setting_auto_rename_startup") === "true") {
          startupRenameTimer = window.setTimeout(() => {
            triggerAutoRenameRef.current("Startup");
          }, 3000);
        }
      })
      .catch((error) => {
        if (cancelled) return;
        log(`Failed to fetch sessions from SQLite: ${error}`);
        console.error("加载 SQLite 本地会话数据失败", error);
        setIsInitLoaded(true);
        scheduleClaudeVersionFetch();
        scheduleDeferredDiagnostics();
      });

    return () => {
      cancelled = true;
      if (claudeVersionTimer !== null) window.clearTimeout(claudeVersionTimer);
      if (diagnosticsTimer !== null) window.clearTimeout(diagnosticsTimer);
      if (startupRenameTimer !== null) window.clearTimeout(startupRenameTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only bootstrap
  }, []);

  // Register remote spawn listener once; read latest sessions via ref.
  useEffect(() => {
    let disposed = false;
    let unlistenFn: (() => void) | null = null;

    import("@tauri-apps/api/event").then(({ listen }) => {
      if (disposed) return;
      return listen("remote-spawn-request", async (event: { payload: Record<string, unknown> }) => {
        const payload = event.payload;
        const sessionId = String(payload.session_id ?? "");
        const directory = String(payload.directory ?? "");
        const agentType = String(payload.agent_type ?? "claude") as AgentType;
        const agentSessionId = String(payload.agent_session_id ?? "");
        const isReopen = Boolean(payload.is_reopen);
        log(
          `[RemoteSpawn] Received spawn request: session=${sessionId}, dir=${directory}, agent=${agentType}, reopen=${isReopen}, agent_session_id=${agentSessionId}`,
        );

        try {
          const existing = sessionsRef.current.find((session) => session.id === sessionId);
          const hasAgentSessionId = agentSessionId.length > 0;
          const finalAgentSessionId = hasAgentSessionId ? agentSessionId : generateUUID();

          if (existing) {
            if (!existing.agentSessionId && hasAgentSessionId) {
              await invoke("add_session", {
                session: { ...existing, agentSessionId: finalAgentSessionId },
              });
              setSessions((previous) =>
                previous.map((session) =>
                  session.id === sessionId
                    ? { ...session, agentSessionId: finalAgentSessionId }
                    : session,
                ),
              );
            }

            try {
              await invoke("spawn_terminal", {
                sessionId,
                directory,
                agentType: agentType || "claude",
                agentSessionId: finalAgentSessionId,
                isReopen: hasAgentSessionId && (isReopen ?? true),
              });
            } catch (spawnError) {
              const errorText = String(spawnError);
              if (errorText.includes("already in use") || errorText.includes("already active")) {
                log(`[RemoteSpawn] Session ${sessionId} already running, activating tab.`);
              } else {
                throw spawnError;
              }
            }
          } else {
            const folderName = directory.split(/[/\\]/).pop() || directory;
            const newSession: Session = {
              id: sessionId,
              name: "新对话",
              path: directory,
              project: folderName,
              type: agentType || "claude",
              agentSessionId: finalAgentSessionId,
              favorite: 0,
            };
            await invoke("add_session", { session: newSession });
            setSessions((previous) => [...previous, newSession]);

            await invoke("spawn_terminal", {
              sessionId,
              directory,
              agentType: agentType || "claude",
              agentSessionId: finalAgentSessionId,
              isReopen: false,
            });
          }

          setOpenTabIds((previous) =>
            previous.includes(sessionId) ? previous : [...previous, sessionId],
          );
          setActiveSessionId(sessionId);
          log(`[RemoteSpawn] Successfully spawned session ${sessionId}`);

          invoke<Session[]>("get_sessions")
            .then((updated) => {
              if (updated) setSessions(updated);
            })
            .catch(() => {});
        } catch (error) {
          log(`[RemoteSpawn] Failed to spawn session ${sessionId}: ${error}`);
        }
      });
    }).then((unlisten) => {
      if (!unlisten) return;
      if (disposed) {
        unlisten();
        return;
      }
      unlistenFn = unlisten;
    });

    return () => {
      disposed = true;
      if (unlistenFn) unlistenFn();
    };
  }, [setActiveSessionId, setOpenTabIds]);

  const handleCreateSession = useCallback(
    async (sessionName: string, projectPath: string, projectName: string) => {
      log(
        `handleCreateSession triggered: name=${sessionName}, path=${projectPath}, project=${projectName}, agent=${selectedAgent}`,
      );

      const newId = `session-${Date.now().toString()}`;
      // Codex 无法在启动前预生成 session id，留空，首句对话后从 ~/.codex/sessions 捕获
      const agentSessionId = selectedAgent === "codex" ? "" : generateUUID();
      log(`Generated new session UUIDs: id=${newId}, agentSessionId=${agentSessionId || "(pending codex capture)"}`);

      const newSession: Session = {
        id: newId,
        name: sessionName,
        project: projectName,
        path: projectPath,
        type: selectedAgent,
        agentSessionId,
        favorite: 0,
      };

      log(`Invoking add_session to SQLite...`);
      invoke("add_session", { session: newSession })
        .then(() => {
          log(`Successfully added session ${newId} to SQLite. Updating React states...`);
          setSessions((previous) => {
            log(`Adding ${newId} to sessions list (previous size: ${previous.length})`);
            return [...previous, newSession];
          });
          setNewSessionIds((previous) => {
            log(`Adding ${newId} to newSessionIds (previous size: ${previous.length})`);
            return [...previous, newId];
          });
          setOpenTabIds((previous) => {
            log(`Adding ${newId} to openTabIds (previous size: ${previous.length})`);
            return [...previous, newId];
          });
          log(`Setting activeSessionId to ${newId}`);
          setActiveSessionId(newId);
          log(`handleCreateSession state updates finished.`);
        })
        .catch((error) => {
          log(`Failed to save session ${newId} to SQLite: ${error}`);
          notifyError(`保存会话失败：${formatFeedbackError(error)}`);
        });
    },
    [selectedAgent, setActiveSessionId, setNewSessionIds, setOpenTabIds],
  );

  const handleCreateSessionDirectly = useCallback(
    (projectPath: string) => {
      const cleanPath = projectPath.replace(/[\\/]+$/, "");
      const parts = cleanPath.split(/[\\/]/);
      const projectName = parts[parts.length - 1] || "新项目";
      log(`handleCreateSessionDirectly triggered: path=${cleanPath}, project=${projectName}`);
      handleCreateSession("新会话", cleanPath, projectName);
    },
    [handleCreateSession],
  );

  const handleCreateTempSession = useCallback(() => {
    const tempNumbers = sessions
      .filter((session) => session.isTemp)
      .map((session) => {
        const match = session.name.match(/临时终端(\d+)/);
        return match ? parseInt(match[1], 10) : 0;
      });
    const nextNumber = tempNumbers.length > 0 ? Math.max(...tempNumbers) + 1 : 1;
    const sessionName = `临时终端${nextNumber}`;
    const newId = `temp-session-${Date.now().toString()}`;
    const agentSessionId = selectedAgent === "codex" ? "" : generateUUID();

    const newSession: Session = {
      id: newId,
      name: sessionName,
      project: "无痕临时项目",
      path: "D:\\CODE",
      type: selectedAgent,
      agentSessionId,
      favorite: 0,
      isTemp: true,
    };

    setSessions((previous) => [...previous, newSession]);
    setNewSessionIds((previous) => [...previous, newId]);
    setOpenTabIds((previous) => [...previous, newId]);
    setActiveSessionId(newId);
  }, [selectedAgent, sessions, setActiveSessionId, setNewSessionIds, setOpenTabIds]);

  const handleDeleteSession = useCallback(
    async (event: MouseEvent | null, sessionId: string) => {
      if (event) event.stopPropagation();
      try {
        invoke("close_terminal", { sessionId }).catch(() => {});
        await invoke("delete_session", { id: sessionId });
        setSessions((previous) =>
          previous.map((session) =>
            session.id === sessionId
              ? { ...session, deleted: 1, deletedAt: new Date().toISOString() }
              : session,
          ),
        );
        setOpenTabIds((previous) => previous.filter((tabId) => tabId !== sessionId));
        clearQueueForSessionRef.current(sessionId);
        if (activeSessionIdRef.current === sessionId) {
          const remaining = openTabIdsRef.current.filter((tabId) => tabId !== sessionId);
          setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1] : "");
        }
      } catch (error) {
        notifyError(`删除会话失败：${formatFeedbackError(error)}`);
      }
    },
    [activeSessionIdRef, clearQueueForSessionRef, openTabIdsRef, setActiveSessionId, setOpenTabIds],
  );

  const handleRestoreSession = useCallback(async (sessionId: string) => {
    try {
      await invoke("restore_session", { id: sessionId });
      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId ? { ...session, deleted: 0, deletedAt: undefined } : session,
        ),
      );
    } catch (error) {
      notifyError(`恢复会话失败：${formatFeedbackError(error)}`);
    }
  }, []);

  const handlePermanentlyDeleteSession = useCallback(
    async (sessionId: string) => {
      try {
        await invoke("delete_session_permanently", { id: sessionId });
        setSessions((previous) => previous.filter((session) => session.id !== sessionId));
        clearQueueForSessionRef.current(sessionId);
        localStorage.removeItem(`kkcoder_session_has_dialogue_${sessionId}`);
      } catch (error) {
        notifyError(`彻底删除失败：${formatFeedbackError(error)}`);
      }
    },
    [clearQueueForSessionRef],
  );

  const handleEmptyTrash = useCallback(async () => {
    try {
      sessions.forEach((session) => {
        if (session.deleted === 1) {
          localStorage.removeItem(`kkcoder_session_has_dialogue_${session.id}`);
        }
      });
      await invoke("empty_trash");
      setSessions((previous) => previous.filter((session) => session.deleted !== 1));
    } catch (error) {
      notifyError(`清空回收站失败：${formatFeedbackError(error)}`);
    }
  }, [sessions]);

  const handleDeleteSessionsBatch = useCallback(
    async (sessionIds: string[]) => {
      log(`handleDeleteSessionsBatch triggered: ids=[${sessionIds.join(", ")}]`);
      try {
        await Promise.all(sessionIds.map((sessionId) => invoke("delete_session", { id: sessionId })));
        sessionIds.forEach((sessionId) =>
          localStorage.removeItem(`kkcoder_session_has_dialogue_${sessionId}`),
        );
        setSessions((previous) => previous.filter((session) => !sessionIds.includes(session.id)));
        setOpenTabIds((previous) => previous.filter((tabId) => !sessionIds.includes(tabId)));
        sessionIds.forEach((sessionId) => clearQueueForSessionRef.current(sessionId));
        if (sessionIds.includes(activeSessionIdRef.current)) {
          const remaining = openTabIdsRef.current.filter((tabId) => !sessionIds.includes(tabId));
          setActiveSessionId(remaining.length > 0 ? remaining[remaining.length - 1] : "");
        }
        log(`Successfully batch deleted ${sessionIds.length} sessions.`);
      } catch (error) {
        log(`Failed to batch delete sessions: ${error}`);
        notifyError(`批量删除失败：${formatFeedbackError(error)}`);
      }
    },
    [activeSessionIdRef, clearQueueForSessionRef, openTabIdsRef, setActiveSessionId, setOpenTabIds],
  );

  const handleRenameSession = useCallback(async (sessionId: string, newName: string) => {
    log(`handleRenameSession triggered: id=${sessionId}, newName=${newName}`);
    try {
      await invoke("rename_session", { id: sessionId, newName });
      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId ? { ...session, name: newName } : session,
        ),
      );
      log(`Successfully renamed session ${sessionId} to ${newName}`);
    } catch (error) {
      log(`Failed to rename session ${sessionId}: ${error}`);
      notifyError(`重命名失败：${formatFeedbackError(error)}`);
    }
  }, []);

  const handleToggleFavorite = useCallback(async (sessionId: string, isFavorite: boolean) => {
    const favoriteValue = isFavorite ? 1 : 0;
    log(`handleToggleFavorite triggered: id=${sessionId}, favorite=${favoriteValue}`);
    try {
      await invoke("toggle_favorite", { id: sessionId, favorite: favoriteValue });
      setSessions((previous) =>
        previous.map((session) =>
          session.id === sessionId ? { ...session, favorite: favoriteValue } : session,
        ),
      );
      log(`Successfully toggled favorite for session ${sessionId} to ${favoriteValue}`);
    } catch (error) {
      log(`Failed to toggle favorite for session ${sessionId}: ${error}`);
      notifyError(`收藏操作失败：${formatFeedbackError(error)}`);
    }
  }, []);

  const handleCaptureSessionId = useCallback(
    async (sessionId: string, agentSessionId: string) => {
      const trimmedId = agentSessionId.trim();
      if (!trimmedId) return;
      log(
        `handleCaptureSessionId triggered: sessionId=${sessionId}, agentSessionId=${trimmedId}`,
      );
      try {
        let updatedSession: Session | null = null;
        setSessions((previous) => {
          const session = previous.find((item) => item.id === sessionId);
          if (!session) return previous;
          if (session.agentSessionId === trimmedId) return previous;
          updatedSession = { ...session, agentSessionId: trimmedId };
          return previous.map((item) => (item.id === sessionId ? updatedSession! : item));
        });
        if (updatedSession) {
          await invoke("add_session", { session: updatedSession });
          log(
            `Successfully captured and updated agent session ID in database for ${sessionId} to ${trimmedId}`,
          );
        }
      } catch (error) {
        log(`Failed to update captured session ID in database: ${error}`);
      }
    },
    [],
  );

  const reloadSessions = useCallback(() => {
    invoke<Session[]>("get_sessions")
      .then((data) => {
        if (data) setSessions(data);
      })
      .catch(() => {});
  }, []);

  return {
    sessions,
    setSessions,
    handleCreateSession,
    handleCreateSessionDirectly,
    handleCreateTempSession,
    handleDeleteSession,
    handleRestoreSession,
    handlePermanentlyDeleteSession,
    handleEmptyTrash,
    handleDeleteSessionsBatch,
    handleRenameSession,
    handleToggleFavorite,
    handleCaptureSessionId,
    reloadSessions,
  };
}
