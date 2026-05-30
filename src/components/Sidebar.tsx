import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

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

export const PiIcon: React.FC<{ size?: number; color?: string }> = ({ size = 18, color }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ color, display: "inline-block", verticalAlign: "middle" }}>
    <path d="M5 6h14" />
    <path d="M9 6v12M15 6v11a2 2 0 0 0 2 2" />
  </svg>
);

export interface Session {
  id: string;
  name: string;
  project: string;
  path: string;
  type: "claude" | "pi";
  agentSessionId: string;
  createdAt?: string; // 保存数据库创建时间戳
  favorite: number;   // 0 代表普通，1 代表已收藏
}

interface SidebarProps {
  selectedAgent: "claude" | "pi";
  onSelectAgent: (agent: "claude" | "pi") => void;
  onOpenNewSession: () => void;
  sessions: Session[];
  activeSessionId: string;
  onSelectSession: (id: string) => void;
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  onDeleteSession: (e: React.MouseEvent, id: string) => void;
  openTabIds: string[]; // 用于判断该终端是否“加载到了右侧”并点亮绿灯
  onRenameSession?: (id: string, newName: string) => void;
  onToggleFavorite?: (id: string, isFavorite: boolean) => void;
  highlightSessionId?: string | null;
  onHighlightEnd?: () => void;
  onDeleteSessionsBatch: (ids: string[]) => void; // 批量删除会话 callback
}

export const Sidebar: React.FC<SidebarProps> = ({
  selectedAgent,
  onSelectAgent,
  onOpenNewSession,
  sessions,
  activeSessionId,
  onSelectSession,
  searchQuery,
  onSearchQueryChange,
  onDeleteSession,
  openTabIds,
  onRenameSession,
  onToggleFavorite,
  highlightSessionId,
  onHighlightEnd,
  onDeleteSessionsBatch,
}) => {
  // 1. 折叠项目列表的状态
  const [collapsedProjects, setCollapsedProjects] = useState<string[]>([]);
  // 收藏夹折叠状态
  const [favoritesCollapsed, setFavoritesCollapsed] = useState<boolean>(false);

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

  // 3b. 项目右键上下文菜单状态
  const [projectContextMenu, setProjectContextMenu] = useState<{
    x: number;
    y: number;
    projectName: string;
    projectPath: string;
    sessionCount: number;
    isFavorited: boolean;
  } | null>(null);

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
    };
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  // 监听 ESC 键关闭移除确认弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setProjectToDelete(null);
      }
    };
    if (projectToDelete) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [projectToDelete]);

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
    setProjectContextMenu({
      x: e.clientX,
      y: e.clientY,
      projectName,
      projectPath,
      sessionCount: sessionsList.length,
      isFavorited,
    });
  };

  // 在文件管理器中物理打开项目路径
  const handleOpenProjectInExplorer = async (path: string) => {
    try {
      await invoke("open_project_folder", { path });
    } catch (err) {
      alert(`无法打开文件夹: ${err}`);
    }
  };

  // 4. 根据项目名称动态归类会话列表
  const projectsMap: { [key: string]: { path: string; sessions: Session[] } } = {};
  
  const filteredSessions = sessions.filter((s) => s.type === selectedAgent);

  filteredSessions.forEach((s) => {
    const matchesSearch =
      s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.project.toLowerCase().includes(searchQuery.toLowerCase()) ||
      s.path.toLowerCase().includes(searchQuery.toLowerCase());

    if (matchesSearch) {
      if (!projectsMap[s.project]) {
        projectsMap[s.project] = { path: s.path, sessions: [] };
      }
      projectsMap[s.project].sessions.push(s);
    }
  });

  // 提取收藏的会话
  const favoriteSessions = filteredSessions.filter((s) => s.favorite === 1 && (
    s.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.project.toLowerCase().includes(searchQuery.toLowerCase()) ||
    s.path.toLowerCase().includes(searchQuery.toLowerCase())
  ));

  // 按照收藏时间置顶项目，后收藏的在前面
  const projectNames = Object.keys(projectsMap);
  const favProjNames = favoriteProjects
    .filter((fp) => projectNames.includes(fp.name))
    .map((fp) => fp.name);
  const regularProjNames = projectNames.filter((name) => !favProjNames.includes(name));
  const sortedProjectNames = [...favProjNames, ...regularProjNames];

  // 5. 将 SQLite 写入的 UTC 时间戳转换为对用户友好的相对时间 (如 "2分钟前", "4小时前", "3天前")
  const formatRelativeTime = (createdAt?: string) => {
    if (!createdAt) return "刚刚";
    try {
      const formattedUtc = createdAt.replace(" ", "T") + "Z";
      const createdDate = new Date(formattedUtc);
      const now = new Date();
      
      const diffMs = now.getTime() - createdDate.getTime();
      const diffMins = Math.floor(diffMs / 60000);
      
      if (diffMins < 1) return "刚刚";
      if (diffMins < 60) return `${diffMins}分钟前`;
      
      const diffHours = Math.floor(diffMins / 60);
      if (diffHours < 24) return `${diffHours}小时前`;
      
      const diffDays = Math.floor(diffHours / 24);
      return `${diffDays}天前`;
    } catch (e) {
      return "刚刚";
    }
  };

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
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      session,
    });
  };

  // 8. 统一会话行渲染函数 (复用在置顶收藏组和常规项目树中)
  const renderSessionRow = (session: Session) => {
    const isActive = activeSessionId === session.id;
    const isLoaded = openTabIds.includes(session.id); // 是否加载到了右边
    const isEditing = editingSessionId === session.id;
    const isHighlighted = highlightSessionId === session.id;

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
          {/* 绿灯指示器：加载到右侧点亮(亮绿)，否则熄灭(淡灰绿) */}
          <span 
            className={`status-indicator-dot ${isLoaded ? "lit" : "faded"}`} 
            title={isLoaded ? "会话处于活动状态" : "会话处于休眠状态"}
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
            <span 
              className="session-name-text"
              style={{ 
                textOverflow: "ellipsis", 
                overflow: "hidden", 
                whiteSpace: "nowrap",
                fontSize: "12.5px"
              }}
            >
              {session.name}
            </span>
          )}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
          {/* 时间标签 (如 2分钟前) */}
          <span className="session-time-tag">
            {formatRelativeTime(session.createdAt)}
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

  return (
    <aside className="sidebar-aside">
      {/* 新建 AI 会话头部区域 */}
      <div className="sidebar-header">
        {/* Agent 选卡切换 */}
        <div className="agent-selector">
          <div className={`agent-selector-slider ${selectedAgent}`} />
          <button
            className={`agent-tab ${selectedAgent === "claude" ? "active claude-style" : ""}`}
            onClick={() => onSelectAgent("claude")}
            title="Claude Code"
          >
            <ClaudeIcon size={18} color={selectedAgent === "claude" ? "#D97757" : "var(--text-secondary)"} />
          </button>
          <button
            className={`agent-tab ${selectedAgent === "pi" ? "active pi-style" : ""}`}
            onClick={() => onSelectAgent("pi")}
            title="Pi"
          >
            <PiIcon size={18} color={selectedAgent === "pi" ? "var(--color-green)" : "var(--text-secondary)"} />
          </button>
        </div>
        
        {/* 新建 AI 终端按钮 */}
        <button
          className="new-session-btn"
          onClick={onOpenNewSession}
        >
          +新建终端
        </button>

        {/* 快速搜索框 */}
        <div className="search-container">
          <svg
            className="search-icon"
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input
            type="text"
            className={`search-input ${selectedAgent === "pi" ? "pi-focus" : ""}`}
            placeholder="搜索本地会话项目..."
            value={searchQuery}
            onChange={(e) => onSearchQueryChange(e.target.value)}
          />
        </div>
      </div>

      {/* 滚动会话树列表 */}
      <div className="sidebar-scroll">
        <div className="section-title">会话管理</div>

        {/* 置顶 “⭐ 收藏” 分组 (如果有被收藏的会话) */}
        {favoriteSessions.length > 0 && (
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
                {favoriteSessions.map((session) => renderSessionRow(session))}
              </ul>
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
            return (
              <div key={projName} className="project-group">
                {/* 📂 项目层级标题 */}
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
                    <span>📂 {projName}</span>
                    {isProjectFavorited && (
                      <span className="project-star-badge" style={{ color: "#f59e0b", marginLeft: "4px" }}>★</span>
                    )}
                  </div>
                  
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }} onClick={(e) => e.stopPropagation()}>
                    <div className="project-actions">
                      <button
                        className={`project-star-btn ${isProjectFavorited ? "active" : ""}`}
                        onClick={(e) => handleToggleFavoriteProject(projName, e)}
                        title={isProjectFavorited ? "取消收藏项目" : "收藏项目"}
                      >
                        {isProjectFavorited ? "★" : "☆"}
                      </button>
                    </div>
                    <span className="project-session-count">
                      {proj.sessions.length}
                    </span>
                  </div>
                </div>
                
                {/* 会话列表 */}
                {!isCollapsed && (
                  <ul className="session-list" style={{ padding: "2px" }}>
                    {proj.sessions.map((session) => renderSessionRow(session))}
                  </ul>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* 9. 自定义高档白天右键上下文悬浮菜单 */}
      {contextMenu && (
        <div 
          className="context-menu"
          style={{ 
            top: contextMenu.y, 
            left: contextMenu.x 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            className="context-menu-item"
            onClick={() => {
              startEditing(contextMenu.session);
              setContextMenu(null);
            }}
          >
            <span className="context-menu-icon">✏️</span>
            重命名会话
          </button>
          <button 
            className="context-menu-item"
            onClick={() => {
              if (onToggleFavorite) {
                onToggleFavorite(contextMenu.session.id, contextMenu.session.favorite !== 1);
              }
              setContextMenu(null);
            }}
          >
            <span className="context-menu-icon">⭐</span>
            {contextMenu.session.favorite === 1 ? "取消收藏" : "收藏会话"}
          </button>
        </div>
      )}

      {/* 项目右键上下文悬浮菜单 */}
      {projectContextMenu && (
        <div 
          className="context-menu"
          style={{ 
            top: projectContextMenu.y, 
            left: projectContextMenu.x 
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button 
            className="context-menu-item"
            onClick={(e) => {
              handleToggleFavoriteProject(projectContextMenu.projectName, e);
              setProjectContextMenu(null);
            }}
          >
            <span className="context-menu-icon">⭐</span>
            {projectContextMenu.isFavorited ? "取消收藏项目" : "收藏项目"}
          </button>
          <button 
            className="context-menu-item"
            onClick={() => {
              handleOpenProjectInExplorer(projectContextMenu.projectPath);
              setProjectContextMenu(null);
            }}
          >
            <span className="context-menu-icon">📂</span>
            在文件管理器中打开
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
            <span className="context-menu-icon">🗑️</span>
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
    </aside>
  );
};
