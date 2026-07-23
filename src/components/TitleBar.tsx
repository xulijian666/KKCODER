import React from "react";

export interface TitleBarProps {
  currentTheme: string;
  showThemeDropdown: boolean;
  setShowThemeDropdown: React.Dispatch<React.SetStateAction<boolean>>;
  onSelectTheme: (themeName: string) => void;
  showProjectTree: boolean;
  isTempSession: boolean;
  onToggleProjectTree: () => void;
  onLaunchCcswitch: () => void;
  onOpenSettings: () => void;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  onTitlebarMouseDown: (event: React.MouseEvent) => void;
}

export const TitleBar: React.FC<TitleBarProps> = ({
  currentTheme,
  showThemeDropdown,
  setShowThemeDropdown,
  onSelectTheme,
  showProjectTree,
  isTempSession,
  onToggleProjectTree,
  onLaunchCcswitch,
  onOpenSettings,
  onMinimize,
  onMaximize,
  onClose,
  onTitlebarMouseDown,
}) => {
  return (
    <div className="custom-titlebar" onMouseDown={onTitlebarMouseDown}>
      <div className="titlebar-logo">
        <div className="titlebar-logo-icon">KK</div>
        <span className="logo-title-text">KKCoder 极简 AI 终端管理器</span>
      </div>

      <div className="titlebar-actions" onMouseDown={(event) => event.stopPropagation()}>
        <button className="titlebar-btn ccswitch-btn" onClick={onLaunchCcswitch} title="打开 CCSwitch">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="1" y="5" width="22" height="14" rx="7" ry="7"></rect>
            <circle cx="16" cy="12" r="3"></circle>
          </svg>
        </button>

        <div className="theme-selector-wrapper">
          <button
            className={`titlebar-btn theme-palette-btn ${showThemeDropdown ? "active" : ""}`}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              setShowThemeDropdown(!showThemeDropdown);
            }}
            title="选择颜色主题"
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22C17.52 22 22 17.52 22 12S17.52 2 12 2 2 6.48 2 12c0 2.2 1.8 4 4 4h1a2 2 0 0 1 2 2v2c0 1.1.9 2 2 2z"></path>
              <circle cx="7.5" cy="10.5" r="1.5" fill="currentColor"></circle>
              <circle cx="11.5" cy="7.5" r="1.5" fill="currentColor"></circle>
              <circle cx="16.5" cy="9.5" r="1.5" fill="currentColor"></circle>
              <circle cx="15.5" cy="14.5" r="1.5" fill="currentColor"></circle>
            </svg>
          </button>
          {showThemeDropdown && (
            <div
              className="theme-dropdown"
              onMouseDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="theme-dropdown-section">
                <div className="theme-dropdown-section-title">深色</div>
                <div
                  className={`theme-dropdown-item ${currentTheme === "dark-blue" ? "active" : ""}`}
                  onClick={() => onSelectTheme("dark-blue")}
                >
                  <span className="theme-preview-dots">
                    <span className="theme-dot" style={{ backgroundColor: "#121620" }}></span>
                    <span className="theme-dot" style={{ backgroundColor: "#3b82f6" }}></span>
                  </span>
                  <span className="theme-name">深空墨</span>
                </div>
                <div
                  className={`theme-dropdown-item ${currentTheme === "dark-purple" ? "active" : ""}`}
                  onClick={() => onSelectTheme("dark-purple")}
                >
                  <span className="theme-preview-dots">
                    <span className="theme-dot" style={{ backgroundColor: "#171424" }}></span>
                    <span className="theme-dot" style={{ backgroundColor: "#8b5cf6" }}></span>
                  </span>
                  <span className="theme-name">赛博紫</span>
                </div>
                <div
                  className={`theme-dropdown-item ${currentTheme === "dark-zinc" ? "active" : ""}`}
                  onClick={() => onSelectTheme("dark-zinc")}
                >
                  <span className="theme-preview-dots">
                    <span className="theme-dot" style={{ backgroundColor: "#1d1b18" }}></span>
                    <span className="theme-dot" style={{ backgroundColor: "#d97706" }}></span>
                  </span>
                  <span className="theme-name">琥珀金</span>
                </div>
              </div>

              <div className="theme-dropdown-section">
                <div className="theme-dropdown-section-title">浅色</div>
                <div
                  className={`theme-dropdown-item ${currentTheme === "light-premium" ? "active" : ""}`}
                  onClick={() => onSelectTheme("light-premium")}
                >
                  <span className="theme-preview-dots">
                    <span className="theme-dot" style={{ backgroundColor: "#ffffff", border: "1px solid #e2e8f0" }}></span>
                    <span className="theme-dot" style={{ backgroundColor: "#2563eb" }}></span>
                  </span>
                  <span className="theme-name">经典白</span>
                </div>
                <div
                  className={`theme-dropdown-item ${currentTheme === "light-orange" ? "active" : ""}`}
                  onClick={() => onSelectTheme("light-orange")}
                >
                  <span className="theme-preview-dots">
                    <span className="theme-dot" style={{ backgroundColor: "#ffffff", border: "1px solid #fed7aa" }}></span>
                    <span className="theme-dot" style={{ backgroundColor: "#ea580c" }}></span>
                  </span>
                  <span className="theme-name">暖沙</span>
                </div>
                <div
                  className={`theme-dropdown-item ${currentTheme === "light-blue" ? "active" : ""}`}
                  onClick={() => onSelectTheme("light-blue")}
                >
                  <span className="theme-preview-dots">
                    <span className="theme-dot" style={{ backgroundColor: "#ffffff", border: "1px solid #bae6fd" }}></span>
                    <span className="theme-dot" style={{ backgroundColor: "#0284c7" }}></span>
                  </span>
                  <span className="theme-name">天空蓝</span>
                </div>
              </div>

              <div className="theme-dropdown-divider"></div>

              <div
                className={`theme-dropdown-item ${currentTheme === "auto" ? "active" : ""}`}
                onClick={() => onSelectTheme("auto")}
              >
                <span className="theme-preview-dots">
                  <span className="theme-dot theme-dot-split"></span>
                </span>
                <span className="theme-name">跟随系统</span>
              </div>
            </div>
          )}
        </div>

        {!isTempSession && (
          <button
            className={`titlebar-btn toggle-project-tree-btn ${showProjectTree ? "active" : ""}`}
            onClick={onToggleProjectTree}
            title={showProjectTree ? "关闭工作区文件树" : "打开工作区文件树"}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
              <line x1="16" y1="3" x2="16" y2="21"></line>
            </svg>
          </button>
        )}

        <button className="titlebar-btn settings-gear-btn" onClick={onOpenSettings} title="打开设置">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3"></circle>
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
          </svg>
        </button>
        <button className="titlebar-btn minimize-btn" onClick={onMinimize} title="最小化">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="5" y1="12" x2="19" y2="12"></line>
          </svg>
        </button>
        <button className="titlebar-btn maximize-btn" onClick={onMaximize} title="最大化">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
          </svg>
        </button>
        <button className="titlebar-btn close-btn" onClick={onClose} title="关闭">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
  );
};
