import React, { type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "./Sidebar";
import type { TabContextMenuState } from "../hooks/useSessionTabs";

export interface TabContextMenuProps {
  menu: TabContextMenuState | null;
  sessions: Session[];
  activeSessionId: string;
  isDualSplit?: boolean;
  openTabCount?: number;
  onCloseTab: (event: MouseEvent, sessionId: string) => void;
  onCloseOtherTabs: (sessionId: string) => void;
  onStartRename: (sessionId: string, currentName: string) => void;
  onLocateSession: (sessionId: string) => void;
  onOpenInSplit?: (sessionId: string) => void;
  onExitSplit?: () => void;
  onClose: () => void;
}

export const TabContextMenu: React.FC<TabContextMenuProps> = ({
  menu,
  sessions,
  activeSessionId,
  isDualSplit = false,
  openTabCount = 0,
  onCloseTab,
  onCloseOtherTabs,
  onStartRename,
  onLocateSession,
  onOpenInSplit,
  onExitSplit,
  onClose,
}) => {
  if (!menu) return null;

  const session = sessions.find((item) => item.id === menu.sessionId);
  const canSplitThis =
    Boolean(onOpenInSplit) &&
    openTabCount >= 2 &&
    menu.sessionId !== activeSessionId;
  const canSplitWithCompanion =
    Boolean(onOpenInSplit) && openTabCount >= 2 && !isDualSplit;

  return (
    <div
      className="context-menu"
      style={{
        top: menu.y,
        left: menu.x,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="context-menu-item"
        onClick={() => {
          const syntheticEvent = { stopPropagation: () => {} } as MouseEvent;
          onCloseTab(syntheticEvent, menu.sessionId);
          onClose();
        }}
      >
        关闭标签页
      </button>
      <button
        className="context-menu-item"
        onClick={() => {
          onCloseOtherTabs(menu.sessionId);
          onClose();
        }}
      >
        关闭其他标签
      </button>

      {(canSplitThis || canSplitWithCompanion || isDualSplit) && (
        <>
          <div style={{ borderBottom: "1px dashed var(--border-color)", margin: "4px 6px" }} />
          {canSplitThis && (
            <button
              className="context-menu-item"
              onClick={() => {
                onOpenInSplit?.(menu.sessionId);
                onClose();
              }}
            >
              在另一侧打开分屏
            </button>
          )}
          {canSplitWithCompanion && menu.sessionId === activeSessionId && (
            <button
              className="context-menu-item"
              onClick={() => {
                onOpenInSplit?.(menu.sessionId);
                onClose();
              }}
            >
              与相邻标签分屏
            </button>
          )}
          {isDualSplit && onExitSplit && (
            <button
              className="context-menu-item"
              onClick={() => {
                onExitSplit();
                onClose();
              }}
            >
              退出分屏
            </button>
          )}
        </>
      )}

      {!session?.isTemp && (
        <>
          <div style={{ borderBottom: "1px dashed var(--border-color)", margin: "4px 6px" }} />
          <button
            className="context-menu-item"
            onClick={() => {
              onStartRename(menu.sessionId, session?.name || "");
              onClose();
            }}
          >
            重命名会话
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              onLocateSession(menu.sessionId);
              onClose();
            }}
          >
            在侧边栏中定位
          </button>
          <div style={{ borderBottom: "1px dashed var(--border-color)", margin: "4px 6px" }} />
          <button
            className="context-menu-item"
            onClick={() => {
              if (session) {
                navigator.clipboard.writeText(session.path).catch(() => {});
              }
              onClose();
            }}
          >
            复制项目路径
          </button>
          <button
            className="context-menu-item"
            onClick={() => {
              if (session) {
                invoke("open_project_folder", { path: session.path }).catch(() => {});
              }
              onClose();
            }}
          >
            在文件管理器中打开
          </button>
        </>
      )}
    </div>
  );
};
