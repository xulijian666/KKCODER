import React, { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { 
  FileText, 
  CheckCircle2, 
  Sparkles, 
  Save, 
  X, 
  Eye, 
  Edit3, 
  Link2
} from "lucide-react";
import { renderMarkdownToHtml } from "../utils/markdown";
import { formatFeedbackError, notifyError, notifySuccess } from "../utils/appFeedback";

interface MdEditorModalProps {
  show: boolean;
  onClose: () => void;
  projectPath: string;
  /** 默认主规则文件名 */
  filename?: string;
}

export const RULE_FILE_NAME = "RULE.md";
export const CLAUDE_FILE_NAME = "CLAUDE.md";
export const AGENTS_FILE_NAME = "AGENTS.md";

const POINTER_START = "<!-- KKCODER:RULES_POINTER_START -->";
const POINTER_END = "<!-- KKCODER:RULES_POINTER_END -->";

/**
 * 在 CLAUDE.md / AGENTS.md 顶部安全插入或更新规则引用
 * 绝不影响文件原有的任何已有架构与配置内容
 */
export function injectRulePointer(existingContent: string, ruleFilename = RULE_FILE_NAME): string {
  const pointerBlock = `${POINTER_START}\n> [!IMPORTANT]\n> **Project Rules & Guidelines**: You MUST strictly adhere to all instructions and constraints defined in [\`${ruleFilename}\`](./${ruleFilename}) before planning or executing any tasks.\n${POINTER_END}`;

  // 1. 如果已有锚点区块，替换该区块并保留其余所有内容
  if (existingContent.includes(POINTER_START) && existingContent.includes(POINTER_END)) {
    const regex = new RegExp(`${POINTER_START}[\\s\\S]*?${POINTER_END}\\n*`, "g");
    const cleaned = existingContent.replace(regex, "").trim();
    if (!cleaned) {
      return pointerBlock + "\n";
    }
    return `${pointerBlock}\n\n${cleaned}\n`;
  }

  // 2. 如果无锚点区块但已有内容，在文件最顶部插入引用，保留原始内容
  const trimmed = existingContent.trim();
  if (!trimmed) {
    return pointerBlock + "\n";
  }
  return `${pointerBlock}\n\n${trimmed}\n`;
}

/** 默认规则模板库 */
const RULE_PRESETS = [
  {
    name: "通用工程规范 (推荐)",
    content: `# 项目开发行为规则 (Project Rules)

## 1. 核心准则
- 每次修改代码前，先梳理逻辑与调用链路，杜绝臆测。
- 遵循单一职责原则，保持代码简洁、可读、高可维护性。
- 禁止修改无关逻辑或无故删除现有注释与文档。

## 2. 代码质量与安全
- 严禁硬编码敏感信息（密码、API Key、Token、私钥等）。
- 所有公共接口需具备完善的类型定义与边界异常处理。
- 遵循仓库统一的代码格式化风格与 Lint 规范。

## 3. Git 提交约定
- 遵循 Conventional Commits 规范（feat/fix/refactor/docs/chore）。
- 提交前确认没有残留临时调试代码或无关日志输出。
`,
  },
  {
    name: "测试驱动与严谨重构",
    content: `# 严谨开发与测试规则 (Strict TDD & Quality Rules)

## 1. 开发流程
- 优先遵循 Red-Green-Refactor 循环，关键逻辑需补充对应单元测试。
- 在未确认影响范围前，禁止进行破坏性重构或大规模改动。

## 2. 健壮性与排错
- 遇到错误时深入分析根本原因（Root Cause），避免表面打补丁。
- 异步操作与网络请求必须包含超时与异常降级策略。
`,
  },
];

export const MdEditorModal: React.FC<MdEditorModalProps> = ({
  show,
  onClose,
  projectPath,
  filename = RULE_FILE_NAME,
}) => {
  const [activeTab, setActiveTab] = useState<string>(filename || RULE_FILE_NAME);
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [mode, setMode] = useState<"edit" | "preview">("edit");
  const [isSaving, setIsSaving] = useState(false);
  const [saveHint, setSaveHint] = useState("");
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const isDirty = content !== originalContent;

  // 1. 打开弹窗或切换 Tab 时异步读取文件
  useEffect(() => {
    if (show && projectPath) {
      setSaveHint("");
      invoke<string>("read_markdown_file", { path: projectPath, filename: activeTab })
        .then((data) => {
          let text = data || "";
          // 如果是主规则文件且为空，默认填充推荐模板
          if (!text && activeTab === RULE_FILE_NAME) {
            text = RULE_PRESETS[0].content;
          }
          setContent(text);
          setOriginalContent(text);
        })
        .catch((err) => {
          console.error("读取 Markdown 文件失败:", err);
          setContent("");
          setOriginalContent("");
        });
    }
  }, [show, projectPath, activeTab]);

  // 2. 键盘快捷键监听：Ctrl+S 保存，Esc 关闭
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!show) return;

      if (e.ctrlKey && e.key === "s") {
        e.preventDefault();
        void handleSave();
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [show, content, activeTab, projectPath, originalContent]);

  // 3. 保存规则文件，并自动双向同步 / 注入索引
  const handleSave = async () => {
    if (!projectPath) return;
    setIsSaving(true);
    setSaveHint("");
    try {
      // 3.1 保存当前激活的文件
      await invoke("write_markdown_file", {
        path: projectPath,
        filename: activeTab,
        content,
      });

      // 3.2 如果编辑的是主规则文件 RULE.md，安全无侵入更新 CLAUDE.md 与 AGENTS.md 的顶栏引用
      if (activeTab === RULE_FILE_NAME) {
        // 更新 CLAUDE.md
        try {
          const claudeContent = await invoke<string>("read_markdown_file", {
            path: projectPath,
            filename: CLAUDE_FILE_NAME,
          }).catch(() => "");
          const updatedClaude = injectRulePointer(claudeContent, RULE_FILE_NAME);
          await invoke("write_markdown_file", {
            path: projectPath,
            filename: CLAUDE_FILE_NAME,
            content: updatedClaude,
          });
        } catch (e) {
          console.warn("更新 CLAUDE.md 引用失败:", e);
        }

        // 更新 AGENTS.md
        try {
          const agentsContent = await invoke<string>("read_markdown_file", {
            path: projectPath,
            filename: AGENTS_FILE_NAME,
          }).catch(() => "");
          const updatedAgents = injectRulePointer(agentsContent, RULE_FILE_NAME);
          await invoke("write_markdown_file", {
            path: projectPath,
            filename: AGENTS_FILE_NAME,
            content: updatedAgents,
          });
        } catch (e) {
          console.warn("更新 AGENTS.md 引用失败:", e);
        }

        setSaveHint("已保存 RULE.md，并安全关联至 CLAUDE.md 和 AGENTS.md");
      } else if (activeTab === CLAUDE_FILE_NAME) {
        // 如果编辑的是 CLAUDE.md，自动将改动同步写入 AGENTS.md
        try {
          await invoke("write_markdown_file", {
            path: projectPath,
            filename: AGENTS_FILE_NAME,
            content,
          });
          setSaveHint("已保存 CLAUDE.md，并自动同步更新 AGENTS.md");
        } catch (syncErr) {
          console.warn("同步 AGENTS.md 失败:", syncErr);
          setSaveHint("已保存 CLAUDE.md");
        }
      } else {
        setSaveHint(`已保存 ${activeTab}`);
      }

      setOriginalContent(content);
      notifySuccess("规则已成功保存并同步生效");
    } catch (err) {
      notifyError(`保存失败：${formatFeedbackError(err)}`);
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

      const newVal = val.substring(0, start) + "  " + val.substring(end);
      setContent(newVal);

      setTimeout(() => {
        if (textarea) {
          textarea.selectionStart = textarea.selectionEnd = start + 2;
        }
      }, 0);
    }
  };

  // 5. 应用预设模板
  const handleApplyPreset = (presetContent: string) => {
    setContent(presetContent);
    setShowPresetMenu(false);
  };

  // 6. 统计
  const charCount = content.length;
  const lineCount = content.trim() === "" ? 0 : content.split("\n").length;

  if (!show) return null;

  return (
    <div className="modal-overlay show" style={{ zIndex: 1100, backdropFilter: "blur(8px)" }}>
      <div 
        className="modal-card" 
        style={{ 
          width: "860px", 
          maxWidth: "94vw", 
          height: "600px",
          display: "flex",
          flexDirection: "column",
          padding: 0,
          background: "var(--bg-main)",
          border: "1px solid var(--border-color)",
          boxShadow: "0 12px 36px rgba(0, 0, 0, 0.45)",
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
            background: "var(--bg-sidebar)",
            userSelect: "none"
          }}
        >
          {/* 左侧：文件标签切换（仅暴露 RULE.md 和 CLAUDE.md） */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
            <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.08)", borderRadius: "6px", padding: "2px" }}>
              <button
                style={{
                  border: "none",
                  background: activeTab === RULE_FILE_NAME ? "var(--bg-main)" : "transparent",
                  color: activeTab === RULE_FILE_NAME ? "var(--color-primary)" : "var(--text-secondary)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: 600,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  transition: "all 0.15s ease",
                  boxShadow: activeTab === RULE_FILE_NAME ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
                onClick={() => setActiveTab(RULE_FILE_NAME)}
              >
                <FileText size={12} />
                <span>{RULE_FILE_NAME} (主规则)</span>
              </button>
              <button
                style={{
                  border: "none",
                  background: activeTab === CLAUDE_FILE_NAME ? "var(--bg-main)" : "transparent",
                  color: activeTab === CLAUDE_FILE_NAME ? "var(--color-primary)" : "var(--text-secondary)",
                  fontSize: "12px",
                  padding: "4px 10px",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontWeight: activeTab === CLAUDE_FILE_NAME ? 600 : 400,
                  display: "flex",
                  alignItems: "center",
                  gap: "4px",
                  transition: "all 0.15s ease",
                  boxShadow: activeTab === CLAUDE_FILE_NAME ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
                onClick={() => setActiveTab(CLAUDE_FILE_NAME)}
                title="项目全局说明文件（保存后自动同步 AGENTS.md）"
              >
                <span>{CLAUDE_FILE_NAME}</span>
              </button>
            </div>

            {isDirty && (
              <span style={{ color: "var(--color-primary)", fontWeight: "bold", fontSize: "14px" }} title="未保存">*</span>
            )}
          </div>

          {/* 右侧交互控制面板 */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            {/* 预设模板按钮 */}
            {activeTab === RULE_FILE_NAME && (
              <div style={{ position: "relative" }}>
                <button
                  style={{
                    border: "1px solid var(--border-color)",
                    background: "var(--bg-main)",
                    color: "var(--text-secondary)",
                    fontSize: "12px",
                    padding: "4px 8px",
                    borderRadius: "6px",
                    cursor: "pointer",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: "4px",
                    transition: "all 0.15s ease",
                  }}
                  onClick={() => setShowPresetMenu(!showPresetMenu)}
                  title="插入预设规则模板"
                >
                  <Sparkles size={12} color="var(--color-primary)" />
                  <span>模板</span>
                </button>

                {showPresetMenu && (
                  <div
                    style={{
                      position: "absolute",
                      right: 0,
                      top: "100%",
                      marginTop: "4px",
                      background: "var(--bg-sidebar)",
                      border: "1px solid var(--border-color)",
                      borderRadius: "6px",
                      boxShadow: "0 6px 18px rgba(0,0,0,0.3)",
                      zIndex: 100,
                      minWidth: "160px",
                      overflow: "hidden",
                      padding: "4px 0",
                    }}
                  >
                    {RULE_PRESETS.map((preset) => (
                      <button
                        key={preset.name}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          padding: "6px 12px",
                          background: "transparent",
                          border: "none",
                          color: "var(--text-primary)",
                          fontSize: "12px",
                          cursor: "pointer",
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-hover-item)")}
                        onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
                        onClick={() => handleApplyPreset(preset.content)}
                      >
                        {preset.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 视图切换：编辑 / 预览 */}
            <div style={{ display: "flex", background: "rgba(0, 0, 0, 0.08)", borderRadius: "6px", padding: "2px" }}>
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
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                  transition: "all 0.15s ease",
                  boxShadow: mode === "edit" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
                onClick={() => setMode("edit")}
              >
                <Edit3 size={11} />
                <span>编辑</span>
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
                  display: "flex",
                  alignItems: "center",
                  gap: "3px",
                  transition: "all 0.15s ease",
                  boxShadow: mode === "preview" ? "0 1px 2px rgba(0,0,0,0.08)" : "none",
                }}
                onClick={() => setMode("preview")}
              >
                <Eye size={11} />
                <span>预览</span>
              </button>
            </div>

            {/* 保存按钮 */}
            <button
              style={{
                border: "1px solid var(--border-color)",
                background: "var(--color-primary)",
                color: "#ffffff",
                fontSize: "12px",
                padding: "4px 12px",
                borderRadius: "6px",
                cursor: "pointer",
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                fontWeight: 600,
                transition: "all 0.2s ease",
                boxShadow: "0 1px 3px rgba(0, 0, 0, 0.15)",
              }}
              onClick={handleSave}
              disabled={isSaving}
            >
              <Save size={12} />
              <span>{isSaving ? "保存中..." : "保存"}</span>
            </button>

            {/* 关闭按钮 */}
            <button
              style={{
                border: "none",
                background: "transparent",
                color: "var(--text-secondary)",
                fontSize: "18px",
                lineHeight: 1,
                cursor: "pointer",
                padding: "4px",
                borderRadius: "4px",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
              }}
              onClick={onClose}
              title="关闭编辑器"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* 顶部关联说明微条 */}
        <div
          style={{
            padding: "6px 16px",
            background: "color-mix(in srgb, var(--color-primary) 8%, var(--bg-sidebar))",
            borderBottom: "1px solid var(--border-color)",
            fontSize: "11.5px",
            color: "var(--text-secondary)",
            display: "flex",
            alignItems: "center",
            gap: "6px",
          }}
        >
          <Link2 size={13} color="var(--color-primary)" />
          <span>
            {activeTab === RULE_FILE_NAME ? (
              <>
                保存 <strong style={{ color: "var(--text-primary)" }}>RULE.md</strong> 时，会自动在 <strong style={{ color: "var(--text-primary)" }}>CLAUDE.md</strong> 和 <strong style={{ color: "var(--text-primary)" }}>AGENTS.md</strong> 顶部安全建立强制遵循索引（完全保护原有内容）。
              </>
            ) : (
              <>
                编辑 <strong style={{ color: "var(--text-primary)" }}>CLAUDE.md</strong>，保存后将自动同步至 <strong style={{ color: "var(--text-primary)" }}>AGENTS.md</strong>。
              </>
            )}
          </span>
        </div>

        {/* 内容区 */}
        <div style={{ display: "flex", flex: 1, overflow: "hidden", background: "var(--bg-main)" }}>
          {/* 编辑态 */}
          {mode === "edit" && (
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder={`在这里输入内容...\n\n项目行为准则、代码质量底线、Git 规范等。\n保存后将自动挂载到 CLAUDE.md 中供 AI 执行。`}
              style={{
                flex: 1,
                border: "none",
                outline: "none",
                background: "transparent",
                color: "var(--text-primary)",
                fontFamily: "var(--font-mono, monospace)",
                fontSize: "13px",
                padding: "16px",
                resize: "none",
                lineHeight: "1.65",
                overflowY: "auto",
              }}
            />
          )}

          {/* 预览态 */}
          {mode === "preview" && (
            <div
              className="markdown-body"
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "20px 24px",
                background: "transparent",
                userSelect: "text",
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
            background: "var(--bg-sidebar)",
            fontSize: "11px",
            color: "var(--text-secondary)",
            userSelect: "none",
          }}
        >
          <div style={{ display: "flex", gap: "12px", alignItems: "center", minWidth: 0, flex: 1 }}>
            <span><kbd style={{ background: "rgba(255,255,255,0.08)", border: "1px solid var(--border-color)", padding: "1px 4px", borderRadius: "3px" }}>Ctrl+S</kbd> 保存并同步</span>
            <span><kbd style={{ background: "rgba(255,255,255,0.08)", border: "1px solid var(--border-color)", padding: "1px 4px", borderRadius: "3px" }}>Tab</kbd> 缩进</span>
            <span><kbd style={{ background: "rgba(255,255,255,0.08)", border: "1px solid var(--border-color)", padding: "1px 4px", borderRadius: "3px" }}>Esc</kbd> 关闭</span>
            {saveHint && (
              <span style={{ color: "var(--color-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "4px" }}>
                <CheckCircle2 size={12} />
                {saveHint}
              </span>
            )}
          </div>
          <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: "8px" }}>
            <span>{lineCount} 行</span>
            <span>·</span>
            <span>{charCount} 字符</span>
            <span>·</span>
            <span>UTF-8</span>
          </div>
        </div>
      </div>
    </div>
  );
};
