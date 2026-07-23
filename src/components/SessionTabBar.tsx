import React, { type DragEvent, type MouseEvent, type WheelEvent } from "react";
import type { Session } from "./Sidebar";
import { ClaudeIcon, PiIcon, CodexIcon } from "./Sidebar";

export interface SessionTabBarProps {
  openTabIds: string[];
  sessions: Session[];
  activeSessionId: string;
  glowingSessionIds: string[];
  sessionBusy: Record<string, boolean>;
  draggingIndex: number | null;
  renamingTabId: string | null;
  renamingTabText: string;
  onWheel: (event: WheelEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent, index: number) => void;
  onDragOver: (event: DragEvent, index: number) => void;
  onDragEnd: () => void;
  onDrop: (event: DragEvent) => void;
  onActivateTab: (sessionId: string) => void;
  onCloseTab: (event: MouseEvent, sessionId: string) => void;
  onOpenContextMenu: (event: MouseEvent, sessionId: string) => void;
  onRenamingTextChange: (value: string) => void;
  onSaveRename: (sessionId: string) => void;
  onCancelRename: () => void;
}

export const SessionTabBar: React.FC<SessionTabBarProps> = ({
  openTabIds,
  sessions,
  activeSessionId,
  glowingSessionIds,
  sessionBusy,
  draggingIndex,
  renamingTabId,
  renamingTabText,
  onWheel,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  onActivateTab,
  onCloseTab,
  onOpenContextMenu,
  onRenamingTextChange,
  onSaveRename,
  onCancelRename,
}) => {
  return (
    <div className="tab-bar">
      <div className="tab-list" onWheel={onWheel}>
        {openTabIds.map((tabId, index) => {
          const session = sessions.find((item) => item.id === tabId);
          if (!session) return null;
          const isActive = activeSessionId === tabId;
          const isRenaming = renamingTabId === session.id;
          const isGlowing = glowingSessionIds.includes(session.id);

          return (
            <div
              key={session.id}
              data-id={session.id}
              className={`tab ${isActive ? "active" : ""} ${
                isActive &&
                (session.type === "pi" ? "pi-tab" : session.type === "codex" ? "codex-tab" : "")
              } ${
                isGlowing
                  ? session.type === "pi"
                    ? "glowing-pi"
                    : session.type === "codex"
                      ? "glowing-codex"
                      : "glowing-claude"
                  : ""
              } ${draggingIndex === index ? "dragging" : ""}`}
              draggable={!isRenaming}
              onDragStart={(event) => onDragStart(event, index)}
              onDragOver={(event) => onDragOver(event, index)}
              onDragEnd={onDragEnd}
              onDrop={onDrop}
              onClick={() => onActivateTab(session.id)}
              onMouseDown={(event) => {
                if (event.button === 1) {
                  event.preventDefault();
                  event.stopPropagation();
                  const syntheticEvent = { stopPropagation: () => {} } as MouseEvent;
                  onCloseTab(syntheticEvent, session.id);
                }
              }}
              onContextMenu={(event) => onOpenContextMenu(event, session.id)}
            >
              {isRenaming ? (
                <input
                  type="text"
                  className="tab-rename-input"
                  value={renamingTabText}
                  onChange={(event) => onRenamingTextChange(event.target.value)}
                  onBlur={() => onSaveRename(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") onSaveRename(session.id);
                    else if (event.key === "Escape") onCancelRename();
                  }}
                  onClick={(event) => event.stopPropagation()}
                  autoFocus
                />
              ) : (
                <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
                  {sessionBusy[session.id] ? (
                    <span className="tab-loading-spinner" title="思考中..." />
                  ) : session.type === "claude" ? (
                    <ClaudeIcon size={14} color="#D97757" />
                  ) : session.type === "codex" ? (
                    <CodexIcon size={14} color="var(--color-cyan)" />
                  ) : (
                    <PiIcon size={14} color="var(--color-green)" />
                  )}
                  <span
                    className="tab-title-text"
                    title={
                      session.isTemp ? session.name : `${session.name} (${session.project})`
                    }
                  >
                    {session.isTemp ? session.name : `${session.name} (${session.project})`}
                  </span>
                </span>
              )}
              <span className="tab-close" onClick={(event) => onCloseTab(event, session.id)}>
                ×
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
};
