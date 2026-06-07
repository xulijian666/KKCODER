import React, { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ConfirmModal } from "./ConfirmModal";

export interface FileDiff {
  path: string;
  original: string;
  current: string;
  status: "added" | "deleted" | "modified";
}

// ── Unified diff 数据结构 ──────────────────────────────────────────────
type UnifiedLineType = "context" | "deleted" | "added" | "hunk-header";

interface UnifiedLine {
  type: UnifiedLineType;
  oldNum?: number;   // 原始行号（context / deleted）
  newNum?: number;   // 新版行号（context / added）
  content: string;
  hunkIdx: number;   // 所属 hunk 序号（hunk-header 的 hunkIdx 即自身索引，context 为 -1）
}

const CONTEXT_SIZE = 3; // 每段变更前后展示的上下文行数

// ── LCS → Unified diff 算法 ──────────────────────────────────────────
function buildUnifiedDiff(
  original: string,
  current: string
): { lines: UnifiedLine[]; hunkCount: number } {
  // 返回行数组及尾部换行标志（文件以 \n 结尾时 split 产生的末尾空串）
  const splitLines = (s: string): { lines: string[]; trailingNl: boolean } => {
    if (!s) return { lines: [], trailingNl: false };
    const arr = s.split(/\r?\n/);
    const trailingNl = arr.length > 0 && arr[arr.length - 1] === "";
    if (trailingNl) arr.pop();
    return { lines: arr, trailingNl };
  };

  const { lines: x, trailingNl: origNl } = splitLines(original);
  const { lines: y, trailingNl: currNl } = splitLines(current);
  const m = x.length;
  const n = y.length;

  if (m === 0 && n === 0) return { lines: [], hunkCount: 0 };
  // ── 纯新增文件：所有行都是 added ──
  if (m === 0) {
    const lines: UnifiedLine[] = [
      { type: "hunk-header", content: `@@ -0,0 +1,${n} @@`, hunkIdx: 0 },
      ...y.map((c, i) => ({
        type: "added" as UnifiedLineType,
        newNum: i + 1,
        content: c,
        hunkIdx: 0,
      })),
    ];
    return { lines, hunkCount: 1 };
  }

  // ── 纯删除文件：所有行都是 deleted ──
  if (n === 0) {
    const lines: UnifiedLine[] = [
      { type: "hunk-header", content: `@@ -1,${m} +0,0 @@`, hunkIdx: 0 },
      ...x.map((c, i) => ({
        type: "deleted" as UnifiedLineType,
        oldNum: i + 1,
        content: c,
        hunkIdx: 0,
      })),
    ];
    return { lines, hunkCount: 1 };
  }

  // ── LCS 动态规划 ──
  // 超大文件降级：逐行对比，避免 O(m×n) 内存爆炸
  interface RawOp {
    type: "equal" | "delete" | "insert";
    oldIdx: number; // 0-indexed
    newIdx: number; // 0-indexed
  }

  let ops: RawOp[];

  if (m * n > 4_000_000) {
    ops = [];
    const maxLen = Math.max(m, n);
    for (let k = 0; k < maxLen; k++) {
      if (k < m && k < n) {
        if (x[k] === y[k]) {
          ops.push({ type: "equal", oldIdx: k, newIdx: k });
        } else {
          ops.push({ type: "delete", oldIdx: k, newIdx: k });
          ops.push({ type: "insert", oldIdx: k, newIdx: k });
        }
      } else if (k < m) {
        ops.push({ type: "delete", oldIdx: k, newIdx: n - 1 });
      } else {
        ops.push({ type: "insert", oldIdx: m - 1, newIdx: k });
      }
    }
  } else {
    const dp: Uint32Array[] = Array.from(
      { length: m + 1 },
      () => new Uint32Array(n + 1)
    );
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] =
          x[i - 1] === y[j - 1]
            ? dp[i - 1][j - 1] + 1
            : Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }

    // 回溯
    const raw: RawOp[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && x[i - 1] === y[j - 1]) {
        raw.push({ type: "equal", oldIdx: i - 1, newIdx: j - 1 });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        raw.push({ type: "insert", oldIdx: i - 1, newIdx: j - 1 });
        j--;
      } else {
        raw.push({ type: "delete", oldIdx: i - 1, newIdx: j - 1 });
        i--;
      }
    }
    raw.reverse();
    ops = raw;
  }

  // ── 找出所有"有变化"的 op 索引，并分组为 hunk ──
  const changedIdx: number[] = ops
    .map((op, i) => (op.type !== "equal" ? i : -1))
    .filter((i) => i >= 0);

  if (changedIdx.length === 0) {
    // 行内容完全相同，但仅尾部换行不同时给出提示行
    if (origNl !== currNl) {
      const msg = currNl
        ? "\\ 新文件尾部新增了换行符"
        : "\\ 新文件尾部移除了换行符";
      return {
        lines: [
          { type: "hunk-header", content: `@@ -${m},0 +${n},0 @@`, hunkIdx: 0 },
          { type: currNl ? "added" : "deleted", content: msg, hunkIdx: 0 },
        ],
        hunkCount: 1,
      };
    }
    return { lines: [], hunkCount: 0 };
  }

  // 把紧邻的 changed ops 合并成 hunk（相邻 gap ≤ 2*CONTEXT_SIZE 时合并）
  const hunkRanges: { start: number; end: number }[] = [];
  let hs = changedIdx[0], he = changedIdx[0];
  for (let k = 1; k < changedIdx.length; k++) {
    const gap = changedIdx[k] - changedIdx[k - 1] - 1;
    if (gap > CONTEXT_SIZE * 2) {
      hunkRanges.push({ start: hs, end: he });
      hs = changedIdx[k];
    }
    he = changedIdx[k];
  }
  hunkRanges.push({ start: hs, end: he });

  // ── 生成 UnifiedLine 数组 ──
  // 维护 old/new 行号计数器
  let oldLine = 1, newLine = 1;
  // 先构建完整的 op 数组，带行号
  interface OpWithNums extends RawOp {
    dispOldNum: number;
    dispNewNum: number;
  }
  const opsWithNums: OpWithNums[] = [];
  let ol = 1, nl = 1;
  for (const op of ops) {
    if (op.type === "equal") {
      opsWithNums.push({ ...op, dispOldNum: ol, dispNewNum: nl });
      ol++; nl++;
    } else if (op.type === "delete") {
      opsWithNums.push({ ...op, dispOldNum: ol, dispNewNum: 0 });
      ol++;
    } else {
      opsWithNums.push({ ...op, dispOldNum: 0, dispNewNum: nl });
      nl++;
    }
  }
  void oldLine; void newLine;

  const result: UnifiedLine[] = [];

  for (let hi = 0; hi < hunkRanges.length; hi++) {
    const range = hunkRanges[hi];
    const sliceStart = Math.max(0, range.start - CONTEXT_SIZE);
    const sliceEnd = Math.min(opsWithNums.length - 1, range.end + CONTEXT_SIZE);
    const slice = opsWithNums.slice(sliceStart, sliceEnd + 1);

    // 计算 hunk header 里的行范围
    const firstOld = slice.find((o) => o.dispOldNum > 0)?.dispOldNum ?? 0;
    const firstNew = slice.find((o) => o.dispNewNum > 0)?.dispNewNum ?? 0;
    const oldCnt = slice.filter((o) => o.type !== "insert").length;
    const newCnt = slice.filter((o) => o.type !== "delete").length;

    result.push({
      type: "hunk-header",
      content: `@@ -${firstOld},${oldCnt} +${firstNew},${newCnt} @@`,
      hunkIdx: hi,
    });

    for (const op of slice) {
      if (op.type === "equal") {
        result.push({
          type: "context",
          oldNum: op.dispOldNum,
          newNum: op.dispNewNum,
          content: op.oldIdx >= 0 && op.oldIdx < x.length ? x[op.oldIdx] : "",
          hunkIdx: -1,
        });
      } else if (op.type === "delete") {
        result.push({
          type: "deleted",
          oldNum: op.dispOldNum,
          content: op.oldIdx >= 0 && op.oldIdx < x.length ? x[op.oldIdx] : "",
          hunkIdx: hi,
        });
      } else {
        result.push({
          type: "added",
          newNum: op.dispNewNum,
          content: op.newIdx >= 0 && op.newIdx < y.length ? y[op.newIdx] : "",
          hunkIdx: hi,
        });
      }
    }
  }

  // 尾部换行差异：在最后一个 hunk 末尾追加提示行
  if (origNl !== currNl && hunkRanges.length > 0) {
    const lastHunkIdx = hunkRanges.length - 1;
    const msg = currNl
      ? "\\ 新文件尾部新增了换行符"
      : "\\ 新文件尾部移除了换行符";
    result.push({
      type: currNl ? "added" : "deleted",
      content: msg,
      hunkIdx: lastHunkIdx,
    });
  }

  return { lines: result, hunkCount: hunkRanges.length };
}

// ── 组件 Props ────────────────────────────────────────────────────────
interface DiffPanelProps {
  sessionId: string;
  projectPath: string;
  isOpen: boolean;
  isFloat?: boolean;
  onClose: () => void;
  onToggleFloat?: () => void;
  modifiedFiles: FileDiff[];
  refreshTick?: number;
  onRefresh: () => void;
}

// ── 主组件 ────────────────────────────────────────────────────────────
export const DiffPanel: React.FC<DiffPanelProps> = ({
  sessionId,
  projectPath,
  isOpen,
  isFloat = false,
  onClose,
  onToggleFloat,
  modifiedFiles,
  refreshTick = 0,
  onRefresh,
}) => {
  const [panelHeight, setPanelHeight] = useState<number>(480);
  const [selectedFileIdx, setSelectedFileIdx] = useState<number>(0);
  const [searchFilter, setSearchFilter] = useState<string>("");
  const [selectedFileDetail, setSelectedFileDetail] = useState<FileDiff | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState<boolean>(false);
  const [currentHunk, setCurrentHunk] = useState<number>(0);
  const [confirmState, setConfirmState] = useState<{
    show: boolean;
    title: string;
    message: string | React.ReactNode;
    onConfirm: () => void;
    isDanger?: boolean;
  } | null>(null);

  const isResizing = useRef<boolean>(false);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  // 每个 hunk-header 行的 DOM ref，用于滚动导航
  const hunkRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // ── Esc 关闭 ──
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isOpen) {
        if (confirmState) {
          setConfirmState(null);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen, onClose, confirmState]);

  // ── 高度拖拽 ──
  const handleResizerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!isResizing.current) return;
      const h = window.innerHeight - e.clientY;
      if (h >= 180 && h <= window.innerHeight * 0.85) setPanelHeight(h);
    };
    const onUp = () => {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  // ── 过滤文件列表 ──
  const filteredFiles = modifiedFiles.filter((f) =>
    f.path.toLowerCase().includes(searchFilter.toLowerCase())
  );
  const currentFile = filteredFiles[selectedFileIdx] ?? null;

  // ── 按需加载文件详情 ──
  // refreshTick 每次 refreshDiff 成功后 +1，确保即使文件列表结构不变也能重新 fetch

  useEffect(() => {
    if (!isOpen || !currentFile) {
      setSelectedFileDetail(null);
      return;
    }
    let alive = true;
    setIsLoadingDetail(true);
    setCurrentHunk(0);
    hunkRefs.current.clear();

    invoke<FileDiff>("get_session_file_diff", {
      sessionId,
      projectPath,
      relativePath: currentFile.path,
    })
      .then((detail) => {
        if (alive) { setSelectedFileDetail(detail); setIsLoadingDetail(false); }
      })
      .catch(() => { if (alive) setIsLoadingDetail(false); });

    return () => { alive = false; };
  }, [currentFile?.path, sessionId, projectPath, isOpen, refreshTick]);

  // 切换文件时重置滚动
  useEffect(() => {
    if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    setCurrentHunk(0);
    hunkRefs.current.clear();
  }, [selectedFileIdx]);

  // ── Unified diff 计算 ──
  const { lines: unifiedLines, hunkCount } = selectedFileDetail
    ? buildUnifiedDiff(selectedFileDetail.original, selectedFileDetail.current)
    : { lines: [], hunkCount: 0 };

  // ── Hunk 导航 ──
  const scrollToHunk = useCallback((idx: number) => {
    const el = hunkRefs.current.get(idx);
    if (el && scrollContainerRef.current) {
      const containerTop = scrollContainerRef.current.getBoundingClientRect().top;
      const elTop = el.getBoundingClientRect().top;
      const targetScrollTop = scrollContainerRef.current.scrollTop + (elTop - containerTop) - 8;
      scrollContainerRef.current.scrollTo({
        top: targetScrollTop,
        behavior: "smooth",
      });
    }
  }, []);

  const goToPrevHunk = () => {
    if (hunkCount <= 1) return;
    const next = currentHunk === 0 ? hunkCount - 1 : currentHunk - 1;
    setCurrentHunk(next);
    scrollToHunk(next);
  };

  const goToNextHunk = () => {
    if (hunkCount <= 1) return;
    const next = currentHunk === hunkCount - 1 ? 0 : currentHunk + 1;
    setCurrentHunk(next);
    scrollToHunk(next);
  };

  // ── 撤销文件 ──
  const handleRevertFile = (e: React.MouseEvent, relativePath: string) => {
    e.stopPropagation();
    setConfirmState({
      show: true,
      title: "撤销修改",
      message: (
        <>
          确定要撤销文件「<strong style={{ color: "var(--color-orange)" }}>{relativePath}</strong>」在本次会话中的所有修改吗？
        </>
      ),
      isDanger: true,
      onConfirm: async () => {
        try {
          await invoke("revert_session_file", { sessionId, projectPath, relativePath });
          onRefresh();
          if (selectedFileIdx >= filteredFiles.length - 1)
            setSelectedFileIdx(Math.max(0, filteredFiles.length - 2));
        } catch (err) {
          alert(`撤销失败: ${err}`);
        }
        setConfirmState(null);
      },
    });
  };

  const handleCheckpoint = () => {
    if (modifiedFiles.length === 0) {
      alert("当前没有任何修改需要确认。");
      return;
    }
    setConfirmState({
      show: true,
      title: "确认变更",
      message: "确定要将当前所有修改确认为新基准吗？确认后之前的改动差异将被清零，重新开始记录后续修改。",
      isDanger: false,
      onConfirm: async () => {
        try {
          await invoke("checkpoint_session_diff", { sessionId, projectPath });
          onRefresh();
          setSelectedFileIdx(0);
        } catch (err) {
          alert(`确认修改失败: ${err}`);
        }
        setConfirmState(null);
      },
    });
  };

  if (!isOpen) return null;

  const panel = (
    <div
      className={`diff-panel-container${isFloat ? " diff-panel-float" : ""}`}
      style={isFloat ? undefined : { height: `${panelHeight}px` }}
    >
      {/* 拖拽把手（仅嵌入模式） */}
      {!isFloat && <div className="diff-panel-resizer" onMouseDown={handleResizerMouseDown} />}

      {/* 头部 */}
      <div className="diff-panel-header">
        <div className="diff-panel-title-area">
          <svg className="diff-panel-icon" xmlns="http://www.w3.org/2000/svg"
            width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z" />
          </svg>
          <span className="diff-panel-title">会话变更</span>
          <span className="diff-panel-subtitle">
            ({modifiedFiles.length} 个文件)
          </span>
        </div>
        <div className="diff-panel-actions">
          {/* 手动刷新 */}
          <button className="diff-panel-icon-btn" onClick={onRefresh} title="刷新变更列表">
            <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
              fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
              <path d="M3 3v5h5" />
            </svg>
          </button>
          {/* 嵌入 ↔ 浮动切换 */}
          {onToggleFloat && (
            <button className="diff-panel-icon-btn" onClick={onToggleFloat}
              title={isFloat ? "收起到底部" : "弹出独立窗口"}>
              {isFloat ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="4 14 10 14 10 20" /><polyline points="20 10 14 10 14 4" />
                  <line x1="10" y1="14" x2="3" y2="21" /><line x1="21" y1="3" x2="14" y2="10" />
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24"
                  fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="15 3 21 3 21 9" /><polyline points="9 21 3 21 3 15" />
                  <line x1="21" y1="3" x2="14" y2="10" /><line x1="3" y1="21" x2="10" y2="14" />
                </svg>
              )}
            </button>
          )}
          {modifiedFiles.length > 0 && (
            <button className="diff-panel-checkpoint-btn" onClick={handleCheckpoint} title="将当前所有修改确认为新基准（差异清零）">
              <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ marginRight: "4px" }}>
                <polyline points="20 6 9 17 4 12"></polyline>
              </svg>
              <span>确认变更</span>
            </button>
          )}
          <button className="diff-panel-close-btn" onClick={onClose} title="关闭面板 (Esc)">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"
              viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* 主体 */}
      <div className="diff-panel-body">
        {/* 左侧文件列表 */}
        <div className="diff-file-sidebar">
          <div className="diff-file-search-container">
            <input
              type="text"
              placeholder="搜索修改文件..."
              className="diff-file-search"
              value={searchFilter}
              onChange={(e) => { setSearchFilter(e.target.value); setSelectedFileIdx(0); }}
            />
          </div>
          <div className="diff-file-list">
            {filteredFiles.length === 0 ? (
              <div className="diff-empty-text">无匹配的改动文件</div>
            ) : (
              filteredFiles.map((file, idx) => {
                const parts = file.path.split(/[/\\]/);
                const fileName = parts.pop() || file.path;
                const folderPath = parts.join("/");
                const isSelected = idx === selectedFileIdx;
                return (
                  <div
                    key={file.path}
                    className={`diff-file-item ${isSelected ? "active" : ""}`}
                    onClick={() => setSelectedFileIdx(idx)}
                  >
                    <span className={`diff-file-status-tag ${file.status}`}>
                      {file.status[0].toUpperCase()}
                    </span>
                    <div className="diff-file-info">
                      <div className="diff-file-name">{fileName}</div>
                      {folderPath && <div className="diff-file-path">{folderPath}</div>}
                    </div>
                    <button
                      className="diff-file-revert-btn"
                      onClick={(e) => handleRevertFile(e, file.path)}
                      title="撤销此文件的修改"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12"
                        viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                        <path d="M3 3v5h5" />
                      </svg>
                    </button>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* 右侧：Unified Diff 视图 */}
        <div className="diff-viewer-container">
          {currentFile ? (
            <div className="diff-viewer-wrapper">
              {/* 文件头 + 导航按钮 */}
              <div className="diff-viewer-header">
                <span className="diff-viewer-file-path">{currentFile.path}</span>
                <span className={`diff-viewer-status-badge ${currentFile.status}`}>
                  {currentFile.status === "added" ? "新增"
                    : currentFile.status === "deleted" ? "已删除" : "已修改"}
                </span>

                {/* ↑↓ 跳转按钮 */}
                {!isLoadingDetail && hunkCount > 0 && (
                  <div className="diff-hunk-nav">
                    <button
                      className="diff-hunk-nav-btn"
                      onClick={goToPrevHunk}
                      disabled={hunkCount <= 1}
                      title="跳到上一处变更"
                    >↑</button>
                    <span className="diff-hunk-nav-label">
                      {currentHunk + 1} / {hunkCount} 处变更
                    </span>
                    <button
                      className="diff-hunk-nav-btn"
                      onClick={goToNextHunk}
                      disabled={hunkCount <= 1}
                      title="跳到下一处变更"
                    >↓</button>
                  </div>
                )}
              </div>

              {/* Diff 内容区 */}
              <div className="diff-viewport" ref={scrollContainerRef} key={currentFile?.path || ""}>
                {isLoadingDetail ? (
                  <div className="diff-viewer-placeholder" style={{ height: "100%", minHeight: "150px" }}>
                    <div className="tab-loading-spinner" style={{ marginBottom: "8px" }} />
                    <div>正在读取代码差异...</div>
                  </div>
                ) : unifiedLines.length === 0 ? (
                  <div className="diff-empty-code-text">无差异内容</div>
                ) : (
                  <div className="unified-diff-table">
                    {unifiedLines.map((line, rowIdx) => {
                      const isActiveHunk = line.hunkIdx === currentHunk;
                      
                      if (line.type === "hunk-header") {
                        // 从 @@ 内容里解析行号用于 gutter 展示
                        const match = line.content.match(/^@@\s+-(\d+)(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
                        const oldStart = match ? match[1] : "…";
                        const newStart = match ? match[2] : "…";

                        return (
                          <div
                            key={rowIdx}
                            className={`udiff-row udiff-hunk-header ${isActiveHunk ? "active-hunk" : ""}`}
                            ref={(el) => {
                              if (el) hunkRefs.current.set(line.hunkIdx, el);
                            }}
                          >
                            <span className="udiff-gutter-old udiff-hunk-gutter">{oldStart}</span>
                            <span className="udiff-gutter-new udiff-hunk-gutter">{newStart}</span>
                            <span className="udiff-indicator" />
                            <span className="udiff-content udiff-hunk-header-text" />
                          </div>
                        );
                      }

                      const indicator =
                        line.type === "deleted" ? "−"
                          : line.type === "added" ? "+"
                          : " ";

                      return (
                        <div
                          key={rowIdx}
                          className={`udiff-row udiff-${line.type} ${isActiveHunk ? "active-hunk-line" : ""}`}
                        >
                          <span className="udiff-gutter-old">
                            {line.type !== "added" ? (line.oldNum ?? "") : ""}
                          </span>
                          <span className="udiff-gutter-new">
                            {line.type !== "deleted" ? (line.newNum ?? "") : ""}
                          </span>
                          <span className="udiff-indicator">{indicator}</span>
                          <span className="udiff-content">{line.content}</span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="diff-viewer-placeholder">
              <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1"
                style={{ opacity: 0.3, marginBottom: "12px" }}>
                <path d="M16 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z" />
              </svg>
              <div>请在左侧选择文件以查看修改差异</div>
            </div>
          )}
        </div>
      </div>
      {confirmState && (
        <ConfirmModal
          show={confirmState.show}
          title={confirmState.title}
          message={confirmState.message}
          isDanger={confirmState.isDanger}
          onConfirm={confirmState.onConfirm}
          onCancel={() => setConfirmState(null)}
        />
      )}
    </div>
  );

  if (isFloat) {
    return (
      <div className="diff-panel-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
        {panel}
      </div>
    );
  }
  return panel;
};
