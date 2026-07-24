import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  confirmAction,
  formatFeedbackError,
  notifyError,
} from "../utils/appFeedback";

interface FileEditorModalProps {
  show: boolean;
  onClose: () => void;
  projectPath: string;
  relativePath: string;
}

export const FileEditorModal: React.FC<FileEditorModalProps> = ({
  show,
  onClose,
  projectPath,
  relativePath,
}) => {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef(content);

  useEffect(() => {
    contentRef.current = content;
  }, [content]);

  const isDirty = content !== originalContent;
  const fileName = relativePath.split(/[/\\]/).pop() || relativePath;

  useEffect(() => {
    if (!show || !projectPath || !relativePath) return;

    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    setContent("");
    setOriginalContent("");

    invoke<string>("read_project_file_content", {
      projectPath,
      relativePath,
    })
      .then((data) => {
        if (cancelled) return;
        setContent(data || "");
        setOriginalContent(data || "");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(err ? String(err) : "无法读取此文件");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [show, projectPath, relativePath]);

  const handleSave = async () => {
    if (!projectPath || !relativePath || loadError) return;
    setIsSaving(true);
    try {
      await invoke("write_project_file_content", {
        projectPath,
        relativePath,
        content: contentRef.current,
      });
      setOriginalContent(contentRef.current);
    } catch (err) {
      notifyError(`保存失败：${formatFeedbackError(err)}`);
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!show) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        void handleClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [show, onClose, projectPath, relativePath, loadError]);

  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== "Tab") return;
    e.preventDefault();
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const val = textarea.value;
    const newVal = `${val.substring(0, start)}  ${val.substring(end)}`;
    setContent(newVal);

    requestAnimationFrame(() => {
      textarea.selectionStart = textarea.selectionEnd = start + 2;
    });
  };

  const handleClose = async () => {
    if (isDirty) {
      const confirmed = await confirmAction({
        title: "放弃未保存修改？",
        message: "当前文件有未保存的更改，关闭后将丢失。",
        confirmText: "放弃并关闭",
        cancelText: "继续编辑",
        isDanger: true,
      });
      if (!confirmed) return;
    }
    onClose();
  };

  if (!show) return null;

  const charCount = content.length;
  const lineCount = content === "" ? 0 : content.split("\n").length;

  return (
    <div className="modal-overlay show" style={{ zIndex: 1100, backdropFilter: "blur(6px)" }}>
      <div
        className="modal-card file-editor-modal"
        style={{
          width: "900px",
          maxWidth: "94vw",
          height: "640px",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border-color)",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
          borderRadius: "12px",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "10px 16px",
            borderBottom: "1px solid var(--border-color)",
            background: "rgba(0, 0, 0, 0.15)",
            userSelect: "none",
            gap: "12px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 0 }}>
            <span
              style={{
                fontSize: "14px",
                fontWeight: 700,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
              }}
            >
              {fileName}
            </span>
            <span
              style={{
                fontSize: "11px",
                color: "var(--text-secondary)",
                opacity: 0.8,
                fontFamily: "monospace",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={relativePath}
            >
              {relativePath}
            </span>
            {isDirty && (
              <span
                style={{ color: "var(--color-primary)", fontWeight: "bold", fontSize: "14px" }}
                title="未保存"
              >
                *
              </span>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexShrink: 0 }}>
            <button
              className="file-editor-save-btn"
              style={{
                border: "1px solid var(--border-color)",
                background: isDirty ? "var(--color-primary)" : "transparent",
                color: isDirty ? "#ffffff" : "var(--text-secondary)",
                fontSize: "12px",
                padding: "4px 14px",
                borderRadius: "6px",
                cursor: isSaving || !!loadError || loading ? "not-allowed" : "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 600,
                transition: "all 0.2s ease",
                opacity: isSaving || !!loadError || loading ? 0.6 : 1,
              }}
              onClick={() => void handleSave()}
              disabled={isSaving || !!loadError || loading}
              title="保存 (Ctrl+S)"
            >
              {isSaving ? "保存中..." : "保存"}
            </button>

            <button
              style={{
                border: "none",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: "20px",
                lineHeight: 1,
                cursor: "pointer",
                padding: "2px 6px",
                borderRadius: "4px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={() => void handleClose()}
              title="关闭编辑器"
            >
              ×
            </button>
          </div>
        </div>

        <div style={{ display: "flex", flex: 1, overflow: "hidden", background: "var(--bg-main)" }}>
          {loading ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color: "var(--text-secondary)",
                fontSize: "13px",
              }}
            >
              加载中...
            </div>
          ) : loadError ? (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                gap: "8px",
                color: "var(--text-secondary)",
                padding: "24px",
                textAlign: "center",
              }}
            >
              <div style={{ fontSize: "14px", fontWeight: 600, color: "var(--text-primary)" }}>
                无法编辑此文件
              </div>
              <div style={{ fontSize: "12px", maxWidth: "420px", lineHeight: 1.5 }}>{loadError}</div>
            </div>
          ) : (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              spellCheck={false}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--text-primary)",
                fontFamily: "var(--font-family, monospace)",
                fontSize: "13px",
                padding: "16px",
                resize: "none",
                lineHeight: "1.6",
                overflowY: "auto",
              }}
            />
          )}
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 16px",
            borderTop: "1px solid var(--border-color)",
            background: "rgba(0, 0, 0, 0.15)",
            fontSize: "11px",
            color: "var(--text-secondary)",
            opacity: 0.85,
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", gap: "12px" }}>
            <span>
              <kbd style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: "3px" }}>
                Ctrl+S
              </kbd>{" "}
              保存
            </span>
            <span>
              <kbd style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: "3px" }}>
                Tab
              </kbd>{" "}
              缩进
            </span>
            <span>
              <kbd style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: "3px" }}>
                Esc
              </kbd>{" "}
              关闭
            </span>
          </div>
          <div>
            <span>{lineCount} 行</span>
            <span style={{ margin: "0 6px" }}>·</span>
            <span>{charCount} 字符</span>
          </div>
        </div>
      </div>
    </div>
  );
};
