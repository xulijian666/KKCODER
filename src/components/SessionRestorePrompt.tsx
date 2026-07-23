import React from "react";
import type { Session } from "./Sidebar";

export interface SessionRestorePromptProps {
  showToast: boolean;
  showModal: boolean;
  pendingRestoreIds: string[];
  sessions: Session[];
  onOpenModal: () => void;
  onCloseModal: () => void;
  onRestoreSingle: (sessionId: string) => void;
  onRestoreAll: () => void;
  onIgnore: () => void;
}

export const SessionRestorePrompt: React.FC<SessionRestorePromptProps> = ({
  showToast,
  showModal,
  pendingRestoreIds,
  sessions,
  onOpenModal,
  onCloseModal,
  onRestoreSingle,
  onRestoreAll,
  onIgnore,
}) => {
  return (
    <>
      {showToast && pendingRestoreIds.length > 0 && (
        <div className="restore-toast">
          <div className="restore-toast-header">
            <span className="restore-toast-title">恢复上次会话</span>
            <button className="restore-toast-close" onClick={onIgnore}>
              ✕
            </button>
          </div>
          <div className="restore-toast-body">
            上次关闭时有 {pendingRestoreIds.length} 个会话未恢复，可点此逐个恢复
          </div>
          <div className="restore-toast-footer">
            <button className="restore-toast-btn" onClick={onOpenModal}>
              查看并恢复
            </button>
          </div>
        </div>
      )}

      {showModal && pendingRestoreIds.length > 0 && (
        <div className="modal-overlay show" style={{ zIndex: 1200 }}>
          <div
            className="modal-card restore-session-modal"
            style={{ width: "520px" }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="modal-header">
              <span className="modal-title" style={{ fontSize: "15px", fontWeight: 700 }}>
                恢复上次会话
              </span>
              <button className="modal-close" onClick={onCloseModal}>
                ✕
              </button>
            </div>
            <div
              className="modal-body"
              style={{ display: "flex", flexDirection: "column", gap: "14px", padding: "10px 0" }}
            >
              <p style={{ fontSize: "13px", color: "var(--text-secondary)", margin: "0 0 4px 0" }}>
                选择要恢复的会话，将续上上次的对话上下文。
              </p>
              <div className="restore-session-list">
                {pendingRestoreIds.map((tabId) => {
                  const session = sessions.find((item) => item.id === tabId);
                  if (!session) return null;
                  return (
                    <div key={session.id} className="restore-session-item">
                      <div className="restore-item-info">
                        <div className="restore-item-name">{session.name}</div>
                        <div className="restore-item-path" title={session.path}>
                          {session.type === "claude"
                            ? "claude-code"
                            : session.type === "codex"
                              ? "codex"
                              : "pi"}{" "}
                          · {session.path}
                        </div>
                      </div>
                      <button
                        className="restore-item-btn"
                        onClick={() => onRestoreSingle(session.id)}
                      >
                        恢复
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
            <div
              className="modal-footer"
              style={{ marginTop: "15px", display: "flex", gap: "12px" }}
            >
              <button
                className="modal-btn btn-all-restore"
                onClick={onRestoreAll}
                style={{ flex: 1 }}
              >
                全部恢复
              </button>
              <button
                className="modal-btn modal-btn-cancel"
                onClick={onIgnore}
                style={{ flex: 1 }}
              >
                忽略
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
