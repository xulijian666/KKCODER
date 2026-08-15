import React, { useState, useEffect, useRef, useLayoutEffect, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmModal } from "./ConfirmModal";
import { SearchPalette } from "./SearchPalette";
import {
  formatRelativeSessionActivityTime,
  sortSessionsByActivityDesc,
} from "../utils/sessionActivity";
import {
  buildCmdResumeCommand,
  buildPowerShellResumeCommand,
} from "../utils/sessionResume";
import {
  type AgentType,
} from "../utils/enabledAgents";
import { formatFeedbackError, notifyError, notifySuccess } from "../utils/appFeedback";
import { useReturnTerminalFocusWhenUnblocked } from "../hooks/useReturnTerminalFocusWhenUnblocked";

export const ClaudeIcon: React.FC<{ size?: number; color?: string }> = ({ size = 18, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ color, display: "inline-block", verticalAlign: "middle" }}>
    <title>Claude</title>
    <path 
      d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" 
      fill="currentColor" 
      fillRule="nonzero"
    />
  </svg>
);

export interface Session {
  id: string;
  name: string;
  project: string;
  path: string;
  type: AgentType;
  agentSessionId: string;
  createdAt?: string; // 保存数据库创建时间戳
  lastUserMessageAt?: string;
  favorite: number;   // 0 代表普通，1 代表已收藏
  deleted?: number;   // 0 代表活动，1 代表已软删除
  deletedAt?: string; // 软删除时间戳
  isTemp?: boolean;
}

interface SidebarProps {
  onOpenNewSession: (prefilledPath?: string) => void;
  onCreateSessionDirectly?: (projectPath: string) => void;
  onOpenTempSession: () => void;
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  onDeleteSession: (e: React.MouseEvent | null, id: string) => void;
  openTabIds: string[]; // 用于判断该终端是否“加载到了右边”并点亮绿灯
  onRenameSession?: (id: string, newName: string) => void;
  onToggleFavorite?: (id: string, isFavorite: boolean) => void;
  highlightSessionId?: string | null;
  onHighlightEnd?: () => void;
  onDeleteSessionsBatch: (ids: string[]) => void; // 批量删除会话 callback
  glowingSessionIds?: string[];
  width?: number;
  sessionBusy?: Record<string, boolean>;
  /** 悬停浮出模式：侧栏作为覆盖层，不参与布局 */
  hoverMode?: boolean;
  /** 悬停模式下是否已展开 */
  revealed?: boolean;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  /** 切换固定分栏 / 悬停折叠模式 */
  onToggleSidebarMode?: () => void;
  /** 打开拓展全屏面板 */
  onOpenExtensions?: () => void;
}

const SidebarImpl: React.FC<SidebarProps> = ({
  onOpenNewSession,
  onCreateSessionDirectly,
  onOpenTempSession,
  sessions,
  activeSessionId,
  onSelectSession,
  onDeleteSession,
  openTabIds,
  onRenameSession,
  onToggleFavorite,
  highlightSessionId,
  onHighlightEnd,
  onDeleteSessionsBatch,
  glowingSessionIds = [],
  width,
  sessionBusy,
  hoverMode = false,
  revealed = false,
  onHoverEnter,
  onHoverLeave,
  onToggleSidebarMode,
  onOpenExtensions,
}) => {
  // 1. 折叠项目列表的状态
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([]);
  // 收藏夹折叠状态
  const [favoritesCollapsed, setFavoritesCollapsed] = useState<boolean>(false);
  const [confirmState, setConfirmState] = useState<{
    show: boolean;
    title: string;
    message: string | React.ReactNode;
    onConfirm: () => void;
    isDanger?: boolean;
  } | null>(null);

  useReturnTerminalFocusWhenUnblocked(!!confirmState, 56);

  // 记住收藏的项目状态
  const [favoriteProjects, setFavoriteProjects] = useState<Array<{ name: string; timestamp: number }>>(() => {
    try {
      const stored = localStorage.getItem("kkcoder_favorite_projects");
      return stored ? JSON.parse(stored) : [];
    } catch (e) {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("kkcoder_favorite_projects", JSON.stringify(favoriteProjects));
  }, [favoriteProjects]);

  // 项目按最近聊天时间自动排序（无需手动拖拽）

  // 会话搜索面板开关（仿 CC-GUI 命令面板：按钮唤起，Esc/点击遮罩关闭）
  const [searchPaletteOpen, setSearchPaletteOpen] = useState<boolean>(false);

  // 当 highlightSessionId 发生变化时，确保它隶属的项目文件夹处于展开状态
  useEffect(() => {
    if (highlightSessionId) {
      const session = sessions.find((s) => s.id === highlightSessionId);
      if (session) {
        setCollapsedProjects((prev) => prev.filter((p) => p !== session.project));
      }
    }
  }, [highlightSessionId, sessions]);

  // 2. 行内编辑会话名称状态
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState<string>("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // 3. 右键自定义上下文菜单状态
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    session: Session;
  } | null>(null);
  const [resumeSubmenuOpen, setResumeSubmenuOpen] = useState(false);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // 3b. 项目右键上下文菜单状态
  const [projectContextMenu, setProjectContextMenu] = useState<{
    x: number;
    y: number;
    projectName: string;
    projectPath: string;
    sessionCount: number;
    isFavorited: boolean;
  } | null>(null);
  const projectContextMenuRef = useRef<HTMLDivElement>(null);

  // 3x. 右键菜单智能定位：超出视口时向上展开
  useLayoutEffect(() => {
    if (contextMenu && contextMenuRef.current) {
      const menu = contextMenuRef.current;
      const rect = menu.getBoundingClientRect();
      const padding = 8;
      let { x, y } = contextMenu;
      // 水平方向：超出右边界则左移
      if (x + rect.width > window.innerWidth - padding) {
        x = window.innerWidth - rect.width - padding;
      }
      // 垂直方向：超出底部则向上展开
      if (y + rect.height > window.innerHeight - padding) {
        y = y - rect.height;
        if (y < padding) y = padding;
      }
      if (x !== contextMenu.x || y !== contextMenu.y) {
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
      }
    }
  }, [contextMenu]);

  useLayoutEffect(() => {
    if (projectContextMenu && projectContextMenuRef.current) {
      const menu = projectContextMenuRef.current;
      const rect = menu.getBoundingClientRect();
      const padding = 8;
      let { x, y } = projectContextMenu;
      if (x + rect.width > window.innerWidth - padding) {
        x = window.innerWidth - rect.width - padding;
      }
      if (y + rect.height > window.innerHeight - padding) {
        y = y - rect.height;
        if (y < padding) y = padding;
      }
      if (x !== projectContextMenu.x || y !== projectContextMenu.y) {
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;
      }
    }
  }, [projectContextMenu]);

  // 3c. 项目删除确认弹窗状态
  const [projectToDelete, setProjectToDelete] = useState<{
    projectName: string;
    sessionIds: string[];
  } | null>(null);

  // 点击外部自动关闭右键菜单
  useEffect(() => {
    const closeMenu = () => {
      setContextMenu(null);
      setProjectContextMenu(null);
      setResumeSubmenuOpen(false);
    };
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  // 监听关闭侧边栏右键菜单的事件（由标签页触发）
  useEffect(() => {
    const handleCloseSidebarContextMenu = () => {
      setContextMenu(null);
      setProjectContextMenu(null);
      setResumeSubmenuOpen(false);
    };
    window.addEventListener("close-sidebar-context-menu", handleCloseSidebarContextMenu);
    return () => window.removeEventListener("close-sidebar-context-menu", handleCloseSidebarContextMenu);
  }, []);

  useEffect(() => {
    if (!contextMenu) {
      setResumeSubmenuOpen(false);
    }
  }, [contextMenu]);

  // 监听 ESC 键关闭移除确认弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProjectToDelete(null);
      }
    };
    if (projectToDelete) {
      window.addEventListener("keydown", handleKeyDown, true);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [projectToDelete]);

  // 监听 ESC 键关闭自定义确认弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setConfirmState(null);
      }
    };
    if (confirmState) {
      window.addEventListener("keydown", handleKeyDown, true);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [confirmState]);

  // 当进入编辑状态时，自动获得焦点并选中文本
  useEffect(() => {
    if (editingSessionId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingSessionId]);

  const toggleProject = (projectName: string) => {
    setCollapsedProjects((prev) =>
      prev.includes(projectName)
        ? prev.filter((p) => p !== projectName)
        : [...prev, projectName]
    );
  };

  // 收藏/取消收藏整个项目
  const handleToggleFavoriteProject = (projectName: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setFavoriteProjects((prev) => {
      const exists = prev.some((p) => p.name === projectName);
      if (exists) {
        return prev.filter((p) => p.name !== projectName);
      } else {
        return [{ name: projectName, timestamp: Date.now() }, ...prev];
      }
    });
  };

  // 触发项目右键菜单
  const handleProjectContextMenu = (
    e: React.MouseEvent,
    projectName: string,
    projectPath: string,
    sessionsList: Session[],
    isFavorited: boolean
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu(null); // 关闭会话右键菜单
    setProjectContextMenu({
      x: e.clientX,
      y: e.clientY,
      projectName,
      projectPath,
      sessionCount: sessionsList.length,
      isFavorited,
    });
    // 触发事件关闭标签页右键菜单
    window.dispatchEvent(new CustomEvent("close-tab-context-menu"));
  };

  // 在文件管理器中物理打开项目路径
  const handleOpenProjectInExplorer = async (path: string) => {
    try {
      await invoke("open_project_folder", { path });
    } catch (err) {
      notifyError(`无法打开文件夹：${formatFeedbackError(err)}`);
    }
  };

  // 4. 根据项目名称动态归类会话列表
  const projectsMap: { [key: string]: { path: string; sessions: Session[] } } = {};
  
  const filteredSessions = sessions.filter((s) => s.type === "claude" && s.deleted !== 1 && !s.isTemp);

  filteredSessions.forEach((s) => {
    if (!projectsMap[s.project]) {
      projectsMap[s.project] = { path: s.path, sessions: [] };
    }
    projectsMap[s.project].sessions.push(s);
  });

  Object.values(projectsMap).forEach((project) => {
    project.sessions = sortSessionsByActivityDesc(project.sessions);
  });

  // 提取收藏的会话
  const favoriteSessions = sortSessionsByActivityDesc(
    filteredSessions.filter((s) => s.favorite === 1),
  );

  // 按照收藏时间置顶项目，后收藏的在前面
  const projectNames = Object.keys(projectsMap);
  const favProjNames = favoriteProjects
    .filter((fp) => projectNames.includes(fp.name))
    .map((fp) => fp.name);
  const regularProjNames = projectNames.filter((name) => !favProjNames.includes(name));

  // 按项目内最近一条会话的聊天时间降序排序（最新的排最上面）
  const regularSortedProjNames = useMemo(() => {
    return [...regularProjNames].sort((left, right) => {
      const leftSessions = projectsMap[left]?.sessions || [];
      const rightSessions = projectsMap[right]?.sessions || [];
      // 取每个项目中 lastUserMessageAt 的最大值（最新活动时间）
      const leftLatest = leftSessions.length > 0
        ? Math.max(...leftSessions.map((s) => new Date(s.lastUserMessageAt || s.createdAt || 0).getTime()))
        : 0;
      const rightLatest = rightSessions.length > 0
        ? Math.max(...rightSessions.map((s) => new Date(s.lastUserMessageAt || s.createdAt || 0).getTime()))
        : 0;
      return rightLatest - leftLatest; // 降序：最新的在前
    });
  }, [projectsMap, regularProjNames]);

  const sortedProjectNames = [...favProjNames, ...regularSortedProjNames];

  // --- 每个项目分组最多显示 5 个会话，超出折叠，点击分组内「更多...」展开 ---
  const MAX_SESSIONS_PER_GROUP = 5;
  const FAVORITES_GROUP_KEY = "__favorites__";
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const toggleGroupExpand = (key: string) =>
    setExpandedGroups((prev) => ({ ...prev, [key]: !prev[key] }));
  // 收藏分组与各项目分组：折叠时只显示前 5 个（列表已按活动时间降序）
  const visibleFavoriteSessions =
    expandedGroups[FAVORITES_GROUP_KEY] || favoriteSessions.length <= MAX_SESSIONS_PER_GROUP
      ? favoriteSessions
      : favoriteSessions.slice(0, MAX_SESSIONS_PER_GROUP);
  const favoriteHiddenCount = favoriteSessions.length - visibleFavoriteSessions.length;
  const visibleSessionsOf = (projSessions: Session[], projName: string) =>
    expandedGroups[projName] || projSessions.length <= MAX_SESSIONS_PER_GROUP
      ? projSessions
      : projSessions.slice(0, MAX_SESSIONS_PER_GROUP);
  const hiddenCountOf = (projSessions: Session[]) =>
    Math.max(0, projSessions.length - MAX_SESSIONS_PER_GROUP);

  // 6. 行内编辑操作
  const startEditing = (session: Session) => {
    setEditingSessionId(session.id);
    setEditingText(session.name);
  };

  const handleSaveEdit = (id: string) => {
    if (editingText.trim() && onRenameSession) {
      onRenameSession(id, editingText.trim());
    }
    setEditingSessionId(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === "Enter") {
      handleSaveEdit(id);
    } else if (e.key === "Escape") {
      setEditingSessionId(null);
    }
  };

  // 7. 处理右键点击
  const handleItemContextMenu = (e: React.MouseEvent, session: Session) => {
    e.preventDefault();
    e.stopPropagation();
    setProjectContextMenu(null); // 关闭项目右键菜单
    setResumeSubmenuOpen(false);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      session,
    });
    // 触发事件关闭标签页右键菜单
    window.dispatchEvent(new CustomEvent("close-tab-context-menu"));
  };

  const copyResumeCommand = (shell: "cmd" | "powershell") => {
    if (!contextMenu) return;
    const { path, agentSessionId } = contextMenu.session;
    const command =
      shell === "cmd"
        ? buildCmdResumeCommand(path, agentSessionId)
        : buildPowerShellResumeCommand(path, agentSessionId);
    navigator.clipboard.writeText(command).catch(() => {});
    setResumeSubmenuOpen(false);
    setContextMenu(null);
  };

  // 8. 统一会话行渲染函数 (复用在置顶收藏组和常规项目树中)
  const renderSessionRow = (session: Session) => {
    const isActive = activeSessionId === session.id;
    const isLoaded = openTabIds.includes(session.id); // 是否加载到了右边
    const isEditing = editingSessionId === session.id;
    const isHighlighted = highlightSessionId === session.id;
    const isGlowing = glowingSessionIds.includes(session.id);
    const isBusy = sessionBusy && sessionBusy[session.id];

    return (
      <li
        key={session.id}
        className={`session-item ${isActive ? "active" : ""} ${isHighlighted ? "highlight-flash" : ""}`}
        onClick={() => onSelectSession(session.id)}
        onDoubleClick={() => startEditing(session)}
        onContextMenu={(e) => handleItemContextMenu(e, session)}
        onAnimationEnd={() => {
          if (isHighlighted && onHighlightEnd) {
            onHighlightEnd();
          }
        }}
      >
        <div className="session-content">
          {/* 状态指示器：回答完成且非活动时展示黄色点提醒，否则：加载到右侧点亮(亮绿)，休眠状态(淡灰绿) */}
          <span 
            className={`status-indicator-dot ${isBusy ? "busy-pulse" : (isGlowing ? "glowing-yellow" : (isLoaded ? "lit" : "faded"))}`} 
            title={isBusy ? "正在思考..." : (isGlowing ? "回答完毕" : (isLoaded ? "会话处于活动状态" : "会话处于休眠状态"))}
          />
          
          {/* 橙色收藏小星星 (如果是收藏会话) */}
          {session.favorite === 1 && (
            <span className="favorite-star-badge" title="置顶收藏会话">⭐</span>
          )}

          {isEditing ? (
            <input
              ref={editInputRef}
              type="text"
              className="session-rename-input"
              value={editingText}
              onChange={(e) => setEditingText(e.target.value)}
              onBlur={() => handleSaveEdit(session.id)}
              onKeyDown={(e) => handleKeyDown(e, session.id)}
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", flex: 1, minWidth: 0 }}>
              <span 
                className={`session-name-text ${isGlowing ? "glowing-text" : ""}`}
                style={{ 
                  textOverflow: "ellipsis", 
                  overflow: "hidden", 
                  whiteSpace: "nowrap",
                  fontSize: "12.5px"
                }}
              >
                {session.name}
              </span>
            </div>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* 时间标签 (如 2分钟) */}
          <span className="session-time-tag">
            {formatRelativeSessionActivityTime(session)}
          </span>
          
          {/* 删除按钮 */}
          <button
            className="session-delete-btn"
            onClick={(e) => onDeleteSession(e, session.id)}
            title="永久删除此会话记录"
          >
            ×
          </button>
        </div>
      </li>
    );
  };

  const isFavoritesExist = favoriteSessions.length > 0;
  const isAllProjectsCollapsed = sortedProjectNames.every((p) => collapsedProjects.includes(p));
  const isFavoritesCollapsed = isFavoritesExist ? favoritesCollapsed : true;
  const allCollapsed = isAllProjectsCollapsed && isFavoritesCollapsed;

  const toggleCollapseAll = () => {
    if (sortedProjectNames.length === 0 && favoriteSessions.length === 0) return;
    
    if (allCollapsed) {
      // 展开全部
      setCollapsedProjects([]);
      if (isFavoritesExist) {
        setFavoritesCollapsed(false);
      }
    } else {
      // 收起全部
      setCollapsedProjects(sortedProjectNames);
      if (isFavoritesExist) {
        setFavoritesCollapsed(true);
      }
    }
  };

  return (
    <aside
      className={`sidebar-aside ${hoverMode ? "sidebar-floating" : ""} ${revealed ? "is-revealed" : ""}`}
      style={width !== undefined ? { width: `${width}px` } : undefined}
      onMouseEnter={hoverMode ? onHoverEnter : undefined}
      onMouseLeave={hoverMode ? onHoverLeave : undefined}
    >
      {/* 新建 AI 会话头部区域 */}
      <div className="sidebar-header">
        {/* 搜索 / 拓展入口（仿 CC-GUI：按钮唤起面板） */}
        <div className="sidebar-tool-row">
          <button
            className="sidebar-search-btn"
            onClick={() => setSearchPaletteOpen(true)}
            title="搜索会话与聊天记录（名称 / 项目 / 路径 / 消息内容）"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
            <span>搜索会话</span>
          </button>
          <button
            className="sidebar-search-btn sidebar-ext-btn"
            onClick={onOpenExtensions}
            title="拓展：使用统计（TokenTracker）与框架管理"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="3" width="7" height="7" rx="1.5"></rect>
              <rect x="14" y="3" width="7" height="7" rx="1.5"></rect>
              <rect x="3" y="14" width="7" height="7" rx="1.5"></rect>
              <rect x="14" y="14" width="7" height="7" rx="1.5"></rect>
            </svg>
            <span>拓展</span>
          </button>
        </div>

        {/* 新建会话按钮、临时终端按钮、折叠侧栏按钮 */}
        <div className="new-session-row" style={{ display: "flex", gap: "6px", width: "100%", marginBottom: "12px" }}>
          <button
            className="new-session-btn"
            style={{ flex: 1, margin: 0 }}
            onClick={() => onOpenNewSession()}
          >
            + 新建会话
          </button>
          <button
            className="sidebar-action-btn bot-btn"
            onClick={onOpenTempSession}
            title="新建无痕临时终端"
            style={{
              width: "28px",
              height: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              backgroundColor: "var(--bg-active-item)",
              border: "1px solid var(--border-color)",
              borderRadius: "4px",
              color: "var(--text-secondary)",
              cursor: "pointer",
              transition: "var(--transition-smooth)",
              padding: 0,
              boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="10" rx="2"></rect>
              <circle cx="12" cy="5" r="2"></circle>
              <path d="M12 7v4M8 15h.01M16 15h.01"></path>
            </svg>
          </button>
          {onToggleSidebarMode && (
            <button
              className="sidebar-action-btn toggle-sidebar-btn"
              onClick={onToggleSidebarMode}
              title={hoverMode ? "侧栏悬停浮出中 · 点击固定为分栏" : "收起侧边栏（切换为悬停模式）"}
              style={{
                width: "28px",
                height: "28px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "var(--bg-active-item)",
                border: "1px solid var(--border-color)",
                borderRadius: "4px",
                color: "var(--text-secondary)",
                cursor: "pointer",
                transition: "var(--transition-smooth)",
                padding: 0,
                boxShadow: "0 1px 3px rgba(0,0,0,0.05)"
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
                <line x1="9" y1="3" x2="9" y2="21"></line>
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* 滚动会话树列表 */}
      <div className="sidebar-scroll">
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingRight: "12px", marginBottom: "8px" }}>
          <div className="section-title" style={{ marginBottom: 0 }}>会话管理</div>
          <button 
            className="collapse-all-btn"
            onClick={toggleCollapseAll}
            disabled={sortedProjectNames.length === 0 && favoriteSessions.length === 0}
            title={allCollapsed ? "展开全部" : "收起全部"}
            style={{
              background: "none",
              border: "none",
              color: "var(--text-secondary)",
              cursor: (sortedProjectNames.length === 0 && favoriteSessions.length === 0) ? "not-allowed" : "pointer",
              padding: "2px 4px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: "var(--radius-sm)",
              transition: "var(--transition-smooth)",
              opacity: (sortedProjectNames.length === 0 && favoriteSessions.length === 0) ? 0.3 : 1,
            }}
            onMouseEnter={(e) => {
              if (sortedProjectNames.length > 0 || favoriteSessions.length > 0) {
                e.currentTarget.style.color = "var(--text-primary)";
                e.currentTarget.style.backgroundColor = "var(--bg-hover-item)";
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = "var(--text-secondary)";
              e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            {allCollapsed ? (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m7 13 5 5 5-5"/>
                <path d="m7 6 5 5 5-5"/>
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m17 11-5-5-5 5"/>
                <path d="m17 18-5-5-5 5"/>
              </svg>
            )}
          </button>
        </div>

        {/* 置顶 “⭐ 收藏” 分组 (如果有被收藏的会话) */}
        {visibleFavoriteSessions.length > 0 && (
          <div className="project-group favorite-group-wrapper" style={{ marginBottom: "12px" }}>
            <div 
              className="project-header favorite-group-header" 
              onClick={() => setFavoritesCollapsed(!favoritesCollapsed)}
              style={{ cursor: "pointer", userSelect: "none" }}
            >
              <div className="project-title favorite-group-title">
                <span className="project-chevron" style={{ transform: favoritesCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                  ▼
                </span>
                <span style={{ color: "var(--color-orange)", fontWeight: 700 }}>★ 收藏</span>
              </div>
              <span className="project-session-count" style={{ backgroundColor: "var(--color-orange-light)", color: "var(--color-orange)" }}>
                {favoriteSessions.length}
              </span>
            </div>
            
            {!favoritesCollapsed && (
              <ul className="session-list" style={{ padding: "2px" }}>
                {visibleFavoriteSessions.map((session) => renderSessionRow(session))}
              </ul>
            )}
            {favoriteHiddenCount > 0 && (
              <button
                type="button"
                className="sidebar-more-sessions-btn"
                onClick={() => toggleGroupExpand(FAVORITES_GROUP_KEY)}
                title={expandedGroups[FAVORITES_GROUP_KEY] ? "收起为前 5 个" : `展开全部 ${favoriteSessions.length} 个收藏会话`}
              >
                {expandedGroups[FAVORITES_GROUP_KEY] ? "收起" : `更多 (${favoriteHiddenCount})...`}
              </button>
            )}
            <div className="favorite-divider" style={{ borderBottom: "1px dashed var(--border-color)", margin: "8px 4px 4px 4px" }} />
          </div>
        )}

        {/* 常规项目与会话树 */}
        {sortedProjectNames.length === 0 ? (
          <div style={{ padding: "20px 8px", fontSize: "12px", color: "var(--text-secondary)", textAlign: "center" }}>
            暂无活动会话
          </div>
        ) : (
          sortedProjectNames.map((projName) => {
            const proj = projectsMap[projName];
            if (!proj) return null;
            const isCollapsed = collapsedProjects.includes(projName);
            const isProjectFavorited = favoriteProjects.some((fp) => fp.name === projName);
            const visibleSessions = visibleSessionsOf(proj.sessions, projName);
            const hiddenCount = hiddenCountOf(proj.sessions);
            return (
              <div
                key={projName}
                data-project-name={projName}
                className="project-group"
              >
                {/* 项目层级标题 */}
                <div
                  className="project-header"
                  onClick={() => toggleProject(projName)}
                  onContextMenu={(e) => handleProjectContextMenu(e, projName, proj.path, proj.sessions, isProjectFavorited)}
                  style={{ cursor: "pointer", userSelect: "none" }}
                >
                  <div className="project-title">
                    <span className="project-chevron" style={{ transform: isCollapsed ? "rotate(-90deg)" : "rotate(0deg)" }}>
                      ▼
                    </span>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                      <span 
                        onClick={(e) => {
                          e.stopPropagation();
                          handleToggleFavoriteProject(projName, e);
                        }}
                        className="project-folder-toggle"
                        style={{ display: "inline-flex", alignItems: "center", cursor: "pointer" }}
                        title={isProjectFavorited ? "取消收藏" : "收藏项目"}
                      >
                        <svg
                          className="folder-svg-icon"
                          xmlns="http://www.w3.org/2000/svg"
                          width="13"
                          height="13"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke={isProjectFavorited ? "var(--color-primary)" : "var(--text-secondary)"}
                          strokeWidth="2.0"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          style={{ opacity: 0.95, transition: "stroke 0.15s ease" }}
                        >
                          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
                        </svg>
                      </span>
                      <span>{projName}</span>
                    </span>
                    {isProjectFavorited && (
                      <span className="project-star-badge" style={{ color: "#f59e0b", marginLeft: "4px" }}>★</span>
                    )}
                  </div>
                </div>
                
                {/* 会话列表（每个项目最多显示 5 个，超出折叠） */}
                {!isCollapsed && (
                  <ul className="session-list" style={{ padding: "2px" }}>
                    {visibleSessions.map((session) => renderSessionRow(session))}
                  </ul>
                )}
                {!isCollapsed && hiddenCount > 0 && (
                  <button
                    type="button"
                    className="sidebar-more-sessions-btn"
                    onClick={() => toggleGroupExpand(projName)}
                    title={expandedGroups[projName] ? "收起为前 5 个" : `展开全部 ${proj.sessions.length} 个会话`}
                  >
                    {expandedGroups[projName] ? "收起" : `更多 (${hiddenCount})...`}
                  </button>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 9. 自定义高档白天右键上下文悬浮菜单 */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="context-menu"
          style={{
            top: contextMenu.y,
            left: contextMenu.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            className="context-menu-item"
            onClick={() => {
              if (onToggleFavorite) {
                onToggleFavorite(contextMenu.session.id, contextMenu.session.favorite !== 1);
              }
              setContextMenu(null);
            }}
          >
            {contextMenu.session.favorite === 1 ? "取消收藏" : "收藏"}
          </button>
          
          <div className="context-menu-divider" style={{ height: "1px", backgroundColor: "var(--border-color)", margin: "4px 0" }}></div>

          <button 
            className="context-menu-item"
            onClick={() => {
              startEditing(contextMenu.session);
              setContextMenu(null);
            }}
          >
            重命名
          </button>

          <div className="context-menu-divider" style={{ height: "1px", backgroundColor: "var(--border-color)", margin: "4px 0" }}></div>

          <button
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.session.agentSessionId).catch(() => {});
              setContextMenu(null);
            }}
          >
            复制 Session ID
          </button>
          {contextMenu.session.type === "claude" && (
            <div
              className={`context-menu-submenu-trigger${resumeSubmenuOpen ? " open" : ""}`}
              onMouseEnter={() => setResumeSubmenuOpen(true)}
              onMouseLeave={() => setResumeSubmenuOpen(false)}
              onClick={(e) => {
                e.stopPropagation();
                setResumeSubmenuOpen((open) => !open);
              }}
            >
              <button className="context-menu-item context-menu-submenu-button" type="button">
                <span>复制恢复命令</span>
                <span className="context-menu-submenu-arrow">›</span>
              </button>
              {resumeSubmenuOpen && (
                <div
                  className="context-menu context-menu-submenu"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="context-menu-item"
                    type="button"
                    onClick={() => copyResumeCommand("cmd")}
                  >
                    CMD
                  </button>
                  <button
                    className="context-menu-item"
                    type="button"
                    onClick={() => copyResumeCommand("powershell")}
                  >
                    PowerShell
                  </button>
                </div>
              )}
            </div>
          )}
          <button
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(contextMenu.session.path).catch(() => {});
              setContextMenu(null);
            }}
          >
            复制项目路径
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              invoke("open_project_folder", { path: contextMenu.session.path }).catch(() => {});
              setContextMenu(null);
            }}
          >
            在文件管理器中打开
          </button>

          <button
            className="context-menu-item"
            style={{ color: "#ef4444" }}
            onClick={() => {
              onDeleteSession(null, contextMenu.session.id);
              setContextMenu(null);
            }}
          >
            删除
          </button>
        </div>
      )}

      {/* 项目右键上下文悬浮菜单 */}
      {projectContextMenu && (
        <div
          ref={projectContextMenuRef}
          className="context-menu"
          style={{
            top: projectContextMenu.y,
            left: projectContextMenu.x,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            className="context-menu-item"
            onClick={() => {
              if (onCreateSessionDirectly) {
                onCreateSessionDirectly(projectContextMenu.projectPath);
              } else {
                onOpenNewSession(projectContextMenu.projectPath);
              }
              setProjectContextMenu(null);
            }}
          >
            新建会话
          </button>
          <div style={{ borderBottom: "1px dashed var(--border-color)", margin: "4px 6px" }} />
          <button 
            className="context-menu-item"
            onClick={(e) => {
              handleToggleFavoriteProject(projectContextMenu.projectName, e);
              setProjectContextMenu(null);
            }}
          >
            {projectContextMenu.isFavorited ? "取消收藏项目" : "收藏项目"}
          </button>
          <button 
            className="context-menu-item"
            onClick={() => {
              handleOpenProjectInExplorer(projectContextMenu.projectPath);
              setProjectContextMenu(null);
            }}
          >
            在文件管理器中打开
          </button>
          <button 
            className="context-menu-item"
            onClick={() => {
              navigator.clipboard.writeText(projectContextMenu.projectPath).then(() => {
                notifySuccess("路径已复制");
              }).catch(() => {
                notifyError("复制路径失败");
              });
              setProjectContextMenu(null);
            }}
          >
            复制路径
          </button>
          <div style={{ borderBottom: "1px dashed var(--border-color)", margin: "4px 6px" }} />
          <button 
            className="context-menu-item"
            style={{ color: "#ef4444" }}
            onClick={() => {
              const proj = projectsMap[projectContextMenu.projectName];
              if (proj) {
                const ids = proj.sessions.map((s) => s.id);
                setProjectToDelete({
                  projectName: projectContextMenu.projectName,
                  sessionIds: ids,
                });
              }
              setProjectContextMenu(null);
            }}
          >
            移除整个目录
          </button>
        </div>
      )}

      {/* 移除目录确认弹窗 */}
      {projectToDelete && (
        <div className="modal-overlay show" onClick={() => setProjectToDelete(null)}>
          <div className="modal-card" style={{ maxWidth: "420px" }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <span className="modal-title">移除整个目录</span>
              <button className="modal-close" onClick={() => setProjectToDelete(null)}>×</button>
            </div>
            
            <div style={{ fontSize: "13.5px", lineHeight: "1.6", color: "var(--text-primary)" }}>
              确定要移除该目录「<strong style={{ color: "var(--color-orange)" }}>{projectToDelete.projectName}</strong>」下的 <strong style={{ color: "var(--color-orange)", fontSize: "14.5px" }}>{projectToDelete.sessionIds.length}</strong> 个会话吗？
              <br />
              <span style={{ fontSize: "12px", color: "var(--text-secondary)", display: "inline-block", marginTop: "10px" }}>
                ⚠️ 此操作仅删除应用中的会话记录，不会删除磁盘上的原始文件。
              </span>
            </div>
            
            <div className="modal-footer">
              <button className="modal-btn modal-btn-cancel" onClick={() => setProjectToDelete(null)}>
                取消
              </button>
              <button 
                className="modal-btn modal-btn-create" 
                style={{ backgroundColor: "#ef4444", color: "#fff", boxShadow: "0 2px 4px rgba(239, 68, 68, 0.2)" }}
                onClick={() => {
                  onDeleteSessionsBatch(projectToDelete.sessionIds);
                  setProjectToDelete(null);
                }}
              >
                移除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 会话搜索面板（仿 CC-GUI 命令面板） */}
      <SearchPalette
        isOpen={searchPaletteOpen}
        sessions={sessions}
        activeSessionId={activeSessionId}
        onSelectSession={(id) => {
          onSelectSession(id);
          setSearchPaletteOpen(false);
        }}
        onClose={() => setSearchPaletteOpen(false)}
      />
      {confirmState && (
        <ConfirmModal
          show={confirmState.show}
          title={confirmState.title}
          message={confirmState.message}
          isDanger={confirmState.isDanger}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </aside>
  );
};

// 父级回调已在 App 层 useCallback 稳定化：sessions/activeSessionId 等数据不变时，
// 跳过整棵会话列表树的重渲染（hover 等高频状态不再波及侧边栏）。
export const Sidebar = React.memo(SidebarImpl);
