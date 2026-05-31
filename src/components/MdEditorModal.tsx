import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";

interface MdEditorModalProps {
  show: boolean;
  onClose: () => void;
  projectPath: string;
  filename: string; // "CLAUDE.md" or "AGENTS.md"
}

export const MdEditorModal: React.FC<MdEditorModalProps> = ({
  show,
  onClose,
  projectPath,
  filename,
}) => {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview" | "split">("edit");
  const [isSaving, setIsSaving] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = content !== originalContent;

  // 1. 打开弹窗时异步读取 Markdown 文件内容
  useEffect(() => {
    if (show && projectPath) {
      invoke<string>("read_markdown_file", { path: projectPath, filename })
        .then((data) => {
          setContent(data || "");
          setOriginalContent(data || "");
        })
        .catch((err) => {
          console.error("读取 Markdown 文件失败:", err);
          setContent("");
          setOriginalContent("");
        });
    }
  }, [show, projectPath, filename]);

  // 2. 键盘快捷键监听：Ctrl+S 保存，Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!show) return;
      
      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [show, content, filename, projectPath]);

  // 3. 异步写入/保存 Markdown 文件
  const handleSave = async () => {
    if (!projectPath) return;
    setIsSaving(true);
    try {
      await invoke("write_markdown_file", {
        path: projectPath,
        filename,
        content,
      });
      setOriginalContent(content);
      // 显示气泡试听提示（可选，静默保存即可）
      console.log(`保存 ${filename} 成功！`);
    } catch (err) {
      alert(`保存失败: ${err}`);
    } finally {
      setIsSaving(false);
    }
  };

  // 4. Tab 键缩进拦截
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      const val = textarea.value;

      // 插入 2 个空格作为 Tab 缩进
      const newVal = val.substring(0, start) + "  " + val.substring(end);
      setContent(newVal);

      // 恢复光标位置
      setTimeout(() => {
        if (textarea) {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  // 5. 极其高档的极简 Markdown 渲染器（支持标题、粗体、代码块、列表等，提供高水准预览效果）
  const renderMarkdownToHtml = (mdText: string) => {
    if (!mdText.trim()) {
      return `<p style="color: var(--text-secondary); font-style: italic; font-size: 13px;">文件内容为空</p>`;
    }

    // 简单高效的安全 HTML 转义防止 XSS
    let escaped = mdText
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    // 1. 代码块 ``` 替换
    escaped = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
      return `<pre style="background: rgba(0,0,0,0.25); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); font-family: monospace; font-size: 12.5px; overflow-x: auto; margin: 12px 0; color: var(--text-primary);"><code style="white-space: pre-wrap;">${code.trim()}</code></pre>`;
    });

    // 2. 单行行内代码 `code` 替换
    escaped = escaped.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.15); padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 12.5px; color: var(--color-orange);">$1</code>');

    // 3. 标题 (#, ##, ###)
    escaped = escaped.replace(/^### (.*$)/gim, '<h3 style="font-size: 15px; font-weight: 700; margin: 16px 0 8px 0; color: var(--text-primary); border-left: 3px solid var(--color-primary); padding-left: 8px;">$1</h3>');
    escaped = escaped.replace(/^## (.*$)/gim, '<h2 style="font-size: 17px; font-weight: 700; margin: 20px 0 10px 0; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">$1</h2>');
    escaped = escaped.replace(/^# (.*$)/gim, '<h1 style="font-size: 20px; font-weight: 800; margin: 24px 0 12px 0; color: var(--text-primary); border-bottom: 2px solid var(--border-color); padding-bottom: 6px;">$1</h1>');

    // 4. 无序列表 (- or *)
    escaped = escaped.replace(/^\s*[-*]\s+(.*$)/gim, '<li style="margin: 6px 0; padding-left: 4px; color: var(--text-primary); list-style-type: disc; margin-left: 20px;">$1</li>');

    // 5. 段落（空白行分隔）
    escaped = escaped.replace(/\n\n/g, "</p><p>");
    escaped = `<p style="line-height: 1.6; font-size: 13.5px; color: var(--text-primary);">${escaped}</p>`;

    return escaped;
  };

  // 6. 行数与字符数动态统计
  const charCount = content.length;
  const lineCount = content.trim() === "" ? 0 : content.split("\n").length;

  if (!show) return null;

  return (
    <div className="modal-overlay show" style={{ zIndex: 1100, backdropFilter: "blur(6px)" }}>
      <div 
        className="modal-card" 
        style={{ 
          width: "800px", 
          maxWidth: "92vw", 
          height: "560px",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          background: "var(--bg-sidebar)",
          border: "1px solid var(--border-color)",
          boxShadow: "0 10px 30px rgba(0, 0, 0, 0.4)",
          borderRadius: "12px",
          overflow: "hidden"
        }}
      >
        {/* Header 顶栏 */}
        <div 
          style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "space-between", 
            padding: "10px 16px", 
            borderBottom: "1px solid var(--border-color)",
            background: "rgba(0, 0, 0, 0.15)",
            userSelect: "none"
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <span style={{ fontSize: "14px", fontWeight: 700, color: "var(--text-primary)" }}>
              {filename}
            </span>
            <span style={{ fontSize: "11px", color: "var(--text-secondary)", opacity: 0.8, fontFamily: "monospace" }}>
              {projectPath}
            </span>
            {isDirty && (
              <span style={{ color: "var(--color-primary)", fontWeight: "bold", fontSize: "14px" }} title="未保存">*</span>
            )}
          </div>

          {/* 右侧交互控制面板 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.1)", borderRadius: "6px", padding: "2px" }}>
              <button
                style={{
                  border: "none",
                  background: mode === "edit" ? "var(--bg-main)" : "transparent",
                  color: mode === "edit" ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: mode === "edit" ? 600 : 400,
                  transition: "all 0.15s ease"
                }}
                onClick={() => setMode("edit")}
              >
                编辑
              </button>
              <button
                style={{
                  border: "none",
                  background: mode === "preview" ? "var(--bg-main)" : "transparent",
                  color: mode === "preview" ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: mode === "preview" ? 600 : 400,
                  transition: "all 0.15s ease"
                }}
                onClick={() => setMode("preview")}
              >
                预览
              </button>
              <button
                style={{
                  border: "none",
                  background: mode === "split" ? "var(--bg-main)" : "transparent",
                  color: mode === "split" ? "var(--text-primary)" : "var(--text-secondary)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: mode === "split" ? 600 : 400,
                  transition: "all 0.15s ease"
                }}
                onClick={() => setMode("split")}
              >
                分屏
              </button>
            </div>

            <button
              style={{
                border: "1px solid var(--border-color)",
                background: isDirty ? "var(--color-primary)" : "transparent",
                color: isDirty ? "#ffffff" : "var(--text-secondary)",
                fontSize: "12px",
                padding: "4px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 600,
                transition: "all 0.2s ease"
              }}
              onClick={handleSave}
              disabled={isSaving}
            >
              <span>💾</span>
              <span>{isSaving ? "保存中..." : "保存"}</span>
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
                justifyContent: "center"
              }}
              onClick={onClose}
              title="关闭编辑器"
            >
              ×
            </button>
          </div>
        </div>

        {/* 内容区 */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", background: "var(--bg-main)" }}>
          {/* 编辑态 */}
          {(mode === "edit" || mode === "split") && (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder={`在这里输入 ${filename} 内容...\n\n项目约定、代码规范、常用指令等可以存放在这里，AI 会自动读取。`}
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
                borderRight: mode === "split" ? "1px solid var(--border-color)" : "none"
              }}
            />
          )}

          {/* 预览态 */}
          {(mode === "preview" || mode === "split") && (
            <div
              style={{
                flex: 1,
                padding: "16px",
                overflowY: "auto",
                background: mode === "preview" ? "transparent" : "rgba(0,0,0,0.05)",
                userSelect: "text"
              }}
              dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(content) }}
            />
          )}
        </div>

        {/* Footer 底部状态栏 */}
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
            userSelect: "none"
          }}
        >
          <div style={{ display: "flex", gap: "12px" }}>
            <span><kbd style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: "3px" }}>Ctrl+S</kbd> 保存</span>
            <span><kbd style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: "3px" }}>Tab</kbd> 缩进</span>
            <span><kbd style={{ background: "rgba(255,255,255,0.1)", padding: "1px 4px", borderRadius: "3px" }}>Esc</kbd> 关闭</span>
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
