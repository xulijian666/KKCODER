import { useState, useEffect, useMemo, useRef, useCallback, type Dispatch, type MouseEvent, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Sidebar,
  type Session,
  TerminalTab,
  CompatibilityTerminalTab,
  ChatTab,
  NewSessionModal,
  SettingsModal,
  MdEditorModal,
  FileEditorModal,
  ProjectTree,
  ProjectTreeBindingBar,
  TitleBar,
  FilePreviewPanel,
  FilePreviewContextMenu,
  SessionTabBar,
  TabContextMenu,
  CloseConfirmModal,
  AppToastHost,
  ConfirmModal,
} from "./components";
import kkcoderLogo from "./assets/brand/kkcoder-logo.svg";

import {
  updateSessionLastUserMessageAt,
  shouldResumeSession,
  CLAUDE_TERMINAL_MODE_KEY,
  resolveClaudeTerminalMode,
  shouldUseNativeTerminal,
  type ClaudeTerminalMode,
  resolveTerminalWriteCommand,
  CLAUDE_INTERACTION_MODE_KEY,
  CLAUDE_INTERACTION_MODE_CHANGE_EVENT,
  resolveClaudeInteractionMode,
  shouldUseGuiChat,
  type ClaudeInteractionMode,
  getSessionQueue,
  MAX_SESSION_QUEUE_SIZE,
  log,
  getFolderName,
  DEBUG_LOG_KEY,
  notifyError,
  notifyWarning,
  formatFeedbackError,
  requestActiveTerminalFocus,
  isEditableFocusTarget,
  isSessionDragEvent,
  readSessionIdFromDataTransfer,
} from "./utils";
import {
  loadSelectedModel,
  saveSelectedModel,
  loadClaudeModelInfo,
  setClaudeModelBackend,
  setClaudeProviderBackend,
  type ClaudeModelInfo,
} from "./utils/claudeModel";
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
  useTerminalSplit,
  useProjectTreeBinding,
  useUnreadCompletions,
  useAppFeedback,
  useReturnTerminalFocusWhenUnblocked,
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

  const {
    toasts,
    dismissToast,
    activeConfirm,
    resolveConfirm,
  } = useAppFeedback();

  const handleLaunchCcswitch = () => {
    const path = localStorage.getItem("kkcoder_setting_ccswitch_path") || "";
    if (!path.trim()) {
      notifyWarning("请先在「设置 → 终端设置」中配置 ccswitch.exe 路径");
      return;
    }
    invoke("launch_ccswitch", { path }).catch((err) => {
      notifyError(`无法启动 ccswitch：${formatFeedbackError(err)}`);
    });
  };

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
  const [claudeInteractionMode, setClaudeInteractionMode] = useState<ClaudeInteractionMode>(() => {
    return resolveClaudeInteractionMode(localStorage.getItem(CLAUDE_INTERACTION_MODE_KEY));
  });
  const [interactionModeBySession, setInteractionModeBySession] = useState<Record<string, ClaudeInteractionMode>>({});
  const [isDragOverWorkspace, setIsDragOverWorkspace] = useState(false);
  const [showProjectTree, setShowProjectTree] = useState<boolean>(() => {
    return localStorage.getItem("kkcoder_show_project_tree") === "true";
  });
  const projectTreeAsideRef = useRef<HTMLElement>(null);

  // 启动时同步调试日志开关到后端（设置中心「调试」页可切换）
  useEffect(() => {
    const enabled = localStorage.getItem(DEBUG_LOG_KEY) !== "false";
    invoke("set_debug_log_enabled", { enabled }).catch(() => {});
  }, []);

  // 代码块右上角「复制」按钮：全局事件委托（普通代码块 + HTML 预览块）
  useEffect(() => {
    const handleCodeCopy = (event: globalThis.MouseEvent) => {
      const btn = (event.target as HTMLElement | null)?.closest<HTMLElement>(".md-code-copy");
      if (!btn) return;
      const block = btn.closest<HTMLElement>(".md-code-block, .md-html-preview");
      if (!block) return;
      const codeEl = block.querySelector<HTMLElement>(".md-code");
      const text = codeEl?.textContent ?? "";
      if (!text.trim()) return;
      navigator.clipboard
        .writeText(text)
        .then(() => {
          log(`[copy] code copied (${text.length} chars)`);
          const original = btn.textContent;
          btn.classList.add("is-copied");
          btn.textContent = "已复制";
          window.setTimeout(() => {
            btn.textContent = original;
            btn.classList.remove("is-copied");
          }, 1200);
        })
        .catch((err) => log(`[copy] failed: ${err}`));
    };
    document.addEventListener("click", handleCodeCopy);
    return () => document.removeEventListener("click", handleCodeCopy);
  }, []);

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

  // 左侧栏显示模式：fixed = 固定分栏（当前默认）；hover = 悬停边缘浮出（覆盖层，不挤占终端）
  const [sidebarMode, setSidebarMode] = useState<"fixed" | "hover">(() =>
    localStorage.getItem("kkcoder_sidebar_mode") === "hover" ? "hover" : "fixed",
  );
  const [sidebarRevealed, setSidebarRevealed] = useState(false);
  const sidebarHideTimerRef = useRef<number | null>(null);
  const cancelSidebarHide = useCallback(() => {
    if (sidebarHideTimerRef.current !== null) {
      window.clearTimeout(sidebarHideTimerRef.current);
      sidebarHideTimerRef.current = null;
    }
  }, []);
  const scheduleSidebarHide = useCallback(() => {
    cancelSidebarHide();
    // 略留延迟，避免鼠标划过面板边缘时误收起
    sidebarHideTimerRef.current = window.setTimeout(() => setSidebarRevealed(false), 150);
  }, [cancelSidebarHide]);
  const revealSidebar = useCallback(() => {
    cancelSidebarHide();
    setSidebarRevealed(true);
  }, [cancelSidebarHide]);
  const handleToggleSidebarMode = useCallback(() => {
    const next = sidebarMode === "fixed" ? "hover" : "fixed";
    log(`[app] toggle sidebar mode -> ${next}`);
    setSidebarMode(next);
    localStorage.setItem("kkcoder_sidebar_mode", next);
    if (next === "hover") setSidebarRevealed(false); // 切到悬停即收起为边缘条
  }, [sidebarMode]);

  // 模型选择：读取 CC Switch 维护的 ~/.claude/settings.json 清单，
  // 选中即写入 localStorage 并同步后端全局状态（两处 claude 启动都从后端读）
  const [selectedModel, setSelectedModel] = useState<string | null>(() => loadSelectedModel());
  const [modelInfo, setModelInfo] = useState<ClaudeModelInfo | null>(null);
  // 变更检测用的上一次信息 + 失效提示去重标记
  const modelInfoRef = useRef<ClaudeModelInfo | null>(null);
  const notifiedRemovedModelRef = useRef<string | null>(null);
  const notifiedProviderRemovedRef = useRef(false);

  // 刷新模型信息：拉取后做变更检测，关键字段没变就不更新（避免每 10s 轮询触发全量重渲染）
  const refreshModelInfo = useCallback(() => {
    loadClaudeModelInfo()
      .then((info) => {
        const prev = modelInfoRef.current;
        const unchanged =
          !!prev &&
          prev.providerName === info.providerName &&
          prev.routeMode === info.routeMode &&
          prev.providerRemoved === info.providerRemoved &&
          prev.defaultModel === info.defaultModel &&
          prev.models.join("|") === info.models.join("|") &&
          prev.providers.map((p) => p.id).join("|") ===
            info.providers.map((p) => p.id).join("|");
        if (unchanged) return;
        modelInfoRef.current = info;
        setModelInfo(info);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    refreshModelInfo();
    // 启动时把持久化的选择同步给后端（后端重启后需要重建）
    setClaudeModelBackend(loadSelectedModel());
    // 窗口重新获得焦点时刷新 + 每 10s 轻量轮询：
    // CC Switch 增删供应商/模型、改旋钮 → 最多 10s 内自动同步，无需手动操作
    const onFocus = () => refreshModelInfo();
    window.addEventListener("focus", onFocus);
    const timer = window.setInterval(refreshModelInfo, 10_000);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.clearInterval(timer);
    };
  }, [refreshModelInfo]);

  // 已选模型失效：被删除/改名 → 自动清空回默认 + 提示（每个失效模型只提示一次）
  useEffect(() => {
    if (!modelInfo) return;
    const selected = selectedModel;
    if (selected && modelInfo.models.length > 0 && !modelInfo.models.includes(selected)) {
      if (notifiedRemovedModelRef.current !== selected) {
        notifiedRemovedModelRef.current = selected;
        notifyWarning(`已选模型 ${selected} 已不在 CC Switch 配置中，已恢复为该供应商默认`);
      }
      setSelectedModel(null);
      setClaudeModelBackend(null);
      saveSelectedModel(null);
    } else {
      notifiedRemovedModelRef.current = null;
    }
  }, [modelInfo, selectedModel]);

  // 当前直连的供应商被删除/改名：提示一次（路由模式下由代理接管，不提示）
  useEffect(() => {
    if (!modelInfo) return;
    if (modelInfo.providerRemoved && !notifiedProviderRemovedRef.current) {
      notifiedProviderRemovedRef.current = true;
      notifyWarning("当前直连的供应商已不在 CC Switch 列表中（可能被删除或改名）");
    }
    if (!modelInfo.providerRemoved) notifiedProviderRemovedRef.current = false;
  }, [modelInfo]);

  const handleSelectModel = useCallback((model: string | null) => {
    setSelectedModel(model);
    setClaudeModelBackend(model);
    saveSelectedModel(model);
  }, []);

  // 选择供应商：只记录到 KKCODER 自己（内存 + localStorage），不写任何外部配置。
  // 启动 claude 时用所选供应商 env 生成临时 settings 文件（--settings 直连），
  // ~/.claude/settings.json 与 cc-switch.db 保持原样（避免 CC Switch 回写污染）。
  // 仅路由供应商（routeOnly）claude 无法直连，提示改用 CC Switch。
  const handleSelectProvider = useCallback((providerId: string) => {
    const routeOnly = modelInfo?.providers.find((p) => p.id === providerId)?.routeOnly;
    if (routeOnly) {
      notifyWarning("该供应商需要 CC Switch 路由代理才能使用，选择后仍由 CC Switch 当前配置转发；请在 CC Switch 中切换该供应商");
    }
    setSelectedModel(null);
    setClaudeModelBackend(null);
    saveSelectedModel(null);
    setClaudeProviderBackend(providerId)
      .then((info) => {
        modelInfoRef.current = info;
        setModelInfo(info);
      })
      .catch((err) => {
        refreshModelInfo();
        notifyWarning(formatFeedbackError(err, "选择供应商失败"));
      });
  }, [refreshModelInfo, modelInfo?.providers]);

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
    clearDragging,
    highlightSessionId,
    setHighlightSessionId,
    tabContextMenu,
    setTabContextMenu,
    renamingTabId,
    setRenamingTabId,
    renamingTabText,
    setRenamingTabText,
    handleCloseTab,
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

  const ensureTabOpen = useCallback(
    (sessionId: string) => {
      if (!sessionId) return;
      setOpenTabIds((previous) =>
        previous.includes(sessionId) ? previous : [...previous, sessionId],
      );
    },
    [setOpenTabIds],
  );

  const ensureTabsOpen = useCallback(
    (sessionIds: string[]) => {
      const uniqueIds = [...new Set(sessionIds.filter(Boolean))];
      if (uniqueIds.length === 0) return;
      setOpenTabIds((previous) => {
        let changed = false;
        const next = [...previous];
        for (const sessionId of uniqueIds) {
          if (!next.includes(sessionId)) {
            next.push(sessionId);
            changed = true;
          }
        }
        return changed ? next : previous;
      });
    },
    [setOpenTabIds],
  );

  const terminalSplit = useTerminalSplit({
    openTabIds,
    activeSessionId,
    setActiveSessionId,
    restoreEnabled: isInitLoaded,
    ensureTabOpen,
    ensureTabsOpen,
  });

  const {
    isDual: isDualSplit,
    pair: splitPair,
    orientation: splitOrientation,
    ratio: splitRatio,
    isResizing: isResizingSplit,
    enterSplitWithSession,
    enterSplitByDropAsSecondary,
    exitSplit,
    toggleSplit,
    focusPane,
    activateSession: activateSplitSession,
    notifySessionClosed,
    collapseToSingle,
    startResize: startSplitResize,
    resetRatio: resetSplitRatio,
    hostStyleFor,
    resizerStyle,
    paneSlotFor,
    handleSessionDropOnPane,
    handleSessionDragOverPane,
    handleSessionDragOverRoot,
    handleSessionDropOnRoot,
    dropHighlightSlot,
    setDropHighlightSlot,
  } = terminalSplit;

  const {
    bindingMode: projectTreeBindingMode,
    setBindingMode: setProjectTreeBindingMode,
    treeBoundSessionId,
    otherSplitSessionId,
  } = useProjectTreeBinding({
    isDualSplit,
    activeSessionId,
    splitPair,
  });

  const handleHighlightEnd = useCallback(() => {
    setHighlightSessionId(null);
  }, []);

  const handleOpenNewSession = useCallback((path?: string) => {
    log(`[app] open new session modal${path ? ` (prefilled=${path})` : ""}`);
    setPrefilledProjectPath(path);
    setShowModal(true);
  }, []);

  const handleCloseTabWithSplit = useCallback(
    (event: MouseEvent, sessionId: string) => {
      const nextActiveFromSplit = notifySessionClosed(sessionId);
      handleCloseTab(event, sessionId);
      if (nextActiveFromSplit) {
        setActiveSessionId(nextActiveFromSplit);
        requestActiveTerminalFocus({ delayMs: 56, sessionId: nextActiveFromSplit });
      }
    },
    [handleCloseTab, notifySessionClosed, setActiveSessionId],
  );

  const {
    glowingSessionIds,
    setGlowingSessionIds,
    handleCommandComplete,
  } = useUnreadCompletions(activeSessionId, appWindow);
  setGlowingSessionIdsRef.current = setGlowingSessionIds;

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
    const handleInteractionModeChange = (event: Event) => {
      const mode = resolveClaudeInteractionMode((event as CustomEvent<string>).detail);
      setClaudeInteractionMode(mode);
    };
    window.addEventListener(CLAUDE_INTERACTION_MODE_CHANGE_EVENT, handleInteractionModeChange);
    return () => {
      window.removeEventListener(CLAUDE_INTERACTION_MODE_CHANGE_EVENT, handleInteractionModeChange);
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

  useEffect(() => {
    setInteractionModeBySession((previous) => {
      const next: Record<string, ClaudeInteractionMode> = {};
      for (const sessionId of openTabIds) {
        next[sessionId] = previous[sessionId] ?? claudeInteractionMode;
      }
      return next;
    });
  }, [openTabIds, claudeInteractionMode]);

  const triggerAutoRenameRef = useRef<(source: string) => void>(() => {});

  const {
    sessions,
    setSessions,
    handleCreateSession,
    handleCreateSessionDirectly,
    handleCreateTempSession,
    handleDeleteSession,
    handleDeleteSessionsBatch,
    handleRenameSession,
    handleToggleFavorite,
    handleCaptureSessionId,
    reloadSessions,
  } = useSessions({
    openTabIdsRef,
    activeSessionIdRef: activeSessionIdRefForSessions,
    setOpenTabIds,
    setActiveSessionId,
    setNewSessionIds,
    clearQueueForSessionRef,
    triggerAutoRenameRef,
    setClaudeVersion,
    setIsInitLoaded,
  });

  sessionsRef.current = sessions;
  setSessionsRef.current = setSessions;
  handleRenameSessionRef.current = handleRenameSession;

  // 依赖 useSessions 的稳定回调（供 Sidebar memo 使用）
  const handleOpenTempSession = useCallback(() => {
    handleCreateTempSession();
  }, [handleCreateTempSession]);

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

  const handleUserSubmittedInput = useCallback((sessionId: string, submittedAt: string = new Date().toISOString()) => {
    localStorage.setItem(`kkcoder_session_has_dialogue_${sessionId}`, "true");
    setSessions((prev) => updateSessionLastUserMessageAt(prev, sessionId, submittedAt));
    // 经 ref 读取最新 sessions，避免回调被 memo 化后闭包捕获过期数组
    const targetSession = sessionsRef.current.find((session) => session.id === sessionId);
    if (!targetSession || targetSession.isTemp) return;
    invoke("touch_session_last_user_message", { id: sessionId }).catch((err) => {
      log(`Failed to persist last user message time for ${sessionId}: ${err}`);
    });
  }, []);

  /** 首句提交：重置自动改名标记 + 记录最后用户消息时间 */
  const handleUserSubmittedInputWithRenameReset = useCallback(
    (sessionId: string, submittedAt?: string) => {
      clearRenameMark(sessionId);
      handleUserSubmittedInput(sessionId, submittedAt);
    },
    [clearRenameMark, handleUserSubmittedInput],
  );

  // 队列任务投递：按会话交互模式路由——GUI 聊天走 chat 发送事件，CLI 终端写 PTY
  const dispatchQueueTask = useCallback(
    (sessionId: string, prompt: string) => {
      const session = sessionsRef.current.find((s) => s.id === sessionId);
      const mode = interactionModeBySession[sessionId] ?? claudeInteractionMode;
      const useGuiChat = !!session && shouldUseGuiChat(session.type, mode);
      if (useGuiChat) {
        log(`[Queue] Dispatching queued task to GUI chat session ${sessionId}: "${prompt}"`);
        // 延迟 400ms：等后端 turn 收尾（turns map 清理）完成，避免「正在生成中」拒绝；
        // 若仍失败，ChatTab 侧会静默重试
        window.setTimeout(() => {
          window.dispatchEvent(
            new CustomEvent("kkcoder-chat-send-queued", {
              detail: { sessionId, prompt },
            }),
          );
        }, 400);
        return Promise.resolve();
      }
      return writeToSessionTerminal(sessionId, `${prompt}\r\n`, true);
    },
    [claudeInteractionMode, interactionModeBySession, writeToSessionTerminal],
  );

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
    dispatchTask: dispatchQueueTask,
    onTaskSubmitted: handleUserSubmittedInputWithRenameReset,
  });

  clearQueueForSessionRef.current = clearQueueForSession;
  setSessionBusyRef.current = setSessionBusy;

  // 浮动队列面板展开状态（不占布局，点击丝滑展开）
  const [queuePanelOpen, setQueuePanelOpen] = useState(false);

  const handleTriggerShortcut = (content: string) => {
    if (!activeSessionId) return;
    const isBusy = sessionBusy[activeSessionId] || false;
    if (isBusy) {
      if (getSessionQueue(queueBySession, activeSessionId).length >= MAX_SESSION_QUEUE_SIZE) {
        notifyWarning(`队列已满（${MAX_SESSION_QUEUE_SIZE}/${MAX_SESSION_QUEUE_SIZE}），请先清空或等待执行`);
        return;
      }
      enqueuePrompt(activeSessionId, content);
    } else {
      setSessionBusy((prev) => ({ ...prev, [activeSessionId]: true }));
      dispatchQueueTask(activeSessionId, content)
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
  const treeBoundSession = sessions.find((s) => s.id === treeBoundSessionId);
  const primarySplitSession = splitPair
    ? sessions.find((s) => s.id === splitPair.primaryId)
    : undefined;
  const secondarySplitSession = splitPair
    ? sessions.find((s) => s.id === splitPair.secondaryId)
    : undefined;
  const splitSameProject =
    Boolean(primarySplitSession?.path) &&
    primarySplitSession?.path === secondarySplitSession?.path;

  // 每个 tab 的「恢复/终端模式」判定只随相关状态变化重算，避免 App 每次重渲染都同步读 localStorage。
  // localStorage 写入点（has_dialogue 等）均伴随 setSessions，因此引用变化会触发本 memo 重算。
  const tabRuntimeBySession = useMemo(() => {
    const map = new Map<
      string,
      {
        shouldResume: boolean;
        useNativeTerminal: boolean;
        terminalMode: ClaudeTerminalMode;
        useGuiChat: boolean;
      }
    >();
    for (const session of sessions) {
      if (!openTabIds.includes(session.id)) continue;
      const terminalMode = terminalModeBySession[session.id] ?? claudeTerminalMode;
      const interactionMode = interactionModeBySession[session.id] ?? claudeInteractionMode;
      map.set(session.id, {
        shouldResume: shouldResumeSession(session.id, newSessionIds, localStorage),
        useNativeTerminal: shouldUseNativeTerminal(session.type, terminalMode),
        terminalMode,
        useGuiChat: shouldUseGuiChat(session.type, interactionMode),
      });
    }
    return map;
  }, [sessions, openTabIds, newSessionIds, terminalModeBySession, claudeTerminalMode, interactionModeBySession, claudeInteractionMode]);

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
  }, [showProjectTree, treeBoundSession?.path, setProjectTreeWidth]);

  const insertConversationTagToBoundTerminal = useCallback(
    (text: string, sourcePath?: string) => {
      if (!treeBoundSessionId || !text) return;
      // kind=text：选中内容（等价复制粘贴），输入框按行数折叠为标签；
      // sourcePath：源码视图选中时携带来源文件路径
      window.dispatchEvent(new CustomEvent("kkcoder-insert-conversation-tag", {
        detail: { sessionId: treeBoundSessionId, text, kind: "text", sourcePath },
      }));
      requestActiveTerminalFocus({ delayMs: 40, sessionId: treeBoundSessionId });
    },
    [treeBoundSessionId],
  );

  const handleInsertPathToSession = useCallback((sessionId: string, text: string) => {
    if (!sessionId || !text) return;
    // kind=file：文件路径引用，输入框登记为可整体删除的引用标签
    window.dispatchEvent(new CustomEvent("kkcoder-insert-conversation-tag", {
      detail: { sessionId, text, kind: "file" },
    }));
    requestActiveTerminalFocus({ delayMs: 40, sessionId });
  }, []);

  const {
    openFile: handleFileClick,
    handlePathRenamed: handlePreviewPathRenamed,
    panelProps: filePreviewPanelProps,
    contextMenuProps: filePreviewContextMenuProps,
  } = useFilePreview({
    projectPath: treeBoundSession?.path,
    activeSessionId: treeBoundSessionId,
    onInsertConversationTag: insertConversationTagToBoundTerminal,
  });

  const handleInsertPathToTerminal = useCallback((relativePath: string) => {
    if (!treeBoundSessionId) return;
    handleInsertPathToSession(treeBoundSessionId, `"${relativePath}" `);
  }, [handleInsertPathToSession, treeBoundSessionId]);

  const handleInsertPathToOtherSide = useCallback((relativePath: string) => {
    if (!otherSplitSessionId) return;
    handleInsertPathToSession(otherSplitSessionId, `"${relativePath}" `);
  }, [handleInsertPathToSession, otherSplitSessionId]);

  const handleEditFile = useCallback((relativePath: string) => {
    setEditingFilePath(relativePath);
  }, []);

  // 焦点契约：任一阻断焦点的叠加层关闭后，键盘归还活动终端
  const isTerminalFocusBlocked =
    showModal ||
    showSettings ||
    showMdEditor ||
    !!editingFilePath ||
    showQueueModal ||
    showCloseConfirmModal ||
    !!activeConfirm ||
    !!tabContextMenu ||
    !!renamingTabId;

  useReturnTerminalFocusWhenUnblocked(isTerminalFocusBlocked, 56);

  // 活动会话切换后确保可立即键入（与 tab 激活 effect 互补）
  useEffect(() => {
    if (!activeSessionId || isTerminalFocusBlocked) return;
    requestActiveTerminalFocus({ delayMs: 72 });
  }, [activeSessionId, isTerminalFocusBlocked]);

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

  useTabFlipAnimation(openTabIds);

  const handleOpenFolder = async () => {
    if (!activeSession) return;
    try {
      log(`Opening folder in explorer: ${activeSession.path}`);
      await invoke("open_project_folder", { path: activeSession.path });
    } catch (err) {
      log(`Failed to open folder: ${err}`);
      notifyError(`无法打开文件夹：${formatFeedbackError(err)}`);
    }
  };

  const handleActivateTab = useCallback(
    (sessionId: string) => {
      activateSplitSession(sessionId);
      setGlowingSessionIds((prev) => prev.filter((id) => id !== sessionId));
    },
    [activateSplitSession, setGlowingSessionIds],
  );

  const handleSelectSessionWithSplit = useCallback(
    (sessionId: string) => {
      log(`[app] select session=${sessionId}`);
      ensureTabOpen(sessionId);
      activateSplitSession(sessionId);
      // 点击会话：清除该会话的未读角标
      setGlowingSessionIds((prev) => prev.filter((id) => id !== sessionId));
    },
    [activateSplitSession, ensureTabOpen, setGlowingSessionIds],
  );

  // 分屏快捷键：Ctrl+\ 切换；Ctrl+Alt+1/2 聚焦左右（或上下）
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableFocusTarget(event.target)) return;
      if (
        showModal ||
        showSettings ||
        showMdEditor ||
        editingFilePath ||
        showQueueModal ||
        showCloseConfirmModal ||
        activeConfirm ||
        tabContextMenu ||
        renamingTabId
      ) {
        return;
      }

      const isMod = event.ctrlKey || event.metaKey;
      if (!isMod) return;

      if (event.key === "\\" && !event.altKey && !event.shiftKey) {
        event.preventDefault();
        toggleSplit();
        return;
      }

      if (event.altKey && (event.key === "1" || event.key === "2")) {
        if (!isDualSplit) return;
        event.preventDefault();
        focusPane(event.key === "1" ? "primary" : "secondary");
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeConfirm,
    editingFilePath,
    focusPane,
    isDualSplit,
    renamingTabId,
    showCloseConfirmModal,
    showMdEditor,
    showModal,
    showQueueModal,
    showSettings,
    tabContextMenu,
    toggleSplit,
  ]);


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
        sidebarMode={sidebarMode}
        onToggleSidebarMode={handleToggleSidebarMode}
        onLaunchCcswitch={handleLaunchCcswitch}
        onOpenSettings={() => {
          log("[app] open settings");
          setShowSettings(true);
        }}
        onMinimize={handleMinimize}
        onMaximize={handleMaximize}
        onClose={handleClose}
        onTitlebarMouseDown={handleTitlebarMouseDown}
      />

      {/* 主布局 */}
      <div className={`app-container sidebar-mode-${sidebarMode}`}>
        {/* 悬停模式：最左边缘保留一条细窄提示条，鼠标碰上即浮出侧栏 */}
        {sidebarMode === "hover" && (
          <div
            className={`sidebar-hover-strip ${sidebarRevealed ? "is-revealed" : ""}`}
            onMouseEnter={revealSidebar}
            title="悬停展开会话栏"
          />
        )}
        {/* 左边栏 - 专注于会话与项目管理 */}
        <Sidebar
          onOpenNewSession={handleOpenNewSession}
          onCreateSessionDirectly={handleCreateSessionDirectly}
          onOpenTempSession={handleOpenTempSession}
          sessions={sessions}
          activeSessionId={activeSessionId}
          onSelectSession={handleSelectSessionWithSplit}
          searchQuery={searchQuery}
          onSearchQueryChange={setSearchQuery}
          onDeleteSession={handleDeleteSession}
          openTabIds={openTabIds}
          onRenameSession={handleRenameSession}
          onToggleFavorite={handleToggleFavorite}
          highlightSessionId={highlightSessionId}
          onHighlightEnd={handleHighlightEnd}
          onDeleteSessionsBatch={handleDeleteSessionsBatch}
          glowingSessionIds={glowingSessionIds}
          width={sidebarWidth}
          sessionBusy={sessionBusy}
          hoverMode={sidebarMode === "hover"}
          revealed={sidebarRevealed}
          onHoverEnter={revealSidebar}
          onHoverLeave={scheduleSidebarHide}
        />
        {sidebarMode === "fixed" && (
          <div className={`sidebar-resizer ${isResizing ? "dragging" : ""}`} onMouseDown={startResize} />
        )}

        {/* 右侧主工作区 */}
        <main
          className={`main-workspace ${isDragOverWorkspace ? "drag-over" : ""}`}
          onDragOver={(e) => {
            if (isSessionDragEvent(e.dataTransfer)) {
              e.preventDefault();
              e.dataTransfer.dropEffect = "move";
              if (!isDualSplit) {
                const bounds = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const isRightHalf = e.clientX > bounds.left + bounds.width * 0.5;
                setDropHighlightSlot(isRightHalf ? "secondary" : null);
              }
              return;
            }
            e.preventDefault();
            e.dataTransfer.dropEffect = "copy";
            if (!isDragOverWorkspace) setIsDragOverWorkspace(true);
          }}
          onDragLeave={(e) => {
            if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) {
              setIsDragOverWorkspace(false);
              setDropHighlightSlot(null);
            }
          }}
          onDrop={(e) => {
            setIsDragOverWorkspace(false);
            setDropHighlightSlot(null);
            const sessionId = readSessionIdFromDataTransfer(e.dataTransfer);
            if (sessionId) {
              e.preventDefault();
              e.stopPropagation();
              // 单屏：拖到主区右半 → 钉到右侧分屏
              // 注意：终端根节点若已处理 drop，不会冒泡到这里
              if (!isDualSplit) {
                // 仅当落点在终端区域右半时分屏；落在标签栏等位置不误触发
                const splitRoot = document.querySelector(
                  ".terminal-split-root",
                ) as HTMLElement | null;
                const bounds = (
                  splitRoot ?? (e.currentTarget as HTMLElement)
                ).getBoundingClientRect();
                const isRightHalf = e.clientX > bounds.left + bounds.width * 0.5;
                const isOverTerminal =
                  !splitRoot ||
                  (e.clientY >= bounds.top && e.clientY <= bounds.bottom);
                if (isOverTerminal && isRightHalf) {
                  clearDragging();
                  enterSplitByDropAsSecondary(sessionId);
                } else if (openTabIds.includes(sessionId)) {
                  clearDragging();
                  activateSplitSession(sessionId);
                }
              }
              return;
            }
            e.preventDefault();
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
            paneSlotFor={paneSlotFor}
            isDualSplit={isDualSplit}
            splitPair={splitPair}
            splitOrientation={splitOrientation}
            splitRatio={splitRatio}
            onWheel={handleTabWheel}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            onActivateTab={handleActivateTab}
            onCloseTab={handleCloseTabWithSplit}
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
            <div
              className={`terminal-split-root ${isDualSplit ? "is-dual" : "is-single"} ${
                isDualSplit ? `orientation-${splitOrientation}` : ""
              } ${isResizingSplit ? "is-resizing" : ""} ${
                !isDualSplit && draggingIndex !== null ? "is-session-dragging" : ""
              } ${
                !isDualSplit && dropHighlightSlot === "secondary"
                  ? "session-drop-right-hint"
                  : ""
              }`}
              onDragOver={(event) => {
                // 单屏：整区接收标签拖放（右半 → 分屏）
                if (!isDualSplit) {
                  handleSessionDragOverRoot(event);
                }
              }}
              onDragLeave={(event) => {
                if (isDualSplit) return;
                const related = event.relatedTarget as Node | null;
                if (!(event.currentTarget as HTMLElement).contains(related)) {
                  setDropHighlightSlot(null);
                }
              }}
              onDrop={(event) => {
                if (!isDualSplit) {
                  const handled = handleSessionDropOnRoot(event);
                  if (handled) {
                    clearDragging();
                  }
                }
              }}
            >
              {openTabIds.length === 0 ? (
                <div className="empty-state">
                  <img className="empty-state-logo" src={kkcoderLogo} alt="KKCoder" draggable={false} />
                  <div className="empty-state-title">KKCoder AI 终端管理器</div>
                  <div className="empty-state-desc">
                    当前没有处于活动状态的会话标签。
                    请选择左上角的 Agent 类型并点击“**新建 AI 终端**”按钮来开启一个托管终端。
                  </div>
                </div>
              ) : (
                <>
                  {sessions.map((s) => {
                    const isOpen = openTabIds.includes(s.id);
                    if (!isOpen) return null;
                    const isActive = activeSessionId === s.id;
                    const paneSlot = paneSlotFor(s.id);
                    const isVisible =
                      isActive || (isDualSplit && paneSlot !== null);
                    const runtime = tabRuntimeBySession.get(s.id);
                    const shouldResume = runtime?.shouldResume ?? false;
                    const useNativeTerminal =
                      runtime?.useNativeTerminal ?? false;
                    const useGuiChat = runtime?.useGuiChat ?? false;
                    return (
                      <div
                        key={s.id}
                        className={`terminal-pane-host ${
                          isActive ? "is-focused" : ""
                        } ${isVisible ? "is-visible" : ""} ${
                          paneSlot ? `slot-${paneSlot}` : ""
                        } ${
                          dropHighlightSlot && paneSlot === dropHighlightSlot
                            ? "drop-target"
                            : ""
                        }`}
                        style={hostStyleFor(s.id)}
                        onMouseDown={() => {
                          if (isDualSplit && paneSlot && !isActive) {
                            focusPane(paneSlot);
                          }
                        }}
                        onDragOver={(event) => {
                          if (!isDualSplit || !paneSlot) return;
                          handleSessionDragOverPane(event);
                          if (isSessionDragEvent(event.dataTransfer)) {
                            setDropHighlightSlot(paneSlot);
                          }
                        }}
                        onDragLeave={(event) => {
                          if (
                            !(event.currentTarget as HTMLElement).contains(
                              event.relatedTarget as Node,
                            )
                          ) {
                            setDropHighlightSlot((current) =>
                              current === paneSlot ? null : current,
                            );
                          }
                        }}
                        onDrop={(event) => {
                          if (!isDualSplit || !paneSlot) return;
                          const handled = handleSessionDropOnPane(event, paneSlot);
                          if (handled) {
                            clearDragging();
                          }
                        }}
                      >
                        {useGuiChat ? (
                          <ChatTab
                            sessionId={s.id}
                            directory={s.path}
                            agentSessionId={s.agentSessionId}
                            isActive={isActive}
                            selectedModel={selectedModel}
                            modelInfo={modelInfo}
                            onSelectModel={handleSelectModel}
                            onSelectProvider={handleSelectProvider}
                            onRefreshModelInfo={refreshModelInfo}
                            onSpawned={() => {
                              log(`ChatTab spawn resolved for session: ${s.id}. Removing from newSessionIds...`);
                              setNewSessionIds((prev) => prev.filter((nid) => nid !== s.id));
                            }}
                            onStateChange={(busy) => {
                              setSessionBusy(prev => ({ ...prev, [s.id]: busy }));
                            }}
                            onCommandComplete={() => handleCommandComplete(s.id)}
                            onUserSubmittedInput={handleUserSubmittedInputWithRenameReset}
                            onEnqueuePrompt={enqueuePrompt}
                            queueTasks={s.id === activeSessionId ? activeQueue : []}
                            queuePanelOpen={queuePanelOpen}
                            onToggleQueuePanel={() => setQueuePanelOpen((v) => !v)}
                            onRemoveQueueTask={removeQueuedTask}
                            onClearQueue={clearQueueForSession}
                          />
                        ) : useNativeTerminal ? (
                          <CompatibilityTerminalTab
                            sessionId={s.id}
                            directory={s.path}
                            agentSessionId={s.agentSessionId}
                            isReopen={shouldResume}
                            isActive={isActive}
                            isVisible={isVisible}
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
                            isVisible={isVisible}
                            onCommandComplete={() => handleCommandComplete(s.id)}
                            onUserSubmittedInput={handleUserSubmittedInputWithRenameReset}
                            onRenameSession={handleRenameSession}
                          />
                        )}
                        {!useGuiChat && sessionBusy[s.id] && (
                          <div className="terminal-thinking-badge">
                            <span className="thinking-dot-pulse"></span>
                            <span className="thinking-text">AI 正在思考...</span>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  {isDualSplit && resizerStyle && (
                    <div
                      className="terminal-split-resizer orientation-horizontal"
                      style={resizerStyle}
                      onPointerDown={startSplitResize}
                      onDoubleClick={resetSplitRatio}
                      title="拖拽调整比例 · 双击均分"
                      role="separator"
                      aria-orientation="vertical"
                    />
                  )}
                </>
              )}
            </div>

            <FilePreviewPanel {...filePreviewPanelProps} />
          </div>

          {/* 底部控制状态条 */}
          <div className="bottom-panel">
            {activeSession ? (
              <div className="bottom-panel-left">
                <button
                  className="folder-button"
                  onClick={handleOpenFolder}
                  title={`项目物理路径: ${activeSession.path}\n点击在 Windows 资源管理器中打开`}
                >
                  <svg className="folder-svg-icon" xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="#EAB308" stroke="#EAB308" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.95, marginRight: "4px" }}>
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                  </svg>
                  <span>{getFolderName(activeSession.path)}</span>
                </button>

                <button
                  className="md-button"
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
                    color: "var(--color-orange)",
                  }}
                >
                  {claudeVersion}
                </span>
              ) : (
                <span>{claudeVersion} 准备就绪</span>
              )}
            </div>
          </div>
        </main>

        {showProjectTree && !treeBoundSession?.isTemp && (
          <>
            <div 
              className={`project-tree-resizer ${isResizingProjectTree ? "dragging" : ""}`} 
              onMouseDown={startProjectTreeResize} 
              data-agent-type={treeBoundSession?.type || activeSession?.type || "claude"}
            />
            <aside
              ref={projectTreeAsideRef}
              className={`project-tree-aside ${
                isDualSplit ? `binding-${projectTreeBindingMode}` : ""
              }`}
              style={{ width: `${projectTreeWidth}px` }}
            >
              <ProjectTreeBindingBar
                isDualSplit={isDualSplit}
                bindingMode={projectTreeBindingMode}
                onBindingModeChange={setProjectTreeBindingMode}
                primaryLabel={
                  primarySplitSession?.name ||
                  primarySplitSession?.project ||
                  "左侧会话"
                }
                secondaryLabel={
                  secondarySplitSession?.name ||
                  secondarySplitSession?.project ||
                  "右侧会话"
                }
                boundFolderName={
                  treeBoundSession?.path
                    ? getFolderName(treeBoundSession.path)
                    : ""
                }
                boundPath={treeBoundSession?.path || ""}
                sameProject={splitSameProject}
              />
              {treeBoundSession && treeBoundSession.path ? (
                <ProjectTree
                  projectPath={treeBoundSession.path}
                  onFileClick={handleFileClick}
                  onInsertPathToTerminal={handleInsertPathToTerminal}
                  onInsertPathToOtherSide={
                    otherSplitSessionId ? handleInsertPathToOtherSide : undefined
                  }
                  otherSideInsertLabel={
                    otherSplitSessionId === splitPair?.primaryId
                      ? "添加到左侧对话"
                      : otherSplitSessionId === splitPair?.secondaryId
                        ? "添加到右侧对话"
                        : "添加到另一侧对话"
                  }
                  onEditFile={handleEditFile}
                  onPathRenamed={handlePathRenamed}
                />
              ) : (
                <div className="tree-placeholder-container">
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
        onCreate={handleCreateSession}
        initialProjectPath={prefilledProjectPath}
      />

      {/* 设置中心弹窗组件 */}
      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
        onSessionsRenamed={reloadSessions}
      />

      {/* 规则编辑器：默认 CLAUDE.md，保存后同步 AGENTS.md（跟随项目树绑定） */}
      {treeBoundSession && (
        <MdEditorModal
          show={showMdEditor}
          onClose={() => setShowMdEditor(false)}
          projectPath={treeBoundSession.path}
          filename="CLAUDE.md"
        />
      )}

      {/* 文本文件编辑器弹窗 */}
      {treeBoundSession && editingFilePath && (
        <FileEditorModal
          show={!!editingFilePath}
          onClose={() => setEditingFilePath(null)}
          projectPath={treeBoundSession.path}
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
        activeSessionId={activeSessionId}
        isDualSplit={isDualSplit}
        openTabCount={openTabIds.length}
        onCloseTab={handleCloseTabWithSplit}
        onCloseOtherTabs={(sessionId) => {
          setOpenTabIds([sessionId]);
          collapseToSingle(sessionId);
        }}
        onStartRename={(sessionId, currentName) => {
          setRenamingTabId(sessionId);
          setRenamingTabText(currentName);
        }}
        onLocateSession={handleLocateSession}
        onOpenInSplit={enterSplitWithSession}
        onExitSplit={exitSplit}
        onClose={() => setTabContextMenu(null)}
      />

      <CloseConfirmModal
        show={showCloseConfirmModal}
        rememberChoice={rememberCloseChoice}
        appWindow={appWindow}
        onRememberChange={setRememberCloseChoice}
        onCancel={() => setShowCloseConfirmModal(false)}
      />

      <AppToastHost toasts={toasts} onDismiss={dismissToast} />

      {activeConfirm && (
        <ConfirmModal
          show
          title={activeConfirm.title}
          message={activeConfirm.message}
          confirmText={activeConfirm.confirmText}
          cancelText={activeConfirm.cancelText}
          isDanger={activeConfirm.isDanger}
          onConfirm={() => resolveConfirm(true)}
          onCancel={() => resolveConfirm(false)}
        />
      )}
    </div>
  );
}


export default App;
