import React, {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText } from "lucide-react";
import { renderMarkdownToHtml } from "../utils/markdown";
import { getHighlightedLines } from "../utils/highlighter";

export interface PreviewFileState {
  path: string;
  content: string;
  cannotPreview?: boolean;
  errorMsg?: string;
}

export interface PreviewContextMenuState {
  x: number;
  y: number;
  startLine: number;
  endLine: number;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getLineNumberFromNode(node: Node | null): number | null {
  let current: HTMLElement | null = node as HTMLElement;
  while (current && current !== document.body) {
    if (current.classList?.contains("preview-code-line")) {
      const attribute = current.getAttribute("data-line");
      return attribute ? parseInt(attribute, 10) : null;
    }
    current = current.parentElement;
  }
  return null;
}

function getSelectionLineRange(selection: Selection): { startLine: number; endLine: number } | null {
  let startLine = Infinity;
  let endLine = -Infinity;

  const anchorLine = getLineNumberFromNode(selection.anchorNode);
  const focusLine = getLineNumberFromNode(selection.focusNode);

  if (anchorLine !== null) {
    startLine = Math.min(startLine, anchorLine);
    endLine = Math.max(endLine, anchorLine);
  }
  if (focusLine !== null) {
    startLine = Math.min(startLine, focusLine);
    endLine = Math.max(endLine, focusLine);
  }

  try {
    document.querySelectorAll(".preview-code-line").forEach((lineElement) => {
      if (selection.containsNode(lineElement, true)) {
        const attribute = lineElement.getAttribute("data-line");
        if (attribute) {
          const lineNumber = parseInt(attribute, 10);
          startLine = Math.min(startLine, lineNumber);
          endLine = Math.max(endLine, lineNumber);
        }
      }
    });
  } catch {
    // Selection APIs can throw on detached nodes.
  }

  if (startLine === Infinity || endLine === -Infinity) return null;
  return { startLine, endLine };
}

function buildConversationTag(filePath: string, startLine: number, endLine: number): string {
  const rangeText = startLine === endLine ? `L${startLine}` : `L${startLine}-L${endLine}`;
  return `"${filePath}":${rangeText} `;
}

export interface UseFilePreviewOptions {
  projectPath: string | undefined;
  activeSessionId: string;
  onInsertConversationTag: (text: string) => void;
}

export function useFilePreview({
  projectPath,
  activeSessionId,
  onInsertConversationTag,
}: UseFilePreviewOptions) {
  const [previewFile, setPreviewFile] = useState<PreviewFileState | null>(null);
  const [markdownMode, setMarkdownMode] = useState<"preview" | "source">("source");
  const [previewFontFamily, setPreviewFontFamily] = useState<string>(() => {
    return localStorage.getItem("kkcoder_setting_preview_font_family") || "monospace";
  });
  const [previewFontSize, setPreviewFontSize] = useState<number>(() => {
    const value = localStorage.getItem("kkcoder_setting_preview_font_size");
    return value ? parseFloat(value) : 12.5;
  });
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const [showFileSearchBar, setShowFileSearchBar] = useState(false);
  const [showGoToLineBar, setShowGoToLineBar] = useState(false);
  const [goToLineNumber, setGoToLineNumber] = useState("");
  const [activeMatchIndex, setActiveMatchIndex] = useState(0);
  const [matchedLines, setMatchedLines] = useState<number[]>([]);
  const [previewContextMenu, setPreviewContextMenu] = useState<PreviewContextMenuState | null>(null);

  useEffect(() => {
    const handleFontChange = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      setPreviewFontFamily(customEvent.detail || "monospace");
    };
    const handleFontSizeChange = (event: Event) => {
      const customEvent = event as CustomEvent<number>;
      setPreviewFontSize(customEvent.detail || 12.5);
    };
    window.addEventListener("kkcoder-preview-font-change", handleFontChange);
    window.addEventListener("kkcoder-preview-font-size-change", handleFontSizeChange);
    return () => {
      window.removeEventListener("kkcoder-preview-font-change", handleFontChange);
      window.removeEventListener("kkcoder-preview-font-size-change", handleFontSizeChange);
    };
  }, []);

  useEffect(() => {
    setPreviewFile(null);
  }, [projectPath]);

  useEffect(() => {
    const closeMenu = () => setPreviewContextMenu(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, []);

  useEffect(() => {
    if (matchedLines.length > 0 && activeMatchIndex >= 0 && activeMatchIndex < matchedLines.length) {
      const lineNumber = matchedLines[activeMatchIndex];
      const element = document.querySelector(`.preview-code-line[data-line="${lineNumber}"]`);
      element?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeMatchIndex, matchedLines]);

  const insertSelectionToConversation = useCallback(
    (selection: Selection) => {
      if (!previewFile || !activeSessionId) return;
      const range = getSelectionLineRange(selection);
      if (!range) return;
      onInsertConversationTag(buildConversationTag(previewFile.path, range.startLine, range.endLine));
    },
    [activeSessionId, onInsertConversationTag, previewFile],
  );

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (showFileSearchBar) {
          setShowFileSearchBar(false);
          setFileSearchQuery("");
          event.preventDefault();
          event.stopPropagation();
        } else if (showGoToLineBar) {
          setShowGoToLineBar(false);
          setGoToLineNumber("");
          event.preventDefault();
          event.stopPropagation();
        } else if (previewFile) {
          setPreviewFile(null);
          setMarkdownMode("source");
          event.preventDefault();
          event.stopPropagation();
        }
        return;
      }

      if (!previewFile) return;

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
        const selection = window.getSelection();
        const previewPanel = document.querySelector(".file-preview-panel");
        if (previewPanel && selection?.anchorNode && previewPanel.contains(selection.anchorNode)) {
          event.preventDefault();
          event.stopPropagation();
          const targetElement =
            document.querySelector(".preview-markdown-content") ||
            document.querySelector(".preview-text-content") ||
            document.querySelector(".preview-body");
          if (targetElement) {
            const range = document.createRange();
            range.selectNodeContents(targetElement);
            selection.removeAllRanges();
            selection.addRange(range);
          }
        }
        return;
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        setShowFileSearchBar(true);
        setShowGoToLineBar(false);
        setTimeout(() => document.getElementById("file-search-input")?.focus(), 50);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g") {
        event.preventDefault();
        setShowGoToLineBar(true);
        setShowFileSearchBar(false);
        setTimeout(() => document.getElementById("go-to-line-input")?.focus(), 50);
      }

      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "u") {
        const selection = window.getSelection();
        if (selection && !selection.isCollapsed) {
          event.preventDefault();
          insertSelectionToConversation(selection);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, [insertSelectionToConversation, previewFile, showFileSearchBar, showGoToLineBar]);

  const openFile = useCallback(
    async (relativePath: string) => {
      if (!projectPath) return;
      setMarkdownMode("source");

      if (relativePath.toLowerCase().endsWith(".svg")) {
        setPreviewFile({
          path: relativePath,
          content: "",
          cannotPreview: true,
          errorMsg: "SVG 文件预览已禁用。",
        });
        return;
      }

      try {
        const content = await invoke<string>("read_project_file_content", {
          projectPath,
          relativePath,
        });
        setPreviewFile({ path: relativePath, content, cannotPreview: false });
      } catch (error: unknown) {
        setPreviewFile({
          path: relativePath,
          content: "",
          cannotPreview: true,
          errorMsg: error ? String(error) : "无法读取此文件，可能是二进制文件或非UTF-8编码。",
        });
      }
    },
    [projectPath],
  );

  const handlePathRenamed = useCallback((oldPath: string, newPath: string) => {
    setPreviewFile((previous) => {
      if (!previous) return previous;
      if (previous.path === oldPath) return { ...previous, path: newPath };
      if (previous.path.startsWith(`${oldPath}/`)) {
        return { ...previous, path: `${newPath}${previous.path.slice(oldPath.length)}` };
      }
      return previous;
    });
  }, []);

  const handleFileSearchChange = (query: string) => {
    setFileSearchQuery(query);
    if (!query.trim() || !previewFile) {
      setMatchedLines([]);
      setActiveMatchIndex(0);
      return;
    }
    const lines = previewFile.content.split("\n");
    const matched: number[] = [];
    const lowerQuery = query.toLowerCase();
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(lowerQuery)) matched.push(index + 1);
    });
    setMatchedLines(matched);
    setActiveMatchIndex(matched.length > 0 ? 0 : -1);
  };

  const handleGoToLine = () => {
    const lineNumber = parseInt(goToLineNumber, 10);
    if (Number.isNaN(lineNumber) || !previewFile) return;
    const totalLines = previewFile.content.split("\n").length;
    const target = Math.max(1, Math.min(totalLines, lineNumber));
    const element = document.querySelector(`.preview-code-line[data-line="${target}"]`);
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      element.classList.add("line-highlight-pulse");
      setTimeout(() => element.classList.remove("line-highlight-pulse"), 1500);
    }
    setShowGoToLineBar(false);
    setGoToLineNumber("");
  };

  const handlePreviewContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed || !previewFile) return;

      const range = selection.getRangeAt(0);
      let current: HTMLElement | null = range.commonAncestorContainer as HTMLElement;
      let isInsidePreview = false;
      while (current && current !== document.body) {
        if (current.classList?.contains("preview-body") || current.classList?.contains("file-preview-panel")) {
          isInsidePreview = true;
          break;
        }
        current = current.parentElement;
      }
      if (!isInsidePreview) return;

      event.preventDefault();
      event.stopPropagation();

      const lineRange = getSelectionLineRange(selection);
      if (!lineRange) return;

      let menuX = event.clientX;
      let menuY = event.clientY;
      if (menuX + 160 > window.innerWidth) menuX = Math.max(0, menuX - 160);

      setPreviewContextMenu({
        x: menuX,
        y: menuY,
        startLine: lineRange.startLine,
        endLine: lineRange.endLine,
      });
    },
    [previewFile],
  );

  const highlightedData = useMemo(() => {
    if (!previewFile || previewFile.cannotPreview) return { tokens: [] as unknown[][], isPlain: true };
    return getHighlightedLines(previewFile.content, previewFile.path);
  }, [previewFile]);

  return {
    previewFile,
    openFile,
    handlePathRenamed,
    panelProps: {
      previewFile,
      projectPath,
      markdownMode,
      setMarkdownMode,
      previewFontFamily,
      previewFontSize,
      fileSearchQuery,
      showFileSearchBar,
      showGoToLineBar,
      goToLineNumber,
      activeMatchIndex,
      matchedLines,
      highlightedData,
      onClose: () => {
        setPreviewFile(null);
        setMarkdownMode("source");
      },
      onContextMenu: handlePreviewContextMenu,
      onFileSearchChange: handleFileSearchChange,
      onGoToLine: handleGoToLine,
      setShowFileSearchBar,
      setFileSearchQuery,
      setShowGoToLineBar,
      setGoToLineNumber,
      setActiveMatchIndex,
    },
    contextMenuProps: {
      previewContextMenu,
      previewFile,
      onInsertConversationTag,
      onClose: () => setPreviewContextMenu(null),
    },
  };
}

export interface FilePreviewPanelProps {
  previewFile: PreviewFileState | null;
  projectPath: string | undefined;
  markdownMode: "preview" | "source";
  setMarkdownMode: (mode: "preview" | "source") => void;
  previewFontFamily: string;
  previewFontSize: number;
  fileSearchQuery: string;
  showFileSearchBar: boolean;
  showGoToLineBar: boolean;
  goToLineNumber: string;
  activeMatchIndex: number;
  matchedLines: number[];
  highlightedData: { tokens: unknown[][]; isPlain?: boolean };
  onClose: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onFileSearchChange: (query: string) => void;
  onGoToLine: () => void;
  setShowFileSearchBar: (show: boolean) => void;
  setFileSearchQuery: (query: string) => void;
  setShowGoToLineBar: (show: boolean) => void;
  setGoToLineNumber: (value: string) => void;
  setActiveMatchIndex: Dispatch<SetStateAction<number>>;
}

function renderHighlightedLineText(lineText: string, fileSearchQuery: string) {
  if (!fileSearchQuery.trim()) return lineText || " ";
  const parts = lineText.split(new RegExp(`(${escapeRegExp(fileSearchQuery)})`, "gi"));
  return (
    <>
      {parts.map((part, index) =>
        part.toLowerCase() === fileSearchQuery.toLowerCase() ? (
          <mark key={index} className="search-highlight-mark">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function renderToken(
  token: { type?: string; content: string | Array<{ type?: string; content: string }> },
  key: string | number,
  fileSearchQuery: string,
): React.ReactNode {
  if (!token.type) {
    return renderHighlightedLineText(String(token.content ?? ""), fileSearchQuery);
  }
  const content = Array.isArray(token.content)
    ? token.content.map((child, index) => renderToken(child as typeof token, index, fileSearchQuery))
    : renderHighlightedLineText(String(token.content ?? ""), fileSearchQuery);
  return (
    <span key={key} className={`token ${token.type}`}>
      {content}
    </span>
  );
}

export const FilePreviewPanel: React.FC<FilePreviewPanelProps> = ({
  previewFile,
  projectPath,
  markdownMode,
  setMarkdownMode,
  previewFontFamily,
  previewFontSize,
  fileSearchQuery,
  showFileSearchBar,
  showGoToLineBar,
  goToLineNumber,
  activeMatchIndex,
  matchedLines,
  highlightedData,
  onClose,
  onContextMenu,
  onFileSearchChange,
  onGoToLine,
  setShowFileSearchBar,
  setFileSearchQuery,
  setShowGoToLineBar,
  setGoToLineNumber,
  setActiveMatchIndex,
}) => {
  if (!previewFile) return null;

  return (
    <div className="file-preview-panel" onContextMenu={onContextMenu}>
      <div className="preview-header">
        <div className="preview-title-area">
          <FileText size={14} className="preview-file-icon" />
          <span className="preview-file-name" title={previewFile.path.split("/").pop()}>
            {previewFile.path.split("/").pop()}
          </span>
          <span className="preview-file-path" title={previewFile.path}>
            {previewFile.path}
          </span>
        </div>
        {previewFile.path.endsWith(".md") && !previewFile.cannotPreview && (
          <div className="preview-md-tabs">
            <button
              className={`preview-md-tab ${markdownMode === "preview" ? "active" : ""}`}
              onClick={() => setMarkdownMode("preview")}
            >
              预览
            </button>
            <button
              className={`preview-md-tab ${markdownMode === "source" ? "active" : ""}`}
              onClick={() => setMarkdownMode("source")}
            >
              源码
            </button>
          </div>
        )}
        <button className="preview-close-btn" onClick={onClose} title="关闭文件预览">
          ×
        </button>
      </div>
      <div className="preview-body">
        {previewFile.cannotPreview ? (
          <div className="preview-error-container">
            <div className="preview-error-icon">⚠️</div>
            <div className="preview-error-title">该文件不支持直接预览</div>
            <div className="preview-error-detail">
              {previewFile.errorMsg || "可能该文件是二进制文件，或者其编码不支持。"}
            </div>
            <button
              className="preview-open-system-btn"
              onClick={() => {
                const separator =
                  projectPath?.endsWith("/") || projectPath?.endsWith("\\") ? "" : "/";
                const absolutePath = `${projectPath}${separator}${previewFile.path}`;
                invoke("open_file_in_system", { path: absolutePath }).catch((error) =>
                  alert(`打开文件失败: ${error}`),
                );
              }}
            >
              直接打开文件
            </button>
          </div>
        ) : previewFile.path.endsWith(".md") && markdownMode === "preview" ? (
          <div
            className="preview-markdown-content"
            dangerouslySetInnerHTML={{ __html: renderMarkdownToHtml(previewFile.content) }}
          />
        ) : (
          <div
            className="preview-text-content"
            style={{
              fontFamily: previewFontFamily,
              fontSize: `${previewFontSize}px`,
            }}
          >
            {highlightedData.tokens.map((lineTokens, index) => {
              const lineNumber = index + 1;
              const isActiveMatchLine =
                matchedLines.length > 0 &&
                activeMatchIndex >= 0 &&
                activeMatchIndex < matchedLines.length &&
                matchedLines[activeMatchIndex] === lineNumber;
              return (
                <div
                  key={index}
                  className={`preview-code-line ${isActiveMatchLine ? "active-match-line" : ""}`}
                  data-line={lineNumber}
                >
                  <span className="line-number">{lineNumber}</span>
                  <span className="line-text">
                    {lineTokens.length === 0
                      ? " "
                      : lineTokens.map((token, tokenIndex) =>
                          renderToken(
                            token as { type?: string; content: string },
                            tokenIndex,
                            fileSearchQuery,
                          ),
                        )}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {showFileSearchBar && (
        <div className="file-search-bar-floating">
          <input
            id="file-search-input"
            type="text"
            placeholder="查找内容..."
            className="file-search-bar-input"
            value={fileSearchQuery}
            onChange={(event) => onFileSearchChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                if (event.shiftKey) {
                  if (matchedLines.length > 0) {
                    setActiveMatchIndex(
                      (previous) => (previous - 1 + matchedLines.length) % matchedLines.length,
                    );
                  }
                } else if (matchedLines.length > 0) {
                  setActiveMatchIndex((previous) => (previous + 1) % matchedLines.length);
                }
              }
            }}
          />
          <span className="file-search-bar-count">
            {matchedLines.length > 0 ? `${activeMatchIndex + 1}/${matchedLines.length}` : "0/0"}
          </span>
          <button
            className="file-search-bar-nav-btn"
            onClick={() => {
              if (matchedLines.length > 0) {
                setActiveMatchIndex(
                  (previous) => (previous - 1 + matchedLines.length) % matchedLines.length,
                );
              }
            }}
            title="上一个"
          >
            ▲
          </button>
          <button
            className="file-search-bar-nav-btn"
            onClick={() => {
              if (matchedLines.length > 0) {
                setActiveMatchIndex((previous) => (previous + 1) % matchedLines.length);
              }
            }}
            title="下一个"
          >
            ▼
          </button>
          <button
            className="file-search-bar-close-btn"
            onClick={() => {
              setShowFileSearchBar(false);
              setFileSearchQuery("");
            }}
          >
            ×
          </button>
        </div>
      )}

      {showGoToLineBar && (
        <div className="file-search-bar-floating go-to-line-bar">
          <input
            id="go-to-line-input"
            type="text"
            placeholder="输入行号并回车..."
            className="file-search-bar-input"
            value={goToLineNumber}
            onChange={(event) => setGoToLineNumber(event.target.value.replace(/\D/g, ""))}
            onKeyDown={(event) => {
              if (event.key === "Enter") onGoToLine();
            }}
          />
          <button className="file-search-bar-go-btn" onClick={onGoToLine}>
            跳转
          </button>
          <button
            className="file-search-bar-close-btn"
            onClick={() => {
              setShowGoToLineBar(false);
              setGoToLineNumber("");
            }}
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
};

export interface FilePreviewContextMenuProps {
  previewContextMenu: PreviewContextMenuState | null;
  previewFile: PreviewFileState | null;
  onInsertConversationTag: (text: string) => void;
  onClose: () => void;
}

export const FilePreviewContextMenu: React.FC<FilePreviewContextMenuProps> = ({
  previewContextMenu,
  previewFile,
  onInsertConversationTag,
  onClose,
}) => {
  if (!previewContextMenu || !previewFile) return null;

  return (
    <div
      className="tree-context-menu"
      style={{
        position: "fixed",
        left: `${previewContextMenu.x}px`,
        top: `${previewContextMenu.y}px`,
        zIndex: 9999,
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        onClick={() => {
          onInsertConversationTag(
            buildConversationTag(
              previewFile.path,
              previewContextMenu.startLine,
              previewContextMenu.endLine,
            ),
          );
          onClose();
        }}
      >
        添加到对话
      </button>
    </div>
  );
};
