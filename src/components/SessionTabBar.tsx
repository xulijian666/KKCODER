import React, {
  type CSSProperties,
  type DragEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import type { Session } from "./Sidebar";
import { ClaudeIcon, PiIcon, CodexIcon } from "./Sidebar";
import {
  clampSplitRatio,
  SESSION_DRAG_MIME,
  type SplitOrientation,
  type SplitPaneSlot,
  type TerminalSplitPair,
} from "../utils/terminalSplit";

export interface SessionTabBarProps {
  openTabIds: string[];
  sessions: Session[];
  activeSessionId: string;
  glowingSessionIds: string[];
  sessionBusy: Record<string, boolean>;
  draggingIndex: number | null;
  renamingTabId: string | null;
  renamingTabText: string;
  paneSlotFor?: (sessionId: string) => SplitPaneSlot | null;
  isDualSplit?: boolean;
  splitPair?: TerminalSplitPair | null;
  splitOrientation?: SplitOrientation;
  /** primary 占比 0.22–0.78，与终端分屏联动 */
  splitRatio?: number;
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

function resolveTabIndexInOpenList(openTabIds: string[], sessionId: string): number {
  return openTabIds.indexOf(sessionId);
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
  paneSlotFor,
  isDualSplit = false,
  splitPair = null,
  splitOrientation = "horizontal",
  splitRatio = 0.5,
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
  // 仅左右分屏：标签栏与终端同比例双栏
  // 左栏：保持 openTabIds 原有顺序（不含 secondary），点击只换左屏内容，不把标签「拽到最左」
  // 右栏：仅 secondary（与右半终端对齐）
  const useSpatialDualTabs =
    isDualSplit && splitPair !== null && splitOrientation === "horizontal";

  const primaryTabIds = useSpatialDualTabs
    ? openTabIds.filter((tabId) => tabId !== splitPair.secondaryId)
    : openTabIds;

  const secondaryTabIds =
    useSpatialDualTabs && splitPair ? [splitPair.secondaryId] : [];

  const safeRatio = clampSplitRatio(splitRatio);
  const primaryPercent = `${safeRatio * 100}%`;
  const secondaryPercent = `${(1 - safeRatio) * 100}%`;

  const renderTab = (sessionId: string, options?: { forceVisibleWhenSplit?: boolean }) => {
    const session = sessions.find((item) => item.id === sessionId);
    // 分屏右栏：即使 sessions 列表偶发未同步，也要占位，避免「右侧标签消失」
    if (!session && !(options?.forceVisibleWhenSplit && isDualSplit && splitPair)) {
      return null;
    }

    const index = resolveTabIndexInOpenList(openTabIds, sessionId);
    // 右栏 secondary 允许 index 暂时为 -1（仍渲染）
    if (index < 0 && !(options?.forceVisibleWhenSplit && isDualSplit)) {
      return null;
    }

    const isActive = activeSessionId === sessionId;
    const isRenaming = !!session && renamingTabId === session.id;
    const isGlowing = glowingSessionIds.includes(sessionId);
    const isSplitVisible =
      isDualSplit &&
      !!splitPair &&
      (sessionId === splitPair.primaryId || sessionId === splitPair.secondaryId);
    // 左栏里「已打开但当前不在分屏格」的标签：待命态，勿用纯灰 secondary 字色
    const isSplitStandby = isDualSplit && !!splitPair && !isSplitVisible;
    const paneSlot =
      isSplitVisible && splitPair
        ? sessionId === splitPair.primaryId
          ? "primary"
          : "secondary"
        : paneSlotFor?.(sessionId) ?? null;

    const tabTitle = session
      ? session.isTemp
        ? session.name
        : `${session.name} (${session.project})`
      : sessionId;
    const agentType = session?.type ?? "claude";
    const isBusy = session ? !!sessionBusy[session.id] : false;

    return (
      <div
        key={sessionId}
        data-id={sessionId}
        className={`tab ${isActive ? "active" : ""} ${
          isSplitVisible
            ? `split-visible split-${paneSlot} ${isActive ? "split-focused" : "split-unfocused"}`
            : isSplitStandby
              ? "split-standby"
              : ""
        } ${
          isActive &&
          (agentType === "pi" ? "pi-tab" : agentType === "codex" ? "codex-tab" : "")
        } ${
          isGlowing
            ? agentType === "pi"
              ? "glowing-pi"
              : agentType === "codex"
                ? "glowing-codex"
                : "glowing-claude"
            : ""
        } ${draggingIndex === index && index >= 0 && !isDualSplit ? "dragging" : ""}`}
        draggable={!isRenaming}
        onDragStart={(event) => {
          event.dataTransfer.setData(SESSION_DRAG_MIME, sessionId);
          event.dataTransfer.setData("text/plain", sessionId);
          event.dataTransfer.effectAllowed = "move";
          if (index >= 0) onDragStart(event, index);
        }}
        onDragOver={(event) => {
          if (isDualSplit) {
            event.preventDefault();
            return;
          }
          if (index >= 0) onDragOver(event, index);
        }}
        onDragEnd={() => {
          onDragEnd();
        }}
        onDrop={(event) => {
          onDrop(event);
        }}
        onClick={() => onActivateTab(sessionId)}
        onMouseDown={(event) => {
          if (event.button === 1) {
            event.preventDefault();
            event.stopPropagation();
            const syntheticEvent = { stopPropagation: () => {} } as MouseEvent;
            onCloseTab(syntheticEvent, sessionId);
          }
        }}
        onContextMenu={(event) => onOpenContextMenu(event, sessionId)}
      >
        {isRenaming && session ? (
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
            {isBusy ? (
              <span className="tab-loading-spinner" title="思考中..." />
            ) : agentType === "claude" ? (
              <ClaudeIcon size={14} color="#D97757" />
            ) : agentType === "codex" ? (
              <CodexIcon size={14} color="var(--color-cyan)" />
            ) : (
              <PiIcon size={14} color="var(--color-green)" />
            )}
            <span className="tab-title-text" title={tabTitle}>
              {tabTitle}
            </span>
          </span>
        )}
        <span className="tab-close" onClick={(event) => onCloseTab(event, sessionId)}>
          ×
        </span>
      </div>
    );
  };

  if (useSpatialDualTabs) {
    return (
      <div
        className="tab-bar tab-bar-dual-horizontal"
        style={
          {
            ["--split-primary-ratio" as string]: primaryPercent,
            ["--split-secondary-ratio" as string]: secondaryPercent,
          } as CSSProperties
        }
      >
        <div
          className="tab-bar-pane tab-bar-pane-primary"
          style={{ width: primaryPercent, flex: `0 0 ${primaryPercent}` }}
          onWheel={onWheel}
        >
          <div className="tab-list tab-list-pane">{primaryTabIds.map((id) => renderTab(id))}</div>
        </div>
        <div
          className="tab-bar-pane tab-bar-pane-secondary"
          style={{ width: secondaryPercent, flex: `0 0 ${secondaryPercent}` }}
          onWheel={onWheel}
        >
          <div className="tab-list tab-list-pane">
            {secondaryTabIds.map((id) =>
              renderTab(id, { forceVisibleWhenSplit: true }),
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="tab-bar">
      <div className="tab-list" onWheel={onWheel}>
        {openTabIds.map((tabId) => renderTab(tabId))}
      </div>
    </div>
  );
};
