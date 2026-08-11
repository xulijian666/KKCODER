import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type Dispatch,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type SetStateAction,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { FileText, GripVertical, Maximize2, Minimize2, Pin, PinOff, ExternalLink } from "lucide-react";
import { renderMarkdownToHtml, buildMarkdownToc, type MarkdownTocEntry } from "../utils/markdown";
import { getHighlightedLines } from "../utils/highlighter";
import { formatFeedbackError, notifyError } from "../utils/appFeedback";
import { returnFocusToActiveTerminal } from "../utils/terminalFocus";

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

/**
 * 目录锚点跳转：只平滑滚动正文内容列，目录列保持不动。
 * 顶距留 12px 与 .md-h 的 scroll-margin-top 一致，避免标题贴顶。
 */
function scrollToMarkdownHeading(id: string): void {
  const content = document.querySelector<HTMLElement>(".preview-markdown-content");
  const target = document.getElementById(id);
  if (!content || !target) return;
  const contentRect = content.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  content.scrollTo({
    top: content.scrollTop + (targetRect.top - contentRect.top) - 12,
    behavior: "smooth",
  });
}

export type PreviewMode = "peek" | "dock" | "float";

export interface FloatRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const PREVIEW_MODE_STORAGE_KEY = "kkcoder_setting_preview_mode";
const PREVIEW_WIDTH_STORAGE_KEY = "kkcoder_setting_preview_width";
const PREVIEW_FLOAT_RECT_STORAGE_KEY = "kkcoder_setting_preview_float_rect";

const PREVIEW_RATIO_DEFAULT = 0.46;
const PREVIEW_RATIO_MIN = 0.3;
const PREVIEW_RATIO_MAX = 0.9;
const PREVIEW_RATIO_MAXIMIZED = 0.92;
const PREVIEW_FLOAT_MIN_WIDTH = 320;
const PREVIEW_FLOAT_MIN_HEIGHT = 200;

function clampPreviewRatio(value: number): number {
  return Math.max(PREVIEW_RATIO_MIN, Math.min(PREVIEW_RATIO_MAX, value));
}

function clampFloatRect(rect: FloatRect): FloatRect {
  return {
    x: Math.max(0, Math.min(rect.x, Math.max(0, window.innerWidth - rect.width))),
    y: Math.max(0, Math.min(rect.y, Math.max(0, window.innerHeight - 40))),
    width: Math.max(PREVIEW_FLOAT_MIN_WIDTH, Math.min(window.innerWidth, rect.width)),
    height: Math.max(PREVIEW_FLOAT_MIN_HEIGHT, Math.min(window.innerHeight, rect.height)),
  };
}

function readStoredPreviewMode(): PreviewMode {
  const saved = localStorage.getItem(PREVIEW_MODE_STORAGE_KEY);
  return saved === "dock" || saved === "float" ? saved : "peek";
}

function readStoredPreviewRatio(): number {
  const saved = localStorage.getItem(PREVIEW_WIDTH_STORAGE_KEY);
  const parsed = saved ? parseFloat(saved) : PREVIEW_RATIO_DEFAULT;
  return Number.isFinite(parsed) ? clampPreviewRatio(parsed) : PREVIEW_RATIO_DEFAULT;
}

function readStoredFloatRect(): FloatRect | null {
  const saved = localStorage.getItem(PREVIEW_FLOAT_RECT_STORAGE_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as FloatRect;
    if (
      parsed &&
      Number.isFinite(parsed.x) &&
      Number.isFinite(parsed.y) &&
      Number.isFinite(parsed.width) &&
      Number.isFinite(parsed.height) &&
      parsed.width > 0 &&
      parsed.height > 0
    ) {
      return clampFloatRect(parsed);
    }
  } catch {
    // 忽略损坏的持久化数据
  }
  return null;
}

function resolvePreviewContainer(): HTMLElement | null {
  const panel = document.querySelector(".file-preview-panel") as HTMLElement | null;
  return panel?.parentElement ?? null;
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

  // —— 预览表面三态：peek（瞬态浮层）/ dock（停靠分栏）/ float（自由卡片）——
  const [previewMode, setPreviewMode] = useState<PreviewMode>(readStoredPreviewMode);
  const [previewRatio, setPreviewRatio] = useState<number>(readStoredPreviewRatio);
  const [previewMaximized, setPreviewMaximized] = useState(false);
  const [floatRect, setFloatRect] = useState<FloatRect>(() => {
    const stored = readStoredFloatRect();
    return (
      stored ?? {
        x: 0,
        y: 0,
        width: PREVIEW_FLOAT_MIN_WIDTH,
        height: PREVIEW_FLOAT_MIN_HEIGHT,
      }
    );
  });
  const [isResizingPreview, setIsResizingPreview] = useState(false);
  const [isFloatDragging, setIsFloatDragging] = useState(false);
  const floatDragRef = useRef<{
    mode: "move" | "resize";
    startClientX: number;
    startClientY: number;
    startRect: FloatRect;
  } | null>(null);

  useEffect(() => {
    localStorage.setItem(PREVIEW_MODE_STORAGE_KEY, previewMode);
  }, [previewMode]);

  useEffect(() => {
    localStorage.setItem(PREVIEW_WIDTH_STORAGE_KEY, previewRatio.toString());
  }, [previewRatio]);

  useEffect(() => {
    if (floatRect.width > 0) {
      localStorage.setItem(PREVIEW_FLOAT_RECT_STORAGE_KEY, JSON.stringify(floatRect));
    }
  }, [floatRect]);

  const closePreview = useCallback(() => {
    setPreviewFile(null);
    setMarkdownMode("source");
    returnFocusToActiveTerminal();
  }, []);

  const resetPreviewRatio = useCallback(() => {
    setPreviewRatio(PREVIEW_RATIO_DEFAULT);
    setPreviewMaximized(false);
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
  }, []);

  const startPreviewResize = useCallback((event: ReactMouseEvent | ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget as HTMLElement;
    const pointerEvent = event.nativeEvent as PointerEvent;
    if (typeof pointerEvent.pointerId === "number" && target.setPointerCapture) {
      try {
        target.setPointerCapture(pointerEvent.pointerId);
      } catch {
        // 部分环境不支持 capture，仍走 document 监听
      }
    }
    setPreviewMaximized(false);
    setIsResizingPreview(true);
  }, []);

  useEffect(() => {
    if (!isResizingPreview) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";
    document.body.classList.add("preview-resizing");

    const handlePointerMove = (event: PointerEvent) => {
      const container = resolvePreviewContainer();
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      if (bounds.width <= 0) return;
      const ratio = clampPreviewRatio((bounds.right - event.clientX) / bounds.width);
      setPreviewRatio(ratio);
      window.dispatchEvent(new Event("resize"));
    };

    const handlePointerUp = () => {
      setIsResizingPreview(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("preview-resizing");
      window.setTimeout(() => window.dispatchEvent(new Event("resize")), 50);
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    document.addEventListener("mousemove", handlePointerMove as EventListener);
    document.addEventListener("mouseup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      document.removeEventListener("mousemove", handlePointerMove as EventListener);
      document.removeEventListener("mouseup", handlePointerUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("preview-resizing");
    };
  }, [isResizingPreview]);

  const startFloatDrag = useCallback((event: ReactMouseEvent | ReactPointerEvent) => {
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, a")) return;
    event.preventDefault();
    event.stopPropagation();
    floatDragRef.current = {
      mode: "move",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: floatRect,
    };
    setIsFloatDragging(true);
  }, [floatRect]);

  const startFloatResize = useCallback((event: ReactMouseEvent | ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    floatDragRef.current = {
      mode: "resize",
      startClientX: event.clientX,
      startClientY: event.clientY,
      startRect: floatRect,
    };
    setIsFloatDragging(true);
  }, [floatRect]);

  useEffect(() => {
    if (!isFloatDragging) return;

    document.body.style.userSelect = "none";
    document.body.style.cursor =
      floatDragRef.current?.mode === "move" ? "grabbing" : "nwse-resize";
    document.body.classList.add("preview-resizing");

    const handlePointerMove = (event: PointerEvent) => {
      const drag = floatDragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startClientX;
      const dy = event.clientY - drag.startClientY;
      if (drag.mode === "move") {
        const x = Math.max(
          0,
          Math.min(drag.startRect.x + dx, Math.max(0, window.innerWidth - drag.startRect.width)),
        );
        const y = Math.max(
          0,
          Math.min(drag.startRect.y + dy, Math.max(0, window.innerHeight - 40)),
        );
        setFloatRect({ ...drag.startRect, x, y });
      } else {
        const width = Math.max(
          PREVIEW_FLOAT_MIN_WIDTH,
          Math.min(window.innerWidth - drag.startRect.x, drag.startRect.width + dx),
        );
        const height = Math.max(
          PREVIEW_FLOAT_MIN_HEIGHT,
          Math.min(window.innerHeight - drag.startRect.y, drag.startRect.height + dy),
        );
        setFloatRect({ x: drag.startRect.x, y: drag.startRect.y, width, height });
      }
    };

    const handlePointerUp = () => {
      floatDragRef.current = null;
      setIsFloatDragging(false);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("preview-resizing");
    };

    document.addEventListener("pointermove", handlePointerMove);
    document.addEventListener("pointerup", handlePointerUp);
    document.addEventListener("pointercancel", handlePointerUp);
    document.addEventListener("mousemove", handlePointerMove as EventListener);
    document.addEventListener("mouseup", handlePointerUp);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", handlePointerUp);
      document.removeEventListener("pointercancel", handlePointerUp);
      document.removeEventListener("mousemove", handlePointerMove as EventListener);
      document.removeEventListener("mouseup", handlePointerUp);
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
      document.body.classList.remove("preview-resizing");
    };
  }, [isFloatDragging]);

  const togglePin = useCallback(() => {
    setPreviewMode((mode) => (mode === "dock" ? "peek" : "dock"));
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
  }, []);

  const toggleMaximize = useCallback(() => {
    setPreviewMaximized((value) => !value);
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
  }, []);

  const detachToFloat = useCallback(() => {
    const container = resolvePreviewContainer();
    const containerWidth = container?.getBoundingClientRect().width ?? window.innerWidth;
    const containerHeight = container?.getBoundingClientRect().height ?? window.innerHeight;
    setFloatRect((previous) => {
      if (previous.width > PREVIEW_FLOAT_MIN_WIDTH) return previous;
      const width = Math.min(containerWidth * 0.5, 640);
      const height = Math.min(containerHeight * 0.6, 520);
      return {
        x: Math.max(12, (window.innerWidth - width) / 2),
        y: Math.max(12, (window.innerHeight - height) / 2),
        width,
        height,
      };
    });
    setPreviewMaximized(false);
    setPreviewMode("float");
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
  }, []);

  const dockFromFloat = useCallback(() => {
    const container = resolvePreviewContainer();
    const containerWidth = container?.getBoundingClientRect().width ?? window.innerWidth;
    if (containerWidth > 0) {
      setPreviewRatio(clampPreviewRatio(floatRect.width / containerWidth));
    }
    setPreviewMaximized(false);
    setPreviewMode("dock");
    window.setTimeout(() => window.dispatchEvent(new Event("resize")), 40);
  }, [floatRect]);

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
          closePreview();
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
  }, [closePreview, insertSelectionToConversation, previewFile, showFileSearchBar, showGoToLineBar]);

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

  // Markdown 渲染只跟随预览文件变化：拖动宽度、文件内搜索、hover 等重渲染不再重复 parse + Prism 高亮
  const markdownHtml = useMemo(() => {
    if (!previewFile || previewFile.cannotPreview) return "";
    return renderMarkdownToHtml(previewFile.content);
  }, [previewFile]);

  // 目录导航：仅 .md 文件在预览模式下展示
  const tocEntries = useMemo(() => {
    if (!previewFile || previewFile.cannotPreview) return [];
    if (!previewFile.path.toLowerCase().endsWith(".md")) return [];
    return buildMarkdownToc(previewFile.content);
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
      markdownHtml,
      tocEntries,
      previewMode,
      previewRatio,
      previewMaximized,
      floatRect,
      onClose: closePreview,
      onContextMenu: handlePreviewContextMenu,
      onFileSearchChange: handleFileSearchChange,
      onGoToLine: handleGoToLine,
      setShowFileSearchBar,
      setFileSearchQuery,
      setShowGoToLineBar,
      setGoToLineNumber,
      setActiveMatchIndex,
      onTogglePin: togglePin,
      onToggleMaximize: toggleMaximize,
      onDetachToFloat: detachToFloat,
      onDockFromFloat: dockFromFloat,
      onStartPreviewResize: startPreviewResize,
      onResetPreviewRatio: resetPreviewRatio,
      onStartFloatDrag: startFloatDrag,
      onStartFloatResize: startFloatResize,
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
  markdownHtml: string;
  tocEntries: MarkdownTocEntry[];
  previewMode: PreviewMode;
  previewRatio: number;
  previewMaximized: boolean;
  floatRect: FloatRect;
  onClose: () => void;
  onContextMenu: (event: ReactMouseEvent) => void;
  onFileSearchChange: (query: string) => void;
  onGoToLine: () => void;
  setShowFileSearchBar: (show: boolean) => void;
  setFileSearchQuery: (query: string) => void;
  setShowGoToLineBar: (show: boolean) => void;
  setGoToLineNumber: (value: string) => void;
  setActiveMatchIndex: Dispatch<SetStateAction<number>>;
  onTogglePin: () => void;
  onToggleMaximize: () => void;
  onDetachToFloat: () => void;
  onDockFromFloat: () => void;
  onStartPreviewResize: (event: ReactMouseEvent | ReactPointerEvent) => void;
  onResetPreviewRatio: () => void;
  onStartFloatDrag: (event: ReactMouseEvent | ReactPointerEvent) => void;
  onStartFloatResize: (event: ReactMouseEvent | ReactPointerEvent) => void;
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
  markdownHtml,
  tocEntries,
  onClose,
  onContextMenu,
  onFileSearchChange,
  onGoToLine,
  setShowFileSearchBar,
  setFileSearchQuery,
  setShowGoToLineBar,
  setGoToLineNumber,
  setActiveMatchIndex,
  previewMode,
  previewRatio,
  previewMaximized,
  floatRect,
  onTogglePin,
  onToggleMaximize,
  onDetachToFloat,
  onDockFromFloat,
  onStartPreviewResize,
  onResetPreviewRatio,
  onStartFloatDrag,
  onStartFloatResize,
}) => {
  if (!previewFile) return null;

  const panelStyle: CSSProperties =
    previewMode === "float"
      ? {
          left: floatRect.x,
          top: floatRect.y,
          width: floatRect.width,
          height: floatRect.height,
        }
      : {
          width: `${(previewMaximized ? PREVIEW_RATIO_MAXIMIZED : previewRatio) * 100}%`,
          flexShrink: 0,
        };

  return (
    <div
      className={`file-preview-panel mode-${previewMode} ${previewMaximized ? "is-maximized" : ""}`}
      style={panelStyle}
      onContextMenu={onContextMenu}
    >
      {previewMode !== "float" && !previewMaximized && (
        <div
          className="preview-resize-handle"
          onPointerDown={onStartPreviewResize}
          onDoubleClick={onResetPreviewRatio}
          title="拖拽调整宽度 · 双击复位"
          role="separator"
          aria-orientation="vertical"
        />
      )}
      <div
        className="preview-header"
        onPointerDown={previewMode === "float" ? onStartFloatDrag : undefined}
        onDoubleClick={previewMode === "float" ? onDockFromFloat : undefined}
      >
        {previewMode === "float" && (
          <GripVertical size={14} className="preview-grip" />
        )}
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
        <div className="preview-actions">
          {previewMode !== "float" && (
            <button
              className="preview-action-btn"
              onClick={onToggleMaximize}
              title={previewMaximized ? "还原宽度" : "最大化阅读"}
            >
              {previewMaximized ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
            </button>
          )}
          {previewMode === "float" ? (
            <button
              className="preview-action-btn"
              onClick={onDockFromFloat}
              title="停靠回右侧"
            >
              <PinOff size={14} />
            </button>
          ) : (
            <button
              className={`preview-action-btn ${previewMode === "dock" ? "active" : ""}`}
              onClick={onTogglePin}
              title={previewMode === "dock" ? "取消钉住（瞬态浮层）" : "钉住为停靠分栏"}
            >
              {previewMode === "dock" ? <PinOff size={14} /> : <Pin size={14} />}
            </button>
          )}
          {previewMode !== "float" && (
            <button
              className="preview-action-btn"
              onClick={onDetachToFloat}
              title="浮出为自由卡片"
            >
              <ExternalLink size={14} />
            </button>
          )}
        </div>
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
                  notifyError(`打开文件失败：${formatFeedbackError(error)}`),
                );
              }}
            >
              直接打开文件
            </button>
          </div>
        ) : previewFile.path.endsWith(".md") && markdownMode === "preview" ? (
          <div className="preview-markdown-layout">
            {tocEntries.length > 1 && (
              <nav className="preview-toc" aria-label="目录">
                <div className="preview-toc-title">目录</div>
                <div className="preview-toc-list">
                  {tocEntries.map((entry, index) => (
                    <button
                      key={`${entry.id}-${index}`}
                      type="button"
                      className={`preview-toc-item depth-${Math.min(entry.depth, 3)}`}
                      title={entry.text}
                      onClick={() => scrollToMarkdownHeading(entry.id)}
                    >
                      {entry.text}
                    </button>
                  ))}
                </div>
              </nav>
            )}
            <div
              className="preview-markdown-content"
              dangerouslySetInnerHTML={{ __html: markdownHtml }}
            />
          </div>
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

      {previewMode === "float" && (
        <div
          className="preview-corner-handle"
          onPointerDown={onStartFloatResize}
          title="拖拽调整卡片大小"
        />
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
