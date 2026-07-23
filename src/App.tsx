import { useState, useEffect, useRef, useCallback, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sidebar,
  type Session,
  TerminalTab,
  CompatibilityTerminalTab,
  NewSessionModal,
  SettingsModal,
  MdEditorModal,
  FileEditorModal,
  ProjectTree,
  TitleBar,
  FilePreviewPanel,
  FilePreviewContextMenu,
  SessionTabBar,
  TabContextMenu,
  SessionRestorePrompt,
  CloseConfirmModal,
} from "./components";
import {
  updateSessionLastUserMessageAt,
  shouldResumeSession,
  CLAUDE_TERMINAL_MODE_KEY,
  resolveClaudeTerminalMode,
  shouldUseNativeTerminal,
  type ClaudeTerminalMode,
  resolveTerminalWriteCommand,
  getSessionQueue,
  log,
  getFolderName,
  ENABLED_AGENTS_CHANGE_EVENT,
  isAgentEnabled,
  loadEnabledAgents,
  type AgentType,
  type EnabledAgents,
} from "./utils";
import {
  usePanelResize,
  useTheme,
  useShortcuts,
  useAutoRename,
  useSessionQueueEngine,
  useWindowChrome,
  useTabFlipAnimation,
  useFilePreview,
  useSessions,
  useSessionTabs,
  useUnreadCompletions,
} from "./hooks";
import "./App.css";

const CLAUDE_VERSION_CACHE_KEY = "kkcoder_cached_claude_version";

function App() {
  const {
    appWindow,
    showCloseConfirmModal,
    setShowCloseConfirmModal,
    rememberCloseChoice,
    setRememberCloseChoice,
    handleMinimize,
    handleMaximize,
    handleClose,
    handleTitlebarMouseDown,
  } = useWindowChrome();

  const handleLaunchCcswitch = () => {
    const path = localStorage.getItem("kkcoder_setting_ccswitch_path") || "";
    if (!path.trim()) {
      alert("请先在「设置」->「终端设置」中配置 ccswitch.exe 的路径。");
      return;
    }
    invoke("launch_ccswitch", { path }).catch((err) => {
      alert(`启动 ccswitch.exe 失败:\n${err}`);
    });
  };

  const [selectedAgent, setSelectedAgent] = useState<AgentType>("claude");
  const [enabledAgents, setEnabledAgents] = useState<EnabledAgents>(() => loadEnabledAgents());
  const [showModal, setShowModal] = useState(false);
  const [prefilledProjectPath, setPrefilledProjectPath] = useState<string | undefined>(undefined);
  const [showSettings, setShowSettings] = useState(false);
  const [showMdEditor, setShowMdEditor] = useState(false);
  const [editingFilePath, setEditingFilePath] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isInitLoaded, setIsInitLoaded] = useState(false);
  const [claudeVersion, setClaudeVersion] = useState<string>(() => {
    return localStorage.getItem(CLAUDE_VERSION_CACHE_KEY) || "Claude Code";
  });
  const [claudeTerminalMode, setClaudeTerminalMode] = useState<ClaudeTerminalMode>(() => {
    return resolveClaudeTerminalMode(localStorage.getItem(CLAUDE_TERMINAL_MODE_KEY));
  });
  const [terminalModeBySession, setTerminalModeBySession] = useState<Record<string, ClaudeTerminalMode>>({});
  const [isDragOverWorkspace, setIsDragOverWorkspace] = useState(false);
  const [showProjectTree, setShowProjectTree] = useState<boolean>(() => {
    return localStorage.getItem("kkcoder_show_project_tree") === "true";
  });
  const projectTreeAsideRef = useRef<HTMLElement>(null);

  const {
    currentTheme,
    showThemeDropdown,
    setShowThemeDropdown,
    selectTheme: handleSelectTheme,
  } = useTheme();

  const {
    width: sidebarWidth,
    isResizing,
    startResize,
  } = usePanelResize({
    storageKey: "kkcoder_sidebar_width",
    defaultWidth: 300,
    minWidth: 200,
    maxWidth: 450,
  });

  const {
    width: projectTreeWidth,
    setWidth: setProjectTreeWidth,
    isResizing: isResizingProjectTree,
    startResize: startProjectTreeResize,
  } = usePanelResize({
    storageKey: "kkcoder_project_tree_width",
    defaultWidth: 260,
    minWidth: 200,
    maxWidth: 500,
    fromRightEdge: true,
  });

  const { shortcutsEnabled, shortcutsList } = useShortcuts();

  const openTabIdsRef = useRef<string[]>([]);
  const activeSessionIdRefForSessions = useRef("");
  const clearQueueForSessionRef = useRef<(sessionId: string) => void>(() => {});
  const sessionsRef = useRef<Session[]>([]);
  const setSessionsRef = useRef<Dispatch<SetStateAction<Session[]>>>(() => {});
  const setSessionBusyRef = useRef<Dispatch<SetStateAction<Record<string, boolean>>>>(() => {});
  const handleRenameSessionRef = useRef<(sessionId: string, newName: string) => Promise<void> | void>(() => {});
  const setGlowingSessionIdsRef = useRef<Dispatch<SetStateAction<string[]>>>(() => {});

  const sessionTabs = useSessionTabs({
    sessionsRef,
    setSessionsRef,
    clearQueueForSessionRef,
    setSessionBusyRef,
    setSelectedAgent,
    setGlowingSessionIds: ((value) => setGlowingSessionIdsRef.current(value)) as Dispatch<SetStateAction<string[]>>,
    handleRenameSessionRef,
  });

  const {
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
  } = sessionTabs;

  openTabIdsRef.current = openTabIds;
  activeSessionIdRefForSessions.current = activeSessionId;

  const {
    glowingSessionIds,
    setGlowingSessionIds,
    handleCommandComplete,
  } = useUnreadCompletions(activeSessionId, appWindow);
  setGlowingSessionIdsRef.current = setGlowingSessionIds;

  useEffect(() => {
    const handleEnabledAgentsChange = (event: Event) => {
      const detail = (event as CustomEvent<EnabledAgents>).detail;
      const next = detail ?? loadEnabledAgents();
      setEnabledAgents(next);
    };
    window.addEventListener(ENABLED_AGENTS_CHANGE_EVENT, handleEnabledAgentsChange);
    return () => {
      window.removeEventListener(ENABLED_AGENTS_CHANGE_EVENT, handleEnabledAgentsChange);
    };
  }, []);

  useEffect(() => {
    if (!isAgentEnabled(selectedAgent, enabledAgents)) {
      setSelectedAgent("claude");
    }
  }, [enabledAgents, selectedAgent]);

  useEffect(() => {
    const handleTerminalModeChange = (event: Event) => {
      const mode = resolveClaudeTerminalMode((event as CustomEvent<string>).detail);
      setClaudeTerminalMode(mode);
    };
    window.addEventListener("kkcoder-claude-terminal-mode-change", handleTerminalModeChange);
    return () => {
      window.removeEventListener("kkcoder-claude-terminal-mode-change", handleTerminalModeChange);
    };
  }, []);

  useEffect(() => {
    setTerminalModeBySession((previous) => {
      const next: Record<string, ClaudeTerminalMode> = {};
      for (const sessionId of openTabIds) {
        next[sessionId] = previous[sessionId] ?? claudeTerminalMode;
      }
      return next;
    });
  }, [openTabIds, claudeTerminalMode]);

  const triggerAutoRenameRef = useRef<(source: string) => void>(() => {});

  const {
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
  } = useSessions({
    selectedAgent,
    openTabIdsRef,
    activeSessionIdRef: activeSessionIdRefForSessions,
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
  });

  sessionsRef.current = sessions;
  setSessionsRef.current = setSessions;
  handleRenameSessionRef.current = handleRenameSession;

  const { triggerAutoRename, clearRenameMark } = useAutoRename({ sessions, setSessions });
  triggerAutoRenameRef.current = triggerAutoRename;

  const writeToSessionTerminal = useCallback(async (
    sessionId: string,
    data: string,
    announceCompatibilitySubmission = false,
  ) => {
    const session = sessions.find((item) => item.id === sessionId);
    if (!session) throw new Error(`会话 ${sessionId} 不存在`);
    const mode = terminalModeBySession[sessionId] ?? claudeTerminalMode;
    const command = resolveTerminalWriteCommand(session.type, mode);
    await invoke(command, { sessionId, data });
    if (command === "write_to_compat_terminal" && announceCompatibilitySubmission) {
      window.dispatchEvent(new CustomEvent("kkcoder-compat-terminal-submitted", {
        detail: { sessionId },
      }));
    }
  }, [claudeTerminalMode, sessions, terminalModeBySession]);

  const handleUserSubmittedInput = (sessionId: string, submittedAt: string = new Date().toISOString()) => {
    localStorage.setItem(`kkcoder_session_has_dialogue_${sessionId}`, "true");
    setSessions((prev) => updateSessionLastUserMessageAt(prev, sessionId, submittedAt));
    const targetSession = sessions.find((session) => session.id === sessionId);
    if (!targetSession || targetSession.isTemp) return;
    invoke("touch_session_last_user_message", { id: sessionId }).catch((err) => {
      log(`Failed to persist last user message time for ${sessionId}: ${err}`);
    });
  };

  const handleUserSubmittedInputWithRenameReset = (sessionId: string, submittedAt?: string) => {
    clearRenameMark(sessionId);
    handleUserSubmittedInput(sessionId, submittedAt);
  };

  const {
    queueBySession,
    showQueueModal,
    setShowQueueModal,
    queueInput,
    setQueueInput,
    setQueueTargetSessionId,
    sessionBusy,
    setSessionBusy,
    activeQueue,
    queueModalQueue,
    handleAddToQueue,
    enqueuePrompt,
    clearQueueForSession,
    removeQueuedTask,
  } = useSessionQueueEngine({
    activeSessionId,
    openTabIds,
    writeToSessionTerminal,
    onTaskSubmitted: handleUserSubmittedInputWithRenameReset,
  });

  clearQueueForSessionRef.current = clearQueueForSession;
  setSessionBusyRef.current = setSessionBusy;

  const handleTriggerShortcut = (content: string) => {
    if (!activeSessionId) return;
    const isBusy = sessionBusy[activeSessionId] || false;
    if (isBusy) {
      if (getSessionQueue(queueBySession, activeSessionId).length >= 2) {
        alert("队列已满！目前最多只允许队列中有 2 个排队任务。");
        return;
      }
      enqueuePrompt(activeSessionId, content);
    } else {
      setSessionBusy((prev) => ({ ...prev, [activeSessionId]: true }));
      writeToSessionTerminal(activeSessionId, content + "\r\n", true)
        .then(() => {
          handleUserSubmittedInputWithRenameReset(activeSessionId);
        })
        .catch((err) => {
          log(`Failed to send shortcut phrase: ${err}`);
          setSessionBusy((prev) => ({ ...prev, [activeSessionId]: false }));
        });
    }
  };

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  useEffect(() => {
    const aside = projectTreeAsideRef.current;
    if (!aside || !showProjectTree) return;
    const timer = setTimeout(() => {
      const root = aside.querySelector(".project-tree-root");
      if (!root) return;
      const htmlRoot = root as HTMLElement;
      const originalMinWidth = htmlRoot.style.minWidth;
      htmlRoot.style.minWidth = "0";
      const contentWidth = htmlRoot.scrollWidth;
      htmlRoot.style.minWidth = originalMinWidth;
      const maxW = Math.floor(window.innerWidth * 0.4);
      const idealW = Math.max(200, Math.min(maxW, contentWidth + 24));
      setProjectTreeWidth((prev) => {
        if (idealW > prev) {
          localStorage.setItem("kkcoder_project_tree_width", idealW.toString());
          return idealW;
        }
        return prev;
      });
    }, 150);
    return () => clearTimeout(timer);
  }, [showProjectTree, activeSession?.path, setProjectTreeWidth]);

  const insertConversationTagToActiveTerminal = useCallback((text: string) => {
    if (!activeSessionId || !text) return;
    window.dispatchEvent(new CustomEvent("kkcoder-insert-conversation-tag", {
      detail: { sessionId: activeSessionId, text },
    }));
  }, [activeSessionId]);

  const handleInsertPathToSession = useCallback((sessionId: string, text: string) => {
    if (!sessionId || !text) return;
    window.dispatchEvent(new CustomEvent("kkcoder-insert-conversation-tag", {
      detail: { sessionId, text },
    }));
  }, []);

  const {
    openFile: handleFileClick,
    handlePathRenamed: handlePreviewPathRenamed,
    panelProps: filePreviewPanelProps,
    contextMenuProps: filePreviewContextMenuProps,
  } = useFilePreview({
    projectPath: activeSession?.path,
    activeSessionId,
    onInsertConversationTag: insertConversationTagToActiveTerminal,
  });

  const handleInsertPathToTerminal = useCallback((relativePath: string) => {
    insertConversationTagToActiveTerminal(`"${relativePath}" `);
  }, [insertConversationTagToActiveTerminal]);

  const handleEditFile = useCallback((relativePath: string) => {
    setEditingFilePath(relativePath);
  }, []);

  const handlePathRenamed = useCallback((oldPath: string, newPath: string) => {
    handlePreviewPathRenamed(oldPath, newPath);
    setEditingFilePath((prev) => {
      if (!prev) return prev;
      if (prev === oldPath) return newPath;
      if (prev.startsWith(`${oldPath}/`)) {
        return `${newPath}${prev.slice(oldPath.length)}`;
      }
      return prev;
    });
  }, [handlePreviewPathRenamed]);

  useEffect(() => {
    if (isInitLoaded) {
      localStorage.setItem("kkcoder_last_active_session_id", activeSessionId);
    }
  }, [activeSessionId, isInitLoaded]);

  useEffect(() => {
    if (isInitLoaded) {
      localStorage.setItem("kkcoder_last_open_tab_ids", JSON.stringify(openTabIds));
    }
  }, [openTabIds, isInitLoaded]);

  useTabFlipAnimation(openTabIds);

  const handleOpenFolder = async () => {
    if (!activeSession) return;
    try {
      log(`Opening folder in explorer: ${activeSession.path}`);
      await invoke("open_project_folder", { path: activeSession.path });
    } catch (err) {
      log(`Failed to open folder: ${err}`);
      alert(`无法打开文件夹: ${err}`);
    }
  };

  const handleActivateTab = useCallback((sessionId: string) => {
    setActiveSessionId(sessionId);
    setGlowingSessionIds((prev) => prev.filter((id) => id !== sessionId));
  }, [setActiveSessionId, setGlowingSessionIds]);


  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      <TitleBar
        currentTheme={currentTheme}
        showThemeDropdown={showThemeDropdown}
        setShowThemeDropdown={setShowThemeDropdown}
        onSelectTheme={handleSelectTheme}
        showProjectTree={showProjectTree}
        isTempSession={!!activeSession?.isTemp}
        onToggleProjectTree={() => {
          const newVal = !showProjectTree;
          setShowProjectTree(newVal);
          localStorage.setItem("kkcoder_show_project_tree", String(newVal));
        }}
        onLaunchCcswitch={handleLaunchCcswitch}
        onOpenSettings={() => setShowSettings(true)}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
        onTitlebarMouseDown={handleTitlebarMouseDown}
      />

      {/* 主布局 */}
      <div className="app-container">
        {/* 左边栏 - 专注于会话与项目管理 */}
        <Sidebar
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          enabledAgents={enabledAgents}
          onOpenNewSession={(path) => {
            setPrefilledProjectPath(path);
            setShowModal(true);
          }}
          onCreateSessionDirectly={handleCreateSessionDirectly}
          onOpenTempSession={handleCreateTempSession}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSession}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onDeleteSession={handleDeleteSession}
          openTabIds={openTabIds}
          onRenameSession={handleRenameSession}
          onToggleFavorite={handleToggleFavorite}
          highlightSessionId={highlightSessionId}
          onHighlightEnd={() => setHighlightSessionId(null)}
          onDeleteSessionsBatch={handleDeleteSessionsBatch}
          glowingSessionIds={glowingSessionIds}
          onRestoreSession={handleRestoreSession}
          onPermanentlyDeleteSession={handlePermanentlyDeleteSession}
          onEmptyTrash={handleEmptyTrash}
          width={sidebarWidth}
          sessionBusy={sessionBusy}
        />
        <div className={`sidebar-resizer ${isResizing ? "dragging" : ""}`} onMouseDown={startResize} />

        {/* 右侧主工作区 */}
        <main
          className={`main-workspace ${isDragOverWorkspace ? "drag-over" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!isDragOverWorkspace) setIsDragOverWorkspace(true);
          }}
          onDragLeave={(e) => {
            // 只在真正离开 main 区域时清除（忽略子元素冒泡）
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setIsDragOverWorkspace(false);
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOverWorkspace(false);
            const text = e.dataTransfer.getData("text/plain");
            if (text) {
              handleInsertPathToSession(activeSessionId, text);
            }
          }}
        >
          <SessionTabBar
            openTabIds={openTabIds}
            sessions={sessions}
            activeSessionId={activeSessionId}
            glowingSessionIds={glowingSessionIds}
            sessionBusy={sessionBusy}
            draggingIndex={draggingIndex}
            renamingTabId={renamingTabId}
            renamingTabText={renamingTabText}
            onWheel={handleTabWheel}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTab}
            onOpenContextMenu={(e, sessionId) => {
              e.preventDefault();
              e.stopPropagation();
              setTabContextMenu({ x: e.clientX, y: e.clientY, sessionId });
              window.dispatchEvent(new CustomEvent("close-sidebar-context-menu"));
            }}
            onRenamingTextChange={setRenamingTabText}
            onSaveRename={handleSaveTabRename}
            onCancelRename={() => setRenamingTabId(null)}
          />

          {/* 终端区 / 空白提示状态 (采用 Keep-Alive 常驻 DOM 设计，防止切换 Tab 时重新初始化) */}
          <div style={{ flex: 1, display: "flex", flexDirection: "row", position: "relative", overflow: "hidden" }}>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden", height: "100%" }}>
              {openTabIds.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-state-icon">🖥️</span>
                  <div className="empty-state-title">KKCoder AI 终端管理器</div>
                  <div className="empty-state-desc">
                    当前没有处于活动状态的会话标签。
                    请选择左上角的 Agent 类型并点击“**新建 AI 终端**”按钮来开启一个托管终端。
                  </div>
                </div>
              ) : (
                sessions.map((s) => {
                  const isOpen = openTabIds.includes(s.id);
                  if (!isOpen) return null;
                  const isActive = activeSessionId === s.id;
                  const shouldResume = shouldResumeSession(s.id, newSessionIds);
                  const sessionTerminalMode = terminalModeBySession[s.id] ?? claudeTerminalMode;
                  const useNativeTerminal = shouldUseNativeTerminal(s.type, sessionTerminalMode);
                  return (
                    <div
                      key={s.id}
                      style={{
                        display: isActive ? "flex" : "none",
                        flexDirection: "column",
                        flex: 1,
                        width: "100%",
                        height: "100%",
                        position: "relative",
                      }}
                    >
                      {useNativeTerminal ? (
                        <CompatibilityTerminalTab
                          sessionId={s.id}
                          directory={s.path}
                          agentSessionId={s.agentSessionId}
                          isReopen={shouldResume}
                          isActive={isActive}
                          onSpawned={() => {
                            log(`CompatibilityTerminalTab spawn resolved for session: ${s.id}. Removing from newSessionIds...`);
                            setNewSessionIds((prev) => prev.filter((nid) => nid !== s.id));
                          }}
                          onStateChange={(busy) => {
                            setSessionBusy(prev => ({ ...prev, [s.id]: busy }));
                          }}
                          onCommandComplete={() => handleCommandComplete(s.id)}
                          onUserSubmittedInput={handleUserSubmittedInputWithRenameReset}
                          onRenameSession={handleRenameSession}
                        />
                      ) : (
                        <TerminalTab
                          sessionId={s.id}
                          directory={s.path}
                          agentType={s.type}
                          agentSessionId={s.agentSessionId}
                          isReopen={shouldResume}
                          onSpawned={() => {
                            log(`TerminalTab spawn resolved for session: ${s.id}. Removing from newSessionIds...`);
                            setNewSessionIds((prev) => prev.filter((nid) => nid !== s.id));
                          }}
                          onCaptureSessionId={handleCaptureSessionId}
                          busy={sessionBusy[s.id] || false}
                          onStateChange={(busy) => {
                            setSessionBusy(prev => ({ ...prev, [s.id]: busy }));
                          }}
                          isActive={isActive}
                          onCommandComplete={() => handleCommandComplete(s.id)}
                          onUserSubmittedInput={handleUserSubmittedInputWithRenameReset}
                          onRenameSession={handleRenameSession}
                        />
                      )}
                      {sessionBusy[s.id] && (
                        <div className="terminal-thinking-badge">
                          <span className="thinking-dot-pulse"></span>
                          <span className="thinking-text">AI 正在思考...</span>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <FilePreviewPanel {...filePreviewPanelProps} />
          </div>

          {/* 新增的队列列表面板 */}
          {activeQueue.length > 0 && (
            <div className="queue-list-panel">
              <div className="queue-panel-header">
                <div className="queue-panel-title">
                  <svg className="queue-title-svg-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8, marginRight: "6px" }}>
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                  </svg>
                  <span>任务队列 ({activeQueue.length})</span>
                </div>
                <button 
                  className="queue-clear-btn"
                  onClick={() => clearQueueForSession(activeSessionId)}
                  title="全部清空队列"
                >
                  <svg className="trash-svg-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6"></polyline>
                    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    <line x1="10" y1="11" x2="10" y2="17"></line>
                    <line x1="14" y1="11" x2="14" y2="17"></line>
                  </svg>
                </button>
              </div>
              <div className="queue-panel-body">
                {activeQueue.map((task, index) => (
                  <div key={task.id} className="queue-item">
                    <span className="queue-item-index">{index + 1}</span>
                    <span className="queue-item-text">{task.prompt}</span>
                    <button
                      className="queue-item-delete"
                      onClick={() => removeQueuedTask(activeSessionId, task.id)}
                      title="删除排队任务"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 底部控制状态条 */}
          <div className="bottom-panel">
            {activeSession ? (
              <div className="bottom-panel-left">
                <button
                  className={`folder-button ${activeSession.type === "pi" ? "pi-hover" : ""}`}
                  onClick={handleOpenFolder}
                  title={`项目物理路径: ${activeSession.path}\n点击在 Windows 资源管理器中打开`}
                >
                  <svg className="folder-svg-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="#EAB308" stroke="#EAB308" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.95, marginRight: "4px" }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>{getFolderName(activeSession.path)}</span>
                </button>

                <button
                  className={`md-button ${activeSession.type === "pi" ? "pi-hover" : ""}`}
                  onClick={() => setShowMdEditor(true)}
                  title="编辑项目规则（默认 CLAUDE.md，保存后同步 AGENTS.md）"
                >
                  <svg className="doc-svg-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "2px", opacity: 0.85 }}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                  <span>规则</span>
                </button>
              </div>
            ) : (
              <div className="bottom-panel-left" style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                无活动项目会话
              </div>
            )}

            {/* 中间：快捷短语 + 队列（窄宽时可横向滚动，避免与左右重叠） */}
            {activeSession && (
              <div className="bottom-panel-center">
                <div className="bottom-shortcuts-scroll">
                  {shortcutsEnabled && shortcutsList.filter(sc => sc.title.trim() && sc.content.trim()).map((sc, idx) => (
                    <button
                      key={idx}
                      className="shortcut-status-btn"
                      onClick={() => handleTriggerShortcut(sc.content)}
                      title={`快捷短语: 点击发送 "${sc.content}"`}
                    >
                      <span>{sc.title}</span>
                    </button>
                  ))}
                </div>

                <button
                  className="queue-status-btn"
                  onClick={() => {
                    setQueueInput("");
                    setQueueTargetSessionId(activeSessionId);
                    setShowQueueModal(true);
                  }}
                  title="点击添加任务到队列"
                >
                  <svg className="queue-svg-icon" xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8, marginRight: "4px" }}>
                    <line x1="8" y1="6" x2="21" y2="6"></line>
                    <line x1="8" y1="12" x2="21" y2="12"></line>
                    <line x1="8" y1="18" x2="21" y2="18"></line>
                    <line x1="3" y1="6" x2="3.01" y2="6"></line>
                    <line x1="3" y1="12" x2="3.01" y2="12"></line>
                    <line x1="3" y1="18" x2="3.01" y2="18"></line>
                  </svg>
                  <span>队列</span>
                  {activeQueue.length > 0 && (
                    <span className="queue-badge">{activeQueue.length}</span>
                  )}
                </button>
              </div>
            )}

            <div className="system-meta">
              {activeSession ? (
                <span
                  style={{
                    fontWeight: 600,
                    color: activeSession.type === "claude" ? "var(--color-orange)" : "var(--color-green)",
                  }}
                >
                  {activeSession.type === "claude" ? claudeVersion : "Pi 终端"}
                </span>
              ) : (
                <span>{claudeVersion} 准备就绪</span>
              )}
            </div>
          </div>
        </main>

        {showProjectTree && !activeSession?.isTemp && (
          <>
            <div 
              className={`project-tree-resizer ${isResizingProjectTree ? "dragging" : ""}`} 
              onMouseDown={startProjectTreeResize} 
              data-agent-type={activeSession?.type || "claude"}
            />
            <aside
              ref={projectTreeAsideRef}
              className="project-tree-aside"
              style={{ width: `${projectTreeWidth}px` }}
            >
              <div className="project-tree-aside-header">
                <span className="aside-header-title">项目文件</span>
                {activeSession && activeSession.path && (
                  <span className="aside-header-path" title={activeSession.path}>
                    {activeSession.path.split(/[/\\]/).pop()}
                  </span>
                )}
              </div>
              {activeSession && activeSession.path ? (
                <ProjectTree
                  projectPath={activeSession.path}
                  onFileClick={handleFileClick}
                  onInsertPathToTerminal={handleInsertPathToTerminal}
                  onEditFile={handleEditFile}
                  onPathRenamed={handlePathRenamed}
                />
              ) : (
                <div className="tree-placeholder-container">
                  <div className="tree-placeholder-icon">📂</div>
                  <div className="tree-placeholder-title">未关联项目文件夹</div>
                  <div className="tree-placeholder-desc">
                    请在左侧新建或选择一个关联了本地路径的会话，以在此处浏览项目文件树。
                  </div>
                </div>
              )}
            </aside>
          </>
        )}

        <FilePreviewContextMenu {...filePreviewContextMenuProps} />
      </div>

      {/* 新建会话终端弹窗组件 */}
      <NewSessionModal
        show={showModal}
        onClose={() => setShowModal(false)}
        selectedAgent={selectedAgent}
        onCreate={handleCreateSession}
        initialProjectPath={prefilledProjectPath}
      />

      {/* 设置中心弹窗组件 */}
      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        onSessionsRenamed={reloadSessions}
      />

      {/* 📝 规则编辑器：默认 CLAUDE.md，保存后同步 AGENTS.md */}
      {activeSession && (
        <MdEditorModal
          show={showMdEditor}
          onClose={() => setShowMdEditor(false)}
          projectPath={activeSession.path}
          filename="CLAUDE.md"
        />
      )}

      {/* 文本文件编辑器弹窗 */}
      {activeSession && editingFilePath && (
        <FileEditorModal
          show={!!editingFilePath}
          onClose={() => setEditingFilePath(null)}
          projectPath={activeSession.path}
          relativePath={editingFilePath}
        />
      )}

      {/* 📋 添加到任务队列弹窗 */}
      {showQueueModal && (
        <div className="modal-overlay show" style={{ zIndex: 1150 }}>
          <div className="modal-card queue-input-modal" style={{ width: "480px" }}>
            <div className="modal-header">
              <span className="modal-title" style={{ fontSize: "15px", fontWeight: 700 }}>添加到任务队列</span>
              <button className="modal-close" onClick={() => setShowQueueModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "12px", padding: "10px 0" }}>
              <div className="form-item" style={{ margin: 0 }}>
                <textarea
                  className="modal-input queue-textarea"
                  placeholder="输入要排队执行的任务提示词..."
                  value={queueInput}
                  onChange={(e) => setQueueInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      handleAddToQueue();
                    } else if (e.key === "Escape") {
                      setShowQueueModal(false);
                    }
                  }}
                  autoFocus
                  style={{
                    width: "100%",
                    height: "100px",
                    resize: "none",
                    borderRadius: "6px",
                    padding: "10px",
                    fontFamily: "inherit",
                    fontSize: "13px",
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-main)",
                    color: "var(--text-primary)"
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", color: "var(--text-secondary)", fontSize: "11.5px" }}>
                <span>Enter 添加到队列 · Shift+Enter 换行 · Esc 取消</span>
                <span>当前队列: {queueModalQueue.length}/2</span>
              </div>
            </div>
            <div className="modal-footer" style={{ marginTop: "10px" }}>
              <button
                className="modal-btn modal-btn-cancel"
                onClick={() => setShowQueueModal(false)}
              >
                取消
              </button>
              <button
                className="modal-btn"
                style={{ backgroundColor: "var(--color-primary)", color: "#ffffff" }}
                onClick={handleAddToQueue}
              >
                加入队列
              </button>
            </div>
          </div>
        </div>
      )}

      <TabContextMenu
        menu={tabContextMenu}
        sessions={sessions}
        onCloseTab={handleCloseTab}
        onCloseOtherTabs={(sessionId) => {
          setOpenTabIds([sessionId]);
          setActiveSessionId(sessionId);
        }}
        onStartRename={(sessionId, currentName) => {
          setRenamingTabId(sessionId);
          setRenamingTabText(currentName);
        }}
        onLocateSession={handleLocateSession}
        onClose={() => setTabContextMenu(null)}
      />

      <CloseConfirmModal
        show={showCloseConfirmModal}
        rememberChoice={rememberCloseChoice}
        appWindow={appWindow}
        onRememberChange={setRememberCloseChoice}
        onCancel={() => setShowCloseConfirmModal(false)}
      />

      <SessionRestorePrompt
        showToast={showRestoreToast}
        showModal={showRestoreModal}
        pendingRestoreIds={pendingRestoreIds}
        sessions={sessions}
        onOpenModal={() => {
          setShowRestoreToast(false);
          setShowRestoreModal(true);
        }}
        onCloseModal={() => setShowRestoreModal(false)}
        onRestoreSingle={handleRestoreSingle}
        onRestoreAll={handleRestoreAll}
        onIgnore={handleRestoreIgnore}
      />
    </div>
  );
}


export default App;
