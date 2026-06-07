import React from "react";

interface ConfirmModalProps {
  show: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
}

export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  show,
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  onConfirm,
  onCancel,
  isDanger = false,
}) => {
  if (!show) return null;

  return (
    <div className="modal-overlay show" style={{ zIndex: 1200 }} onClick={onCancel}>
      <div
        className="modal-card"
        style={{ maxWidth: "420px" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <span className="modal-title" style={{ fontSize: "15px", fontWeight: 700 }}>
            {title}
          </span>
          <button className="modal-close" onClick={onCancel}>
            ×
          </button>
        </div>

        <div style={{ fontSize: "13.5px", lineHeight: "1.6", color: "var(--text-primary)" }}>
          {message}
        </div>

        <div className="modal-footer" style={{ marginTop: "15px" }}>
          <button className="modal-btn modal-btn-cancel" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            className="modal-btn modal-btn-create"
            style={
              isDanger
                ? {
                    backgroundColor: "#ef4444",
                    color: "#ffffff",
                    boxShadow: "0 2px 4px rgba(239, 68, 68, 0.2)",
                  }
                : undefined
            }
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};
