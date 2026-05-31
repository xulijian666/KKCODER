import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { Sidebar, Session, ClaudeIcon, PiIcon } from "./components/Sidebar";
import { TerminalTab } from "./components/TerminalTab";
import { NewSessionModal } from "./components/NewSessionModal";
import { SettingsModal } from "./components/SettingsModal";
import "./App.css";

// 100% 安全的 UUID 生成器，防止 WebView2 部分版本及非安全上下文抛错闪退
function generateUUID(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    try {
      return crypto.randomUUID();
    } catch (e) {
      console.warn("crypto.randomUUID failed, falling back to math.random", e);
    }
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 持久化前端日志助手，即便窗口发生重载闪退，之前的日志也可以通过 localStorage 追溯
function log(msg: string) {
  const time = new Date().toISOString();
  const fullMsg = `[JS][${time}] ${msg}`;
  console.log(fullMsg);
  try {
    const existingLogs = JSON.parse(localStorage.getItem("kkcoder_logs") || "[]");
    existingLogs.push(fullMsg);
    if (existingLogs.length > 200) {
      existingLogs.shift();
    }
    localStorage.setItem("kkcoder_logs", JSON.stringify(existingLogs));
  } catch (e) {}
}

function getFolderName(path: string): string {
  if (!path) return "";
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] || path;
}

function App() {

  const appWindow = getCurrentWindow();

  const handleMinimize = () => {
    appWindow.minimize().catch((err) => log(`Failed to minimize: ${err}`));
  };

  const handleMaximize = () => {
    appWindow.toggleMaximize().catch((err) => log(`Failed to toggle maximize: ${err}`));
  };

  const handleClose = () => {
    appWindow.close().catch((err) => log(`Failed to close window: ${err}`));
  };

  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [openTabIds, setOpenTabIds] = useState<string[]>([]);
  const [selectedAgent, setSelectedAgent] = useState<"claude" | "pi">("claude");
  const [showModal, setShowModal] = useState<boolean>(false);
  const [showSettings, setShowSettings] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  // 记录新创建的会话ID，全新拉起时不键入 /resume；其他历史会话在重连时自动键入 /resume 还原上下文
  const [newSessionIds, setNewSessionIds] = useState<string[]>([]);

  // 快捷短语状态
  const [shortcutsEnabled, setShortcutsEnabled] = useState<boolean>(() => {
    const val = localStorage.getItem("kkcoder_shortcuts_enabled");
    return val === null ? false : val === "true";
  });

  const [shortcutsList, setShortcutsList] = useState<{ title: string; content: string }[]>(() => {
    const val = localStorage.getItem("kkcoder_shortcuts_list");
    if (val) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          const list = [...parsed];
          while (list.length < 3) list.push({ title: "", content: "" });
          return list.slice(0, 3);
        }
      } catch (e) {
        // ignore
      }
    }
    return [
      { title: "继续", content: "继续完成" },
      { title: "", content: "" },
      { title: "", content: "" },
    ];
  });

  // 监听快捷短语设置变动
  useEffect(() => {
    const handleShortcutsChange = () => {
      const enabledVal = localStorage.getItem("kkcoder_shortcuts_enabled");
      setShortcutsEnabled(enabledVal === null ? false : enabledVal === "true");

      const listVal = localStorage.getItem("kkcoder_shortcuts_list");
      if (listVal) {
        try {
          const parsed = JSON.parse(listVal);
          if (Array.isArray(parsed)) {
            const list = [...parsed];
            while (list.length < 3) list.push({ title: "", content: "" });
            setShortcutsList(list.slice(0, 3));
          }
        } catch (e) {
          // ignore
        }
      }
    };

    window.addEventListener("kkcoder-shortcuts-change", handleShortcutsChange);
    return () => {
      window.removeEventListener("kkcoder-shortcuts-change", handleShortcutsChange);
    };
  }, []);

  const handleTriggerShortcut = (content: string) => {
    if (!activeSessionId) return;
    const isBusy = sessionBusy[activeSessionId] || false;
    if (isBusy) {
      if (queue.length >= 2) {
        alert("队列已满！目前最多只允许队列中有 2 个排队任务。");
        return;
      }
      setQueue(prev => [...prev, { id: generateUUID(), prompt: content }]);
    } else {
      setSessionBusy(prev => ({ ...prev, [activeSessionId]: true }));
      invoke("write_to_terminal", { sessionId: activeSessionId, data: content + "\r\n" })
        .catch((err) => {
          log(`Failed to send shortcut phrase: ${err}`);
          setSessionBusy(prev => ({ ...prev, [activeSessionId]: false }));
        });
    }
  };

  // 标签页右键菜单与高亮闪烁、行内重命名状态
  const [highlightSessionId, setHighlightSessionId] = useState<string | null>(null);
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; sessionId: string } | null>(null);
  const [renamingTabId, setRenamingTabId] = useState<string | null>(null);
  const [renamingTabText, setRenamingTabText] = useState<string>("");

  // 📋 任务队列状态与自动调度引擎
  interface QueueTask {
    id: string;
    prompt: string;
  }
  const [queue, setQueue] = useState<QueueTask[]>([]);
  const [showQueueModal, setShowQueueModal] = useState<boolean>(false);
  const [queueInput, setQueueInput] = useState<string>("");
  const [sessionBusy, setSessionBusy] = useState<Record<string, boolean>>({});

  const handleAddToQueue = () => {
    const trimmed = queueInput.trim();
    if (!trimmed) {
      alert("请输入要排队执行的提示词！");
      return;
    }
    if (queue.length >= 2) {
      alert("队列已满！目前最多只允许队列中有 2 个排队任务。");
      return;
    }
    setQueue(prev => [...prev, { id: generateUUID(), prompt: trimmed }]);
    setQueueInput("");
    setShowQueueModal(false);
  };

  // 队列自动调度引擎
  useEffect(() => {
    if (!activeSessionId) return;
    const isActiveBusy = sessionBusy[activeSessionId] || false;
    if (!isActiveBusy && queue.length > 0) {
      // 弹出并执行下一个排队任务
      const nextTask = queue[0];
      log(`[Queue] Auto-triggering queued task: "${nextTask.prompt}" for session: ${activeSessionId}`);
      
      // 立即在前端置为繁忙，防范异步重入和并发发送
      setSessionBusy(prev => ({ ...prev, [activeSessionId]: true }));
      
      // 写入终端
      invoke("write_to_terminal", { sessionId: activeSessionId, data: nextTask.prompt + "\r\n" })
        .then(() => {
          log(`[Queue] Successfully sent task to terminal. Removing from queue...`);
          setQueue(prev => prev.slice(1));
        })
        .catch((err) => {
          log(`[Queue] Failed to send queued task: ${err}`);
          // 发送失败恢复闲置状态
          setSessionBusy(prev => ({ ...prev, [activeSessionId]: false }));
        });
    }
  }, [queue, activeSessionId, sessionBusy]);

  // 当队列长度或显示状态变化时，强力触发 resize 事件，确保 xterm.js 虚拟终端完美重测尺寸且不遮挡输入框
  useEffect(() => {
    const timer = setTimeout(() => {
      window.dispatchEvent(new Event("resize"));
    }, 80); // 80ms 确保 DOM 树重排与 CSS 动画过渡彻底完成
    return () => clearTimeout(timer);
  }, [queue.length]);

  const activeSession = sessions.find((s) => s.id === activeSessionId);

  // 记住最后的会话和打开的 Tab 标签页
  useEffect(() => {
    if (activeSessionId) {
      localStorage.setItem("kkcoder_last_active_session_id", activeSessionId);
    }
  }, [activeSessionId]);

  useEffect(() => {
    localStorage.setItem("kkcoder_last_open_tab_ids", JSON.stringify(openTabIds));
  }, [openTabIds]);

  // 💾 自动载入与保存持久化窗口窗体大小 (防抖 300ms 性能极致优化)
  useEffect(() => {
    const savedWidth = localStorage.getItem("kkcoder_window_width");
    const savedHeight = localStorage.getItem("kkcoder_window_height");
    const w = savedWidth ? parseInt(savedWidth, 10) : 1200;
    const h = savedHeight ? parseInt(savedHeight, 10) : 800;
    const clampedW = Math.max(1000, w);
    const clampedH = Math.max(750, h);

    appWindow.setSize(new LogicalSize(clampedW, clampedH))
      .then(() => {
        return appWindow.center();
      })
      .catch((err) => {
        log(`Failed to set window size and center on boot: ${err}`);
      });

    let resizeTimeout: any = null;
    const handleWindowResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const w = window.outerWidth;
        const h = window.outerHeight;
        if (w >= 1000 && h >= 750) {
          localStorage.setItem("kkcoder_window_width", String(w));
          localStorage.setItem("kkcoder_window_height", String(h));
        }
      }, 300);
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [appWindow]);

  // 点击任何地方关闭标签页右键菜单
  useEffect(() => {
    const closeTabMenu = () => setTabContextMenu(null);
    window.addEventListener("click", closeTabMenu);
    return () => window.removeEventListener("click", closeTabMenu);
  }, []);

  // 🚫 全局彻底拦截并禁用系统默认右键菜单，彻底实现无菜单点击无反应
  useEffect(() => {
    const handleGlobalContextMenu = (e: MouseEvent) => {
      e.preventDefault();
    };
    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => {
      window.removeEventListener("contextmenu", handleGlobalContextMenu);
    };
  }, []);

  // 💾 监听窗口关闭事件，根据设置执行对应行为 (每次询问 / 最小化托盘 / 直接退出)
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState<boolean>(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState<boolean>(false);

  useEffect(() => {
    let unlisten: any = null;
    const setupCloseListener = async () => {
      try {
        unlisten = await appWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          const behavior = localStorage.getItem("kkcoder_setting_close_behavior") || "exit";
          log(`onCloseRequested event captured. Current behavior: ${behavior}`);
          
          if (behavior === "exit") {
            appWindow.destroy().catch((err) => log(`Failed to destroy window: ${err}`));
          } else if (behavior === "minimize") {
            appWindow.hide().catch((err) => log(`Failed to hide window: ${err}`));
          } else {
            // "ask" -> 每次询问，唤起前端 custom 退出确认弹窗
            setShowCloseConfirmModal(true);
          }
        });
        log("Window close requested listener registered successfully.");
      } catch (err) {
        log(`Failed to register onCloseRequested: ${err}`);
      }
    };
    setupCloseListener();
    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [appWindow]);

  // 1. 初始化挂载时，从本地 SQLite 数据库载入历史会话，并还原上次活跃会话
  useEffect(() => {
    // 恢复并展示上一次运行时的闪退/残留日志
    try {
      const persistedLogs = JSON.parse(localStorage.getItem("kkcoder_logs") || "[]");
      if (persistedLogs.length > 0) {
        console.group("=== KkCoder 历史崩溃/运行追踪日志 ===");
        persistedLogs.forEach((l: string) => console.log(l));
        console.groupEnd();
      }
    } catch (e) {}

    log("App mounted. Fetching sessions from SQLite database...");
    invoke<Session[]>("get_sessions")
      .then((data) => {
        log(`Successfully fetched ${data ? data.length : 0} sessions from database.`);
        setSessions(data || []);
        if (data && data.length > 0) {
          const lastActiveId = localStorage.getItem("kkcoder_last_active_session_id");
          const lastOpenTabsStr = localStorage.getItem("kkcoder_last_open_tab_ids");
          let lastOpenTabs: string[] = [];
          try {
            if (lastOpenTabsStr) lastOpenTabs = JSON.parse(lastOpenTabsStr);
          } catch (e) {}

          const validActiveId = data.some((s) => s.id === lastActiveId) ? lastActiveId : data[0].id;
          const validOpenTabs = lastOpenTabs.filter((tid) => data.some((s) => s.id === tid));

          if (validActiveId) {
            if (!validOpenTabs.includes(validActiveId)) {
              validOpenTabs.push(validActiveId);
            }
            setActiveSessionId(validActiveId);
            setOpenTabIds(validOpenTabs);

            // 自动同步 Agent 选卡到活跃会话的品牌
            const activeSess = data.find((s) => s.id === validActiveId);
            if (activeSess) {
              setSelectedAgent(activeSess.type);
            }
          } else {
            setActiveSessionId(data[0].id);
            setOpenTabIds([data[0].id]);
            setSelectedAgent(data[0].type);
          }
        }
      })
      .catch((err) => {
        log(`Failed to fetch sessions from SQLite: ${err}`);
        console.error("加载 SQLite 本地会话数据失败", err);
      });
  }, []);

  // 📂 调用 Rust 后端，在资源管理器中打开项目物理文件夹路径
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

  // 创建新会话终端，同步持久化到本地数据库
  const handleCreateSession = async (
    sessionName: string,
    projectPath: string,
    projectName: string
  ) => {
    log(`handleCreateSession triggered: name=${sessionName}, path=${projectPath}, project=${projectName}, agent=${selectedAgent}`);

    const newId = `session-${Date.now().toString()}`;
    const agentSessionId = generateUUID(); // 生成安全标准的 RFC 4122 持久化会话 UUID
    log(`Generated new session UUIDs: id=${newId}, agentSessionId=${agentSessionId}`);
    
    const newSession: Session = {
      id: newId,
      name: sessionName,
      project: projectName,
      path: projectPath,
      type: selectedAgent,
      agentSessionId,
      favorite: 0, // 初始默认为未收藏
    };

    log(`Invoking add_session to SQLite...`);
    // 存储入本地 SQLite 数据库中
    invoke("add_session", { session: newSession })
      .then(() => {
        log(`Successfully added session ${newId} to SQLite. Updating React states...`);
        setSessions((prev) => {
          log(`Adding ${newId} to sessions list (previous size: ${prev.length})`);
          return [...prev, newSession];
        });
        setNewSessionIds((prev) => {
          log(`Adding ${newId} to newSessionIds (previous size: ${prev.length})`);
          return [...prev, newId];
        });
        setOpenTabIds((prev) => {
          log(`Adding ${newId} to openTabIds (previous size: ${prev.length})`);
          return [...prev, newId];
        });
        log(`Setting activeSessionId to ${newId}`);
        setActiveSessionId(newId);
        log(`handleCreateSession state updates finished.`);
      })
      .catch((err) => {
        log(`Failed to save session ${newId} to SQLite: ${err}`);
        alert(`保存会话失败: ${err}`);
      });
  };

  // 选择会话切换 (侧边栏点击逻辑)
  const handleSelectSession = (id: string) => {
    if (!openTabIds.includes(id)) {
      setOpenTabIds((prev) => [...prev, id]);
    }
    setActiveSessionId(id);
  };

  // 💾 保存标签页的行内重命名并同步数据库
  const handleSaveTabRename = (id: string) => {
    if (renamingTabText.trim()) {
      handleRenameSession(id, renamingTabText.trim());
    }
    setRenamingTabId(null);
  };

  // 🎯 在左侧边栏中定位特定会话，确保 Agent 选卡匹配并触发闪烁提醒
  const handleLocateSession = (sessionId: string) => {
    const s = sessions.find((sess) => sess.id === sessionId);
    if (s) {
      setSelectedAgent(s.type);
      setHighlightSessionId(sessionId);
      log(`Locating session ${sessionId} in sidebar. Selected agent type: ${s.type}`);
    }
  };

  // 关闭 Tab 标签
  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    log(`handleCloseTab triggered: id=${id}`);
    
    // 销毁后端 PTY 进程，彻底避免垃圾僵尸进程积累
    invoke("close_terminal", { sessionId: id }).catch((err) => {
      log(`Failed to close terminal PTY process for ${id}: ${err}`);
    });

    const updatedTabs = openTabIds.filter((tid) => tid !== id);
    setOpenTabIds(updatedTabs);

    // 从 newSessionIds 中移去该 ID，确保任何后续重新打开均被正确判定为 PTY Reopen 且执行 /resume
    setNewSessionIds((prev) => prev.filter((nid) => nid !== id));

    if (activeSessionId === id) {
      if (updatedTabs.length > 0) {
        setActiveSessionId(updatedTabs[updatedTabs.length - 1]);
      } else {
        setActiveSessionId("");
      }
    }
  };

  // 🗑️ 从本地 SQLite 数据库中完全物理删除该会话记录
  const handleDeleteSession = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    if (!confirm("确定要永久删除该会话及其所有本地终端数据吗？(此操作不可逆)")) return;
    try {
      // 销毁后端 PTY 进程
      invoke("close_terminal", { sessionId: id }).catch(() => {});
      await invoke("delete_session", { id });
      setSessions((prev) => prev.filter((s) => s.id !== id));
      setOpenTabIds((prev) => prev.filter((tid) => tid !== id));
      if (activeSessionId === id) {
        const remaining = openTabIds.filter((tid) => tid !== id);
        if (remaining.length > 0) {
          setActiveSessionId(remaining[remaining.length - 1]);
        } else {
          setActiveSessionId("");
        }
      }
    } catch (err) {
      alert(`删除会话失败: ${err}`);
    }
  };

  // 🗑️ 批量从 SQLite 数据库与 React 状态中删除会话记录
  const handleDeleteSessionsBatch = async (ids: string[]) => {
    log(`handleDeleteSessionsBatch triggered: ids=[${ids.join(", ")}]`);
    try {
      await Promise.all(ids.map((id) => invoke("delete_session", { id })));
      setSessions((prev) => prev.filter((s) => !ids.includes(s.id)));
      setOpenTabIds((prev) => prev.filter((tid) => !ids.includes(tid)));
      if (ids.includes(activeSessionId)) {
        const remaining = openTabIds.filter((tid) => !ids.includes(tid));
        if (remaining.length > 0) {
          setActiveSessionId(remaining[remaining.length - 1]);
        } else {
          setActiveSessionId("");
        }
      }
      log(`Successfully batch deleted ${ids.length} sessions.`);
    } catch (err) {
      log(`Failed to batch delete sessions: ${err}`);
      alert(`批量删除会话失败: ${err}`);
    }
  };

  // ✏️ 重命名会话，同步写入 SQLite 并更新 React 状态
  const handleRenameSession = async (id: string, newName: string) => {
    log(`handleRenameSession triggered: id=${id}, newName=${newName}`);
    try {
      await invoke("rename_session", { id, newName });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, name: newName } : s))
      );
      log(`Successfully renamed session ${id} to ${newName}`);
    } catch (err) {
      log(`Failed to rename session ${id}: ${err}`);
      alert(`重命名失败: ${err}`);
    }
  };

  // ⭐ 切换会话收藏状态，同步写入 SQLite 并更新 React 状态
  const handleToggleFavorite = async (id: string, isFavorite: boolean) => {
    const favoriteVal = isFavorite ? 1 : 0;
    log(`handleToggleFavorite triggered: id=${id}, favorite=${favoriteVal}`);
    try {
      await invoke("toggle_favorite", { id, favorite: favoriteVal });
      setSessions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, favorite: favoriteVal } : s))
      );
      log(`Successfully toggled favorite for session ${id} to ${favoriteVal}`);
    } catch (err) {
      log(`Failed to toggle favorite for session ${id}: ${err}`);
      alert(`操作收藏失败: ${err}`);
    }
  };

  // 📥 首次启动 Pi 会话后自动捕获其 session ID 并同步回 SQLite 数据库与 React 状态
  const handleCaptureSessionId = async (sessionId: string, agentSessionId: string) => {
    log(`handleCaptureSessionId triggered: sessionId=${sessionId}, agentSessionId=${agentSessionId}`);
    try {
      const s = sessions.find((sess) => sess.id === sessionId);
      if (s) {
        const updatedSession = { ...s, agentSessionId };
        await invoke("add_session", { session: updatedSession });
        setSessions((prev) =>
          prev.map((sess) => (sess.id === sessionId ? updatedSession : sess))
        );
        log(`Successfully captured and updated Pi session ID in database for ${sessionId} to ${agentSessionId}`);
      }
    } catch (err) {
      log(`Failed to update captured session ID in database: ${err}`);
    }
  };

  // 🖱️ 鼠标滚轮滚动标签栏交互：滚轮向下就是往右滚，往上就是往左滚
  const handleTabWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (e.currentTarget) {
      e.currentTarget.scrollLeft += e.deltaY;
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* 极简无边框窗口自定义标题栏 */}
      <div className="custom-titlebar" data-tauri-drag-region>
        <div className="titlebar-logo" data-tauri-drag-region>
          {/* 🍊 高档黑橙 KK 矢量徽标 */}
          <div className="titlebar-logo-icon" data-tauri-drag-region>
            KK
          </div>
          <span className="logo-title-text" data-tauri-drag-region>KKCoder 极简 AI 终端管理器</span>
        </div>
        <div className="titlebar-actions">
          <button
            className="titlebar-btn settings-gear-btn"
            onClick={() => setShowSettings(true)}
            title="打开设置"
          >
            ⚙️
          </button>
          <button
            className="titlebar-btn minimize-btn"
            onClick={handleMinimize}
            title="最小化"
          >
            －
          </button>
          <button
            className="titlebar-btn maximize-btn"
            onClick={handleMaximize}
            title="最大化"
          >
            🗖
          </button>
          <button
            className="titlebar-btn close-btn"
            onClick={handleClose}
            title="关闭"
          >
            ✕
          </button>
        </div>
      </div>

      {/* 主布局 */}
      <div className="app-container">
        {/* 左边栏 - 专注于会话与项目管理 */}
        <Sidebar
          selectedAgent={selectedAgent}
          onSelectAgent={setSelectedAgent}
          onOpenNewSession={() => setShowModal(true)}
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
        />

        {/* 右侧主工作区 */}
        <main className="main-workspace">
          {/* 顶部 Tab 标签栏 */}
          <div className="tab-bar">
            <div className="tab-list" onWheel={handleTabWheel}>
              {openTabIds.map((tid) => {
                const s = sessions.find((sess) => sess.id === tid);
                if (!s) return null;
                const isActive = activeSessionId === tid;
                const isRenaming = renamingTabId === s.id;
                return (
                  <div
                    key={s.id}
                    className={`tab ${isActive ? "active" : ""} ${
                      isActive && s.type === "pi" ? "pi-tab" : ""
                    }`}
                    onClick={() => setActiveSessionId(s.id)}
                    onMouseDown={(e) => {
                      if (e.button === 1) {
                        e.preventDefault();
                        e.stopPropagation();
                        const ev = { stopPropagation: () => {} } as React.MouseEvent;
                        handleCloseTab(ev, s.id);
                      }
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setTabContextMenu({
                        x: e.clientX,
                        y: e.clientY,
                        sessionId: s.id,
                      });
                    }}
                  >
                    {isRenaming ? (
                      <input
                        type="text"
                        className="tab-rename-input"
                        value={renamingTabText}
                        onChange={(e) => setRenamingTabText(e.target.value)}
                        onBlur={() => handleSaveTabRename(s.id)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleSaveTabRename(s.id);
                          else if (e.key === "Escape") setRenamingTabId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        autoFocus
                      />
                    ) : (
                      <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                        {s.type === "claude" ? <ClaudeIcon size={14} color="#D97757" /> : <PiIcon size={14} color="var(--color-green)" />}
                        <span>{s.name} ({s.project})</span>
                      </span>
                    )}
                    <span
                      className="tab-close"
                      onClick={(e) => handleCloseTab(e, s.id)}
                    >
                      ×
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 终端区 / 空白提示状态 (采用 Keep-Alive 常驻 DOM 设计，防止切换 Tab 时重新初始化) */}
          <div style={{ flex: 1, display: "flex", flexDirection: "column", position: "relative", overflow: "hidden" }}>
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
              openTabIds.map((tid) => {
                const s = sessions.find((sess) => sess.id === tid);
                if (!s) return null;
                const isActive = activeSessionId === tid;
                return (
                  <div
                    key={s.id}
                    style={{
                      display: isActive ? "flex" : "none",
                      flexDirection: "column",
                      flex: 1,
                      width: "100%",
                      height: "100%",
                    }}
                  >
                    <TerminalTab
                      sessionId={s.id}
                      directory={s.path}
                      agentType={s.type}
                      agentSessionId={s.agentSessionId}
                      isReopen={!newSessionIds.includes(s.id)}
                      onSpawned={() => {
                        log(`TerminalTab spawn resolved for session: ${s.id}. Removing from newSessionIds...`);
                        setNewSessionIds((prev) => prev.filter((nid) => nid !== s.id));
                      }}
                      onCaptureSessionId={handleCaptureSessionId}
                      busy={sessionBusy[s.id] || false}
                      onStateChange={(busy) => {
                        setSessionBusy(prev => ({ ...prev, [s.id]: busy }));
                      }}
                    />
                  </div>
                );
              })
            )}
          </div>

          {/* 新增的队列列表面板 */}
          {queue.length > 0 && (
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
                  <span>任务队列 ({queue.length})</span>
                </div>
                <button 
                  className="queue-clear-btn"
                  onClick={() => setQueue([])}
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
                {queue.map((task, index) => (
                  <div key={task.id} className="queue-item">
                    <span className="queue-item-index">{index + 1}</span>
                    <span className="queue-item-text">{task.prompt}</span>
                    <button
                      className="queue-item-delete"
                      onClick={() => setQueue(prev => prev.filter(t => t.id !== task.id))}
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
            ) : (
              <div style={{ color: "var(--text-secondary)", fontSize: "12px" }}>
                无活动项目会话
              </div>
            )}

            {/* 新增的【队列】状态栏按钮 */}
            {activeSession && (
              <div className="queue-status-btn-container" style={{
                position: "absolute",
                left: "50%",
                transform: "translateX(-50%)",
                display: "flex",
                gap: "8px",
                alignItems: "center"
              }}>
                {/* 快捷短语按钮 */}
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

                <button
                  className="queue-status-btn"
                  onClick={() => {
                    setQueueInput("");
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
                  {queue.length > 0 && (
                    <span className="queue-badge">{queue.length}</span>
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
                  KKCoder
                </span>
              ) : (
                <span>KKCoder 客户端就绪</span>
              )}
            </div>
          </div>
        </main>
      </div>

      {/* 新建会话终端弹窗组件 */}
      <NewSessionModal
        show={showModal}
        onClose={() => setShowModal(false)}
        selectedAgent={selectedAgent}
        onCreate={handleCreateSession}
      />

      {/* 设置中心弹窗组件 */}
      <SettingsModal
        show={showSettings}
        onClose={() => setShowSettings(false)}
      />

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
                <span>当前队列: {queue.length}/2</span>
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

      {/* 标签页右键悬浮菜单 */}
      {tabContextMenu && (
        <div
          className="context-menu"
          style={{
            top: tabContextMenu.y,
            left: tabContextMenu.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            className="context-menu-item"
            onClick={() => {
              const ev = { stopPropagation: () => {} } as React.MouseEvent;
              handleCloseTab(ev, tabContextMenu.sessionId);
              setTabContextMenu(null);
            }}
          >
            <span className="context-menu-icon">❌</span>
            关闭标签页
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              setOpenTabIds([tabContextMenu.sessionId]);
              setActiveSessionId(tabContextMenu.sessionId);
              setTabContextMenu(null);
            }}
          >
            <span className="context-menu-icon">🚫</span>
            关闭其他标签
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              setRenamingTabId(tabContextMenu.sessionId);
              const s = sessions.find((sess) => sess.id === tabContextMenu.sessionId);
              setRenamingTabText(s ? s.name : "");
              setTabContextMenu(null);
            }}
          >
            <span className="context-menu-icon">✏️</span>
            重命名会话
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              handleLocateSession(tabContextMenu.sessionId);
              setTabContextMenu(null);
            }}
          >
            <span className="context-menu-icon">🎯</span>
            在侧边栏中定位
          </button>
        </div>
      )}

      {/* 💾 极简化关闭行为确认弹窗 */}
      {showCloseConfirmModal && (
        <div className="modal-overlay show" style={{ zIndex: 1100 }}>
          <div className="modal-card select-confirm-modal" style={{ width: "420px" }}>
            <div className="modal-header">
              <span className="modal-title" style={{ fontSize: "15px", fontWeight: 700 }}>退出 KKCoder</span>
              <button className="modal-close" onClick={() => setShowCloseConfirmModal(false)}>✕</button>
            </div>
            <div className="modal-body" style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "10px 0" }}>
              <p style={{ fontSize: "13px", color: "var(--text-primary)", lineHeight: "1.6" }}>
                您想要直接退出应用，还是将它最小化到系统托盘？
              </p>
              <div className="settings-switch-row" style={{ marginTop: "4px", gap: "8px" }}>
                <label className="switch-container">
                  <input
                    type="checkbox"
                    checked={rememberCloseChoice}
                    onChange={(e) => setRememberCloseChoice(e.target.checked)}
                  />
                  <span className="switch-slider"></span>
                </label>
                <span className="switch-label" style={{ fontSize: "12.5px" }}>记住我的选择，下次不再询问</span>
              </div>
            </div>
            <div className="modal-footer" style={{ marginTop: "15px" }}>
              <button
                className="modal-btn modal-btn-cancel"
                onClick={() => setShowCloseConfirmModal(false)}
              >
                取消
              </button>
              <button
                className="modal-btn"
                style={{ backgroundColor: "var(--color-primary)", color: "#ffffff" }}
                onClick={() => {
                  if (rememberCloseChoice) {
                    localStorage.setItem("kkcoder_setting_close_behavior", "minimize");
                  }
                  setShowCloseConfirmModal(false);
                  appWindow.hide().catch((err) => log(`Failed to hide window: ${err}`));
                }}
              >
                最小化到托盘
              </button>
              <button
                className="modal-btn"
                style={{ backgroundColor: "#ef4444", color: "#ffffff" }}
                onClick={() => {
                  if (rememberCloseChoice) {
                    localStorage.setItem("kkcoder_setting_close_behavior", "exit");
                  }
                  setShowCloseConfirmModal(false);
                  appWindow.destroy().catch((err) => log(`Failed to destroy window: ${err}`));
                }}
              >
                直接退出
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
