import React, { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  BrainCircuit,
  Check,
  ChevronDown,
  ChevronRight,
  CircleCheck,
  CircleX,
  Command,
  Copy,
  File,
  FileText,
  Folder,
  PencilLine,
  Search,
  Send,
  Sparkles,
  Square,
  Terminal as TerminalIcon,
  Wrench,
  X,
} from "lucide-react";
import { renderChatMarkdownToHtml } from "../utils/markdown";
import { formatFeedbackError } from "../utils/appFeedback";
import { isEditableFocusTarget } from "../utils/terminalFocus";
import { generateUUID } from "../utils/uuid";
import { log } from "../utils/log";
import {
  detectChatCompletionTrigger,
  replaceChatCompletionTrigger,
  type ChatCompletionTrigger,
} from "../utils/chatCompletion";

const CHAT_EVENT_CHANNEL = "claude-chat-event";

interface ChatTabProps {
  sessionId: string;
  directory: string;
  agentSessionId: string;
  isActive?: boolean;
  onSpawned?: () => void;
  onStateChange?: (busy: boolean) => void;
  onCommandComplete?: () => void;
  onUserSubmittedInput?: (sessionId: string, submittedAt?: string) => void;
}

interface ToolCardData {
  id: string;
  name: string;
  input?: unknown;
  status: "running" | "done" | "error";
  output?: string;
  error?: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  reasoning?: string;
  tools: ToolCardData[];
  status: "streaming" | "done" | "error";
  costUsd?: number;
  error?: string;
  images?: ChatImageAttachment[];
  contextUsage?: ContextUsageData | null;
}

/** 后端 claude-chat-event 的扁平载荷（字段按需出现） */
interface ChatStreamEvent {
  sessionId: string;
  type: string;
  text?: string;
  toolId?: string;
  toolName?: string;
  input?: unknown;
  output?: string;
  error?: string;
  message?: string;
  costUsd?: number;
  isError?: boolean;
  requestId?: string;
  questions?: ChatQuestion[];
}

interface CompletionEntry {
  kind: "file" | "directory" | "command" | "skill";
  name: string;
  description?: string;
  source: string;
  path?: string;
  isDir: boolean;
}

interface ChatQuestionOption {
  label: string;
  description?: string;
}

interface ChatQuestion {
  id: string;
  question: string;
  header?: string;
  multiSelect?: boolean;
  options: ChatQuestionOption[];
}

interface PendingQuestionRequest {
  requestId: string;
  questions: ChatQuestion[];
}

/** 后端 chat_get_context_usage 返回的归一化 token 用量 */
interface ContextUsageBreakdown {
  input: number;
  cached: number;
  output: number;
}

interface ContextUsageData {
  threadId?: string | null;
  model?: string | null;
  last?: ContextUsageBreakdown | null;
  session?: ContextUsageBreakdown | null;
  contextWindow?: number | null;
  /** Claude context_window 实时遥测：已用上下文、已用/剩余百分比 */
  contextUsed?: number | null;
  contextUsedPercent?: number | null;
  contextRemainingPercent?: number | null;
}

const CONTEXT_COLORS = {
  input: "#4f8cff",
  cached: "#22c55e",
  output: "#f59e0b",
};

const ContextUsageCard: React.FC<{ data: ContextUsageData | null }> = ({ data }) => {
  const [copied, setCopied] = useState(false);
  const fmt = (value: number) =>
    Math.max(0, Math.round(value)).toLocaleString("en-US");
  const pct = (value: number, total: number) =>
    total > 0 ? `${((value / total) * 100).toFixed(1)}%` : "0%";

  const last = data?.last;
  const session = data?.session;
  const sessionTotal = session
    ? (session.input ?? 0) + (session.cached ?? 0) + (session.output ?? 0)
    : 0;
  const lastUsed = last ? (last.input ?? 0) + (last.cached ?? 0) : 0;
  const sessionUsed = session ? (session.input ?? 0) + (session.cached ?? 0) : 0;
  // 优先用 Claude 实时遥测的已用上下文，回退到 last/session 估算
  const used =
    data?.contextUsed != null && data.contextUsed > 0
      ? data.contextUsed
      : lastUsed > 0
        ? lastUsed
        : sessionUsed > 0
          ? sessionUsed
          : null;
  const windowSize = data?.contextWindow ?? null;
  const usedPercent =
    data?.contextUsedPercent != null
      ? data.contextUsedPercent
      : windowSize && windowSize > 0 && used != null
        ? Math.min(Math.max((used / windowSize) * 100, 0), 100)
        : null;
  const remaining =
    data?.contextRemainingPercent != null
      ? data.contextRemainingPercent
      : usedPercent != null
        ? Math.max(0, 100 - usedPercent)
        : null;

  const segments = session
    ? [
        { label: "输入", value: session.input ?? 0, color: CONTEXT_COLORS.input },
        { label: "缓存输入", value: session.cached ?? 0, color: CONTEXT_COLORS.cached },
        { label: "输出", value: session.output ?? 0, color: CONTEXT_COLORS.output },
      ]
    : [];

  const donutStyle: React.CSSProperties =
    sessionTotal > 0
      ? (() => {
          let acc = 0;
          const stops = segments.map((s) => {
            const start = (acc / sessionTotal) * 100;
            acc += s.value;
            const end = (acc / sessionTotal) * 100;
            return `${s.color} ${start}% ${end}%`;
          });
          return { background: `conic-gradient(${stops.join(", ")})` };
        })()
      : { background: "var(--bg-hover)" };

  const copyThread = () => {
    if (!data?.threadId) return;
    navigator.clipboard?.writeText(data.threadId).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1200);
  };

  if (!data || !session) {
    return (
      <div className="chat-context-card">
        <div className="chat-context-head">
          <div>
            <span className="chat-context-kicker">/context</span>
            <strong>上下文用量</strong>
          </div>
        </div>
        <div className="chat-context-empty">
          暂无该会话的用量数据，发送至少一轮后再试。
        </div>
      </div>
    );
  }

  const metric = (label: string, value: string) => (
    <div className="chat-context-metric">
      <span className="chat-context-metric-label">{label}</span>
      <span className="chat-context-metric-value">{value}</span>
    </div>
  );

  const rows = (title: string, items: Array<{ label: string; value: number }>) => (
    <div className="chat-context-section">
      <div className="chat-context-section-title">{title}</div>
      {items.map((item) => (
        <div className="chat-context-row" key={item.label}>
          <span>{item.label}</span>
          <span>{fmt(item.value)}</span>
        </div>
      ))}
    </div>
  );

  return (
    <div className="chat-context-card">
      <div className="chat-context-head">
        <div>
          <span className="chat-context-kicker">/context</span>
          <strong>上下文用量</strong>
        </div>
        {data.model && (
          <span className="chat-context-model" title={data.model}>
            {data.model}
          </span>
        )}
        {data.threadId && (
          <button
            type="button"
            className="chat-context-thread"
            onClick={copyThread}
            title="复制会话 ID"
          >
            {copied ? "已复制" : `${data.threadId.slice(0, 8)}…`}
          </button>
        )}
      </div>

      <div className="chat-context-main">
        <div className="chat-context-donut" style={donutStyle}>
          <div className="chat-context-donut-hole">
            <span className="chat-context-donut-value">{fmt(sessionTotal)}</span>
            <span className="chat-context-donut-label">总 token</span>
          </div>
        </div>
        <div className="chat-context-legend">
          {segments.map((s) => (
            <div className="chat-context-legend-item" key={s.label}>
              <span className="chat-context-dot" style={{ background: s.color }} />
              <span className="chat-context-legend-label">{s.label}</span>
              <span className="chat-context-legend-value">{fmt(s.value)}</span>
              <span className="chat-context-legend-pct">{pct(s.value, sessionTotal)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="chat-context-metrics">
        {metric("已用上下文", used != null ? fmt(used) : "n/a")}
        {metric("上下文窗口", windowSize && windowSize > 0 ? fmt(windowSize) : "n/a")}
        {metric("已用占比", usedPercent != null ? `${usedPercent.toFixed(1)}%` : "n/a")}
        {metric("剩余", remaining != null ? `${remaining.toFixed(1)}%` : "n/a")}
      </div>

      <div className="chat-context-sections">
        {rows("最近一轮明细", [
          { label: "输入", value: last?.input ?? 0 },
          { label: "缓存输入", value: last?.cached ?? 0 },
          { label: "输出", value: last?.output ?? 0 },
        ])}
        {rows("会话累计", [
          { label: "输入", value: session.input ?? 0 },
          { label: "缓存输入", value: session.cached ?? 0 },
          { label: "输出", value: session.output ?? 0 },
          { label: "总 token", value: sessionTotal },
        ])}
      </div>
    </div>
  );
};

interface ChatImageAttachment {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
}

const MAX_CHAT_IMAGES = 5;
const MAX_CHAT_IMAGE_BYTES = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

type ChatAction =
  | { type: "history"; messages: ChatMessage[] }
  | { type: "user:sent"; text: string; id: string; images: ChatImageAttachment[] }
  | { type: "assistant:local"; text: string; contextUsage?: ContextUsageData | null }
  | { type: "send:failed"; id: string; message: string }
  | { type: "turn:started" }
  | { type: "text:delta"; text: string }
  | { type: "reasoning:delta"; text: string }
  | { type: "tool:started"; card: ToolCardData }
  | { type: "tool:input"; id: string; input?: unknown }
  | { type: "tool:completed"; id: string; name?: string; output?: string; error?: string }
  | { type: "turn:finished"; costUsd?: number; isError?: boolean }
  | { type: "turn:error"; message: string };

function patchLast(
  state: ChatMessage[],
  fn: (m: ChatMessage) => ChatMessage,
): ChatMessage[] {
  if (state.length === 0) return state;
  const next = state.slice();
  const last = next[next.length - 1];
  if (last.role !== "assistant") return state;
  next[next.length - 1] = fn(last);
  return next;
}

function messagesReducer(state: ChatMessage[], action: ChatAction): ChatMessage[] {
  switch (action.type) {
    case "history":
      return action.messages;
    case "user:sent":
      return [
        ...state,
        {
          id: action.id,
          role: "user",
          text: action.text,
          tools: [],
          status: "done",
          images: action.images,
        },
      ];
    case "send:failed":
      return state.map((m) =>
        m.id === action.id ? { ...m, error: action.message } : m,
      );
    case "assistant:local":
      return [
        ...state,
        {
          id: generateUUID(),
          role: "assistant",
          text: action.text,
          contextUsage: action.contextUsage ?? null,
          tools: [],
          status: "done",
        },
      ];
    case "turn:started":
      return [
        ...state,
        {
          id: generateUUID(),
          role: "assistant",
          text: "",
          reasoning: "",
          tools: [],
          status: "streaming",
        },
      ];
    case "text:delta":
      return patchLast(state, (m) => ({ ...m, text: m.text + action.text }));
    case "reasoning:delta":
      return patchLast(state, (m) => ({
        ...m,
        reasoning: (m.reasoning ?? "") + action.text,
      }));
    case "tool:started":
      return patchLast(state, (m) => ({
        ...m,
        tools: [...m.tools, action.card],
      }));
    case "tool:input":
      return patchLast(state, (m) => ({
        ...m,
        tools: m.tools.map((t) =>
          t.id === action.id ? { ...t, input: action.input } : t,
        ),
      }));
    case "tool:completed":
      return patchLast(state, (m) => ({
        ...m,
        tools: m.tools.map((t) =>
          t.id === action.id
            ? {
                ...t,
                status: action.error ? "error" : "done",
                output: action.output,
                error: action.error,
                name: action.name ?? t.name,
              }
            : t,
        ),
      }));
    case "turn:finished":
      return patchLast(state, (m) => ({
        ...m,
        status: action.isError ? "error" : "done",
        costUsd: action.costUsd,
      }));
    case "turn:error":
      return patchLast(state, (m) => ({
        ...m,
        status: "error",
        error: action.message,
      }));
  }
}

const toolIcon = (name: string) => {
  const n = name.toLowerCase();
  if (n.includes("bash") || n.includes("terminal") || n.includes("powershell")) {
    return <TerminalIcon size={13} />;
  }
  if (n.includes("read")) return <FileText size={13} />;
  if (n.includes("write") || n.includes("edit")) return <PencilLine size={13} />;
  if (n.includes("glob") || n.includes("grep") || n.includes("search")) {
    return <Search size={13} />;
  }
  return <Wrench size={13} />;
};

const truncate = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}…` : text;

const ToolCard: React.FC<{ card: ToolCardData }> = ({ card }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const inputText = card.input
    ? JSON.stringify(card.input, null, 1)
    : "";
  const output = card.output ?? card.error ?? "";
  const statusLabel =
    card.status === "running"
      ? "运行中"
      : card.status === "error"
        ? "出错"
        : "完成";
  // 所有工具统一：完成 → 绿√，失败 → 红X，运行中无图标
  const showDoneCheck = card.status === "done";
  const showErrorCross = card.status === "error";

  const copyOutput = () => {
    navigator.clipboard?.writeText(output).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className={`chat-tool-card status-${card.status}`}>
      <button
        type="button"
        className="chat-tool-head"
        onClick={() => setOpen(!open)}
      >
        <span className="chat-tool-icon">{toolIcon(card.name)}</span>
        <span className="chat-tool-name">{card.name}</span>
        <span className="chat-tool-status">
          {showDoneCheck && (
            <CircleCheck size={13} className="chat-tool-status-check" />
          )}
          {showErrorCross && (
            <CircleX size={13} className="chat-tool-status-cross" />
          )}
          {statusLabel}
        </span>
        {open ? (
          <ChevronDown className="chat-tool-chevron" size={13} />
        ) : (
          <ChevronRight className="chat-tool-chevron" size={13} />
        )}
      </button>
      {open && (
        <div className="chat-tool-body">
          {inputText && (
            <pre className="chat-tool-input">{truncate(inputText, 500)}</pre>
          )}
          {output && (
            <div className="chat-tool-output-wrap">
              <button
                type="button"
                className="chat-tool-copy"
                onClick={copyOutput}
                title="复制输出"
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <pre className="chat-tool-output">{truncate(output, 3000)}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const CompletionMenu: React.FC<{
  items: CompletionEntry[];
  activeIndex: number;
  loading: boolean;
  onSelect: (item: CompletionEntry) => void;
  onHover: (index: number) => void;
}> = ({ items, activeIndex, loading, onSelect, onHover }) => (
  <div className="chat-completion-menu" role="listbox">
    <div className="chat-completion-header">
      <span>{loading ? "正在搜索…" : `${items.length} 个候选`}</span>
      <span>↑↓ 选择 · Enter/Tab 插入 · Esc 关闭</span>
    </div>
    <div className="chat-completion-list">
      {!loading && items.length === 0 && (
        <div className="chat-completion-empty">没有匹配项</div>
      )}
      {items.map((item, index) => (
        <button
          type="button"
          key={`${item.kind}:${item.path ?? item.name}`}
          className={`chat-completion-item ${index === activeIndex ? "is-active" : ""}`}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onHover(index)}
          onClick={() => onSelect(item)}
          role="option"
          aria-selected={index === activeIndex}
          ref={(element) => {
            if (index === activeIndex) element?.scrollIntoView({ block: "nearest" });
          }}
        >
          <span className="chat-completion-icon">
            {item.kind === "directory" ? (
              <Folder size={15} />
            ) : item.kind === "file" ? (
              <File size={15} />
            ) : item.kind === "skill" ? (
              <Sparkles size={15} />
            ) : (
              <Command size={15} />
            )}
          </span>
          <span className="chat-completion-copy">
            <span className="chat-completion-label">
              {item.kind === "file" || item.kind === "directory"
                ? item.path
                : `/${item.name}`}
            </span>
            {item.description && (
              <span className="chat-completion-description">{item.description}</span>
            )}
          </span>
          <span className="chat-completion-source">{item.source}</span>
        </button>
      ))}
    </div>
  </div>
);

const QuestionCard: React.FC<{
  request: PendingQuestionRequest;
  submitting: boolean;
  error: string | null;
  onSubmit: (answers: Record<string, { answers: string[] }>) => void;
  onSkip: () => void;
}> = ({ request, submitting, error, onSubmit, onSkip }) => {
  const [activeQuestion, setActiveQuestion] = useState(0);
  const [selections, setSelections] = useState<Record<string, Set<string>>>({});
  const [customAnswers, setCustomAnswers] = useState<Record<string, string>>({});
  const question = request.questions[activeQuestion];

  const toggleOption = (questionId: string, label: string, multiSelect: boolean) => {
    setSelections((previous) => {
      const current = new Set(previous[questionId] ?? []);
      if (multiSelect) {
        if (current.has(label)) current.delete(label);
        else current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...previous, [questionId]: current };
    });
  };

  /** 明确选中（不取消）：双击快速确认时使用 */
  const selectOption = (questionId: string, label: string, multiSelect: boolean) => {
    setSelections((previous) => {
      const current = new Set(previous[questionId] ?? []);
      if (multiSelect) {
        current.add(label);
      } else {
        current.clear();
        current.add(label);
      }
      return { ...previous, [questionId]: current };
    });
  };

  /** 组装答案；override 用于双击确认：把双击的选项直接写入对应问题的答案 */
  const submit = (override?: { questionId: string; label: string }) => {
    const answers: Record<string, { answers: string[] }> = {};
    for (const item of request.questions) {
      let values = [...(selections[item.id] ?? [])];
      if (override && item.id === override.questionId) {
        values = item.multiSelect
          ? values.includes(override.label)
            ? values
            : [...values, override.label]
          : [override.label];
      }
      const custom = customAnswers[item.id]?.trim();
      if (custom) values.push(custom);
      answers[item.id] = { answers: values };
    }
    onSubmit(answers);
  };

  /** 双击选项：选中该选项；非最后一题则前进到下一题，最后一题直接提交 */
  const handleDoubleClickOption = (label: string) => {
    selectOption(question.id, label, !!question.multiSelect);
    if (activeQuestion < request.questions.length - 1) {
      setActiveQuestion((index) => index + 1);
    } else {
      submit({ questionId: question.id, label });
    }
  };

  if (!question) return null;
  const selected = selections[question.id] ?? new Set<string>();

  return (
    <div className="chat-question-overlay">
      <div
        className="chat-question-card chat-question-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Claude 需要你的选择"
      >
        {/* 中部可滚动：标题/问题/选项；底部操作栏固定在弹窗内始终可见 */}
        <div className="chat-question-scroll">
          <div className="chat-question-header">
            <div>
              <span className="chat-question-kicker">Claude 需要你的选择</span>
              <strong>{question.header || "选择"}</strong>
            </div>
            {request.questions.length > 1 && (
              <span className="chat-question-progress">
                {activeQuestion + 1}/{request.questions.length}
              </span>
            )}
          </div>
          {request.questions.length > 1 && (
            <div className="chat-question-tabs" role="tablist">
              {request.questions.map((item, index) => (
                <button
                  type="button"
                  key={item.id}
                  className={index === activeQuestion ? "is-active" : ""}
                  onClick={() => setActiveQuestion(index)}
                >
                  {item.header || `问题 ${index + 1}`}
                </button>
              ))}
            </div>
          )}
          <div className="chat-question-text">{question.question}</div>
          <div className="chat-question-options">
            {question.options.map((option, index) => {
              const isSelected = selected.has(option.label);
              return (
                <button
                  type="button"
                  key={`${option.label}:${index}`}
                  className={`chat-question-option ${isSelected ? "is-selected" : ""}`}
                  onClick={() => toggleOption(question.id, option.label, !!question.multiSelect)}
                  onDoubleClick={() => handleDoubleClickOption(option.label)}
                  disabled={submitting}
                  title="单击选择，双击直接确认"
                >
                  <span className="chat-question-marker">
                    {question.multiSelect ? (isSelected ? "✓" : "") : index + 1}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    {option.description && <small>{option.description}</small>}
                  </span>
                </button>
              );
            })}
            <textarea
              className="chat-question-custom"
              value={customAnswers[question.id] ?? ""}
              onChange={(event) =>
                setCustomAnswers((previous) => ({
                  ...previous,
                  [question.id]: event.target.value,
                }))
              }
              placeholder="其他回答（可选）"
              rows={2}
              disabled={submitting}
            />
          </div>
        </div>
        {error && <div className="chat-question-error">{error}</div>}
        <div className="chat-question-actions">
          <button type="button" onClick={onSkip} disabled={submitting}>
            跳过
          </button>
          <div>
            {activeQuestion > 0 && (
              <button
                type="button"
                onClick={() => setActiveQuestion((index) => index - 1)}
                disabled={submitting}
              >
                上一步
              </button>
            )}
            {activeQuestion < request.questions.length - 1 ? (
              <button
                type="button"
                className="is-primary"
                onClick={() => setActiveQuestion((index) => index + 1)}
                disabled={submitting}
              >
                下一步
              </button>
            ) : (
              <button
                type="button"
                className="is-primary"
                onClick={() => submit()}
                disabled={submitting}
              >
                {submitting ? "正在提交…" : "提交选择"}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

const MessageView: React.FC<{ message: ChatMessage }> = ({ message }) => {
  if (message.role === "user") {
    return (
      <div className="chat-msg chat-msg-user">
        <div className="chat-bubble chat-bubble-user">
          {!!message.images?.length && (
            <div className="chat-message-images">
              {message.images.map((image) => (
                <img key={image.id} src={image.dataUrl} alt={image.name} />
              ))}
            </div>
          )}
          {message.text}
        </div>
        {message.error && (
          <div className="chat-msg-error">{message.error}</div>
        )}
      </div>
    );
  }
  return (
    <div className="chat-msg chat-msg-assistant">
      {message.reasoning && (
        <details className="chat-reasoning">
          <summary>
            <BrainCircuit size={13} />
            <span>思考过程</span>
          </summary>
          <div
            className="chat-reasoning-body markdown-body"
            dangerouslySetInnerHTML={{
              __html: renderChatMarkdownToHtml(message.reasoning),
            }}
          />
        </details>
      )}
      {message.tools.map((tool) => (
        <ToolCard key={tool.id} card={tool} />
      ))}
      {message.contextUsage ? (
        <ContextUsageCard data={message.contextUsage} />
      ) : message.text ? (
        <div
          className="chat-bubble chat-bubble-assistant markdown-body"
          dangerouslySetInnerHTML={{
            __html: renderChatMarkdownToHtml(message.text),
          }}
        />
      ) : message.status === "streaming" ? (
        <div className="chat-typing">
          <span />
          <span />
          <span />
        </div>
      ) : null}
      {message.status === "streaming" && message.text && (
        <span className="chat-cursor" />
      )}
      {message.status === "done" && message.costUsd != null && (
        <div className="chat-cost">≈ ${message.costUsd.toFixed(4)}</div>
      )}
      {message.status === "error" && message.error && (
        <div className="chat-msg-error">{message.error}</div>
      )}
    </div>
  );
};

export const ChatTab: React.FC<ChatTabProps> = React.memo((props) => {
  const {
    sessionId,
    directory,
    agentSessionId,
    isActive,
    onSpawned,
    onStateChange,
    onCommandComplete,
    onUserSubmittedInput,
  } = props;

  const [messages, dispatch] = useReducer(messagesReducer, []);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  // 运行中两次 ESC 终止交互：第一次按下后终止按钮显示 ESC 提示，第二次按下才终止
  const [escArmed, setEscArmed] = useState(false);
  const [completionTrigger, setCompletionTrigger] = useState<ChatCompletionTrigger | null>(null);
  const [completionItems, setCompletionItems] = useState<CompletionEntry[]>([]);
  const [completionLoading, setCompletionLoading] = useState(false);
  const [completionIndex, setCompletionIndex] = useState(0);
  const [slashCatalog, setSlashCatalog] = useState<CompletionEntry[]>([]);
  const [slashCatalogLoaded, setSlashCatalogLoaded] = useState(false);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestionRequest | null>(null);
  const [questionSubmitting, setQuestionSubmitting] = useState(false);
  const [questionError, setQuestionError] = useState<string | null>(null);
  const [images, setImages] = useState<ChatImageAttachment[]>([]);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [draggingImage, setDraggingImage] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const completionRequestRef = useRef(0);
  const composingRef = useRef(false);
  // ESC 提示态与超时定时器（状态 + ref 镜像，避免监听器闭包读到旧值）
  const escArmedRef = useRef(false);
  const escArmTimerRef = useRef<number | null>(null);
  // 用户是否钉在消息流底部：在底部附近才自动跟随新输出，浏览上方信息时不抢滚动
  const pinnedToBottomRef = useRef(true);

  const onSpawnedRef = useRef(onSpawned);
  onSpawnedRef.current = onSpawned;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onCommandCompleteRef = useRef(onCommandComplete);
  onCommandCompleteRef.current = onCommandComplete;
  const onUserSubmittedInputRef = useRef(onUserSubmittedInput);
  onUserSubmittedInputRef.current = onUserSubmittedInput;
  useEffect(() => {
    if (isActive && ready && !busy) {
      inputRef.current?.focus();
    }
  }, [busy, isActive, ready]);

  useEffect(() => {
    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    setBusy(false);
    setCancelling(false);
    setReady(false);
    setPendingQuestion(null);
    setQuestionError(null);
    setCompletionTrigger(null);

    const handleEvent = (payload: ChatStreamEvent) => {
      switch (payload.type) {
        case "turn:started":
          dispatch({ type: "turn:started" });
          break;
        case "text:delta":
          if (payload.text) {
            dispatch({ type: "text:delta", text: payload.text });
          }
          break;
        case "reasoning:delta":
          if (payload.text) {
            dispatch({ type: "reasoning:delta", text: payload.text });
          }
          break;
        case "tool:started":
          dispatch({
            type: "tool:started",
            card: {
              id: payload.toolId ?? generateUUID(),
              name: payload.toolName ?? "tool",
              input: payload.input,
              status: "running",
            },
          });
          break;
        case "tool:input":
          if (payload.toolId) {
            dispatch({
              type: "tool:input",
              id: payload.toolId,
              input: payload.input,
            });
          }
          break;
        case "tool:completed":
          if (payload.toolId) {
            dispatch({
              type: "tool:completed",
              id: payload.toolId,
              name: payload.toolName,
              output: payload.output,
              error: payload.error,
            });
          }
          break;
        case "turn:finished":
          dispatch({
            type: "turn:finished",
            costUsd: payload.costUsd,
            isError: payload.isError,
          });
          setBusy(false);
          setCancelling(false);
          setPendingQuestion(null);
          onStateChangeRef.current?.(false);
          onCommandCompleteRef.current?.();
          break;
        case "turn:error":
          dispatch({
            type: "turn:error",
            message: payload.message ?? "Claude 执行出错",
          });
          setBusy(false);
          setCancelling(false);
          setPendingQuestion(null);
          onStateChangeRef.current?.(false);
          break;
        case "question:requested":
          if (payload.requestId && payload.questions?.length) {
            setPendingQuestion({
              requestId: payload.requestId,
              questions: payload.questions,
            });
            setQuestionSubmitting(false);
            setQuestionError(null);
            setCompletionTrigger(null);
          }
          break;
        default:
          break;
      }
    };

    const initialize = async () => {
      try {
        unlisten = await listen<ChatStreamEvent>(CHAT_EVENT_CHANNEL, (event) => {
          if (event.payload.sessionId !== sessionId) return;
          handleEvent(event.payload);
        });
        if (disposed) {
          unlisten();
          unlisten = undefined;
          return;
        }

        try {
          const history = await invoke<Array<{ role: string; text: string }>>(
            "chat_get_history",
            { directory, agentSessionId },
          );
          if (disposed) return;
          const msgs: ChatMessage[] = history.map((item) => ({
            id: generateUUID(),
            role: item.role === "assistant" ? "assistant" : "user",
            text: item.text,
            tools: [],
            status: "done",
          }));
          dispatch({ type: "history", messages: msgs });
        } catch (error) {
          // 新会话没有转录文件属正常情况，不阻止输入。
          log(`[chat] history load failed: ${error}`);
        }

        if (!disposed) {
          setReady(true);
          onSpawnedRef.current?.();
        }
      } catch (error) {
        if (!disposed) {
          log(`[chat] event listener setup failed: ${error}`);
        }
      }
    };
    void initialize();

    // 与 CLI 终端一致：文件树/预览面板「添加到对话」经全局事件注入当前输入框
    const handleInsertConversationTag = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; text: string }>).detail;
      if (!detail || detail.sessionId !== sessionId || !detail.text) return;
      setDraft((prev) => (prev ? `${prev}${detail.text}` : detail.text));
      const input = inputRef.current;
      if (input) {
        input.style.height = "auto";
        input.style.height = `${Math.min(input.scrollHeight, 140)}px`;
        input.focus();
      }
    };
    window.addEventListener("kkcoder-insert-conversation-tag", handleInsertConversationTag);

    return () => {
      disposed = true;
      unlisten?.();
      window.removeEventListener(
        "kkcoder-insert-conversation-tag",
        handleInsertConversationTag,
      );
      invoke("chat_cancel", { sessionId }).catch((error) => {
        log(`[chat] cleanup cancel failed: ${error}`);
      });
    };
  }, [sessionId, directory, agentSessionId]);

  useEffect(() => {
    if (!completionTrigger) {
      setCompletionItems([]);
      setCompletionLoading(false);
      return;
    }

    const requestId = ++completionRequestRef.current;
    const query = completionTrigger.query.toLowerCase();
    setCompletionLoading(true);
    setCompletionIndex(0);

    if (completionTrigger.kind === "slash") {
      const applyCatalog = (catalog: CompletionEntry[]) => {
        if (requestId !== completionRequestRef.current) return;
        const filtered = catalog
          .filter((item) => !query || item.name.toLowerCase().includes(query))
          .slice(0, 80);
        setCompletionItems(filtered);
        setCompletionLoading(false);
      };
      if (slashCatalogLoaded) {
        applyCatalog(slashCatalog);
        return;
      }
      invoke<CompletionEntry[]>("chat_get_slash_items", { directory })
        .then((catalog) => {
          setSlashCatalog(catalog);
          setSlashCatalogLoaded(true);
          applyCatalog(catalog);
        })
        .catch((error) => {
          log(`[chat] slash catalog failed: ${error}`);
          if (requestId === completionRequestRef.current) {
            setCompletionItems([]);
            setCompletionLoading(false);
          }
        });
      return;
    }

    const timer = window.setTimeout(() => {
      invoke<CompletionEntry[]>("chat_search_project_entries", {
        directory,
        query: completionTrigger.query,
      })
        .then((items) => {
          if (requestId !== completionRequestRef.current) return;
          setCompletionItems(items);
          setCompletionLoading(false);
        })
        .catch((error) => {
          log(`[chat] file completion failed: ${error}`);
          if (requestId === completionRequestRef.current) {
            setCompletionItems([]);
            setCompletionLoading(false);
          }
        });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [completionTrigger, directory, slashCatalog, slashCatalogLoaded]);

  // 新消息/流式输出：仅在用户钉在底部时自动跟随，浏览上方内容时保持视口稳定
  useEffect(() => {
    const el = scrollRef.current;
    if (el && pinnedToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = distanceFromBottom < 48;
  };

  const handleSend = async () => {
    const text = draft.trim();
    if ((!text && images.length === 0) || busy || !ready || pendingQuestion) return;

    // 内置 slash 命令本地处理：/clear /reset 只清界面，/new 再清上下文。
    // 不发给模型，避免 claude -p 返回 "(no content)"。
    const command = text.toLowerCase();
    if (command === "/clear" || command === "/reset" || command === "/new") {
      dispatch({ type: "history", messages: [] });
      setDraft("");
      setCompletionTrigger(null);
      setAttachmentError(null);
      if (command === "/new") {
        try {
          await invoke("chat_reset_context", {
            sessionId,
            agentSessionId,
            directory,
          });
        } catch (error) {
          log(`[chat] reset context failed: ${error}`);
        }
      }
      return;
    }

    // /context：本地展示 Context Usage 报告，不发给模型
    if (command === "/context") {
      setDraft("");
      setCompletionTrigger(null);
      setAttachmentError(null);
      let usage: ContextUsageData | null = null;
      try {
        usage = await invoke<ContextUsageData | null>("chat_get_context_usage", {
          sessionId,
          directory,
          agentSessionId,
        });
      } catch (error) {
        log(`[chat] get context usage failed: ${error}`);
      }
      dispatch({ type: "assistant:local", text: "", contextUsage: usage });
      return;
    }

    const msgId = generateUUID();
    const sentImages = images;
    dispatch({ type: "user:sent", text, id: msgId, images: sentImages });
    setDraft("");
    setImages([]);
    setAttachmentError(null);
    setCompletionTrigger(null);
    setBusy(true);
    onStateChangeRef.current?.(true);
    try {
      await invoke("chat_send_message", {
        sessionId,
        directory,
        agentSessionId,
        text,
        images: sentImages.map((image) => image.dataUrl),
      });
      onUserSubmittedInputRef.current?.(sessionId);
    } catch (err) {
      dispatch({
        type: "send:failed",
        id: msgId,
        message: formatFeedbackError(err, "发送失败"),
      });
      setBusy(false);
      onStateChangeRef.current?.(false);
      setImages(sentImages);
    }
  };

  const updateCompletion = (value: string, caret: number) => {
    // 输入法组合输入期间不触发补全：箭头/回车归输入法候选窗使用，
    // 避免候选窗与补全菜单互相抢焦点。
    if (composingRef.current) {
      setCompletionTrigger(null);
      return;
    }
    if (busy || pendingQuestion) {
      setCompletionTrigger(null);
      return;
    }
    setCompletionTrigger(detectChatCompletionTrigger(value, caret));
  };

  const selectCompletion = (item: CompletionEntry) => {
    if (!completionTrigger) return;
    const replacement =
      item.kind === "file" || item.kind === "directory"
        ? `@${item.path}${item.kind === "directory" ? "/" : ""} `
        : `/${item.name} `;
    const next = replaceChatCompletionTrigger(draft, completionTrigger, replacement);
    setDraft(next.text);
    setCompletionTrigger(null);
    window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.setSelectionRange(next.caret, next.caret);
    }, 0);
  };

  const answerQuestion = async (answers: Record<string, { answers: string[] }>) => {
    if (!pendingQuestion || questionSubmitting) return;
    setQuestionSubmitting(true);
    setQuestionError(null);
    try {
      await invoke("chat_answer_question", {
        sessionId,
        requestId: pendingQuestion.requestId,
        answers: { answers },
      });
      setPendingQuestion(null);
    } catch (error) {
      setQuestionError(formatFeedbackError(error, "提交回答失败"));
    } finally {
      setQuestionSubmitting(false);
    }
  };

  const addImageFiles = async (files: File[]) => {
    setAttachmentError(null);
    const available = Math.max(0, MAX_CHAT_IMAGES - images.length);
    if (available === 0) {
      setAttachmentError(`最多添加 ${MAX_CHAT_IMAGES} 张图片`);
      return;
    }
    const accepted = files.filter((file) => ACCEPTED_IMAGE_TYPES.has(file.type)).slice(0, available);
    if (accepted.length === 0) {
      // 拖入/粘贴非图片文件：静默忽略，不提示
      return;
    }
    const next: ChatImageAttachment[] = [];
    for (const file of accepted) {
      if (file.size > MAX_CHAT_IMAGE_BYTES) {
        setAttachmentError(`${file.name} 超过 10 MB`);
        continue;
      }
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ""));
        reader.onerror = () => reject(reader.error ?? new Error("图片读取失败"));
        reader.readAsDataURL(file);
      }).catch((error) => {
        setAttachmentError(formatFeedbackError(error, "图片读取失败"));
        return "";
      });
      if (dataUrl) {
        next.push({
          id: generateUUID(),
          name: file.name || "pasted-image",
          mediaType: file.type,
          dataUrl,
        });
      }
    }
    if (next.length) setImages((previous) => [...previous, ...next]);
  };

  const disarmEsc = useCallback(() => {
    escArmedRef.current = false;
    setEscArmed(false);
    if (escArmTimerRef.current !== null) {
      window.clearTimeout(escArmTimerRef.current);
      escArmTimerRef.current = null;
    }
  }, []);

  const armEsc = useCallback(() => {
    escArmedRef.current = true;
    setEscArmed(true);
    if (escArmTimerRef.current !== null) {
      window.clearTimeout(escArmTimerRef.current);
    }
    // 2.5s 内未按第二次 ESC 则收回提示，避免误以为还处于待确认状态
    escArmTimerRef.current = window.setTimeout(() => {
      escArmedRef.current = false;
      setEscArmed(false);
      escArmTimerRef.current = null;
    }, 2500);
  }, []);

  const handleCancel = useCallback(() => {
    if (cancelling) return;
    disarmEsc();
    setCancelling(true);
    invoke("chat_cancel", { sessionId }).catch((err) => {
      log(`[chat] cancel failed: ${err}`);
      setCancelling(false);
    });
  }, [cancelling, disarmEsc, sessionId]);

  // 运行中两次 ESC 终止：第一次按下 → 终止按钮显示 ESC 提示；第二次按下 → 终止任务。
  // 仅在当前会话运行中且本 tab 激活时生效；问题弹窗打开期间不劫持 ESC。
  useEffect(() => {
    if (!busy || pendingQuestion || !isActive) {
      disarmEsc();
      return;
    }
    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (isEditableFocusTarget(event.target)) return;
      if (event.key !== "Escape") {
        // 按下其他键视为放弃 ESC 终止意图
        if (escArmedRef.current) disarmEsc();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (escArmedRef.current) {
        disarmEsc();
        handleCancel();
      } else {
        armEsc();
      }
    };
    window.addEventListener("keydown", handleGlobalKeyDown);
    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
      disarmEsc();
    };
  }, [armEsc, busy, disarmEsc, handleCancel, isActive, pendingQuestion]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // 输入法组合输入期间把箭头/回车让给输入法候选窗
    if (e.nativeEvent.isComposing) return;
    if (completionTrigger) {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const len = completionItems.length;
        if (len > 0) {
          setCompletionIndex((current) => {
            const valid = current >= 0 && current < len ? current : 0;
            // 上箭头：向上一格，最顶格回绕到最后一条（选中最下面那条）
            return e.key === "ArrowUp"
              ? (valid - 1 + len) % len
              : (valid + 1) % len;
          });
        }
        return;
      }
      if ((e.key === "Enter" || e.key === "Tab") && completionItems[completionIndex]) {
        e.preventDefault();
        selectCompletion(completionItems[completionIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setCompletionTrigger(null);
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  };

  const lastMsg = messages[messages.length - 1];

  return (
    <div className="chat-root">
      <div className="chat-messages" ref={scrollRef} onScroll={handleScroll}>
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-title">Claude 聊天</div>
            {!ready && <div className="chat-empty-desc">正在加载对话…</div>}
          </div>
        )}
        {messages.map((m) => (
          <MessageView key={m.id} message={m} />
        ))}
      </div>
      <div
        className={`chat-composer ${draggingImage ? "is-dragging" : ""}`}
        onDragEnter={(event) => {
          if ([...event.dataTransfer.types].includes("Files")) {
            event.preventDefault();
            setDraggingImage(true);
          }
        }}
        onDragOver={(event) => {
          if ([...event.dataTransfer.types].includes("Files")) event.preventDefault();
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
            setDraggingImage(false);
          }
        }}
        onDrop={(event) => {
          event.preventDefault();
          setDraggingImage(false);
          void addImageFiles([...event.dataTransfer.files]);
        }}
      >
        {completionTrigger && (
          <CompletionMenu
            items={completionItems}
            activeIndex={completionIndex}
            loading={completionLoading}
            onSelect={selectCompletion}
            onHover={setCompletionIndex}
          />
        )}
        {!!images.length && (
          <div className="chat-attachment-strip">
            {images.map((image) => (
              <div className="chat-attachment" key={image.id} title={image.name}>
                <img src={image.dataUrl} alt={image.name} />
                <button
                  type="button"
                  onClick={() => setImages((current) => current.filter((item) => item.id !== image.id))}
                  title="移除图片"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        )}
        {(attachmentError || draggingImage) && (
          <div className={`chat-attachment-hint ${attachmentError ? "is-error" : ""}`}>
            {attachmentError || "松开以添加图片"}
          </div>
        )}
        <div className="chat-input-bar">
          <textarea
            ref={inputRef}
            className="chat-input"
            value={draft}
            onChange={(event) => {
              setDraft(event.target.value);
              updateCompletion(event.target.value, event.target.selectionStart);
              event.target.style.height = "auto";
              event.target.style.height = `${Math.min(event.target.scrollHeight, 140)}px`;
            }}
            onClick={(event) =>
              updateCompletion(event.currentTarget.value, event.currentTarget.selectionStart)
            }
            onKeyDown={handleKeyDown}
            onCompositionStart={() => {
              composingRef.current = true;
              setCompletionTrigger(null);
            }}
            onCompositionEnd={(event) => {
              composingRef.current = false;
              // 组合结束后重新检测，让补全菜单正常响应方向键
              updateCompletion(event.currentTarget.value, event.currentTarget.selectionStart);
            }}
            onPaste={(event) => {
              const pastedImages = [...event.clipboardData.files].filter((file) =>
                file.type.startsWith("image/"),
              );
              if (pastedImages.length) {
                event.preventDefault();
                void addImageFiles(pastedImages);
              }
            }}
            placeholder={pendingQuestion ? "请先完成弹出的问题" : "输入消息，@ 引用文件，/ 使用技能或命令"}
            rows={1}
            disabled={busy || !ready || !!pendingQuestion}
          />
          <button
            type="button"
            className={`chat-send-btn ${busy ? "is-cancel" : ""} ${escArmed ? "is-esc-armed" : ""}`}
            onClick={busy ? handleCancel : () => void handleSend()}
            disabled={
              cancelling ||
              (!busy && (!ready || !!pendingQuestion || (!draft.trim() && images.length === 0)))
            }
            title={
              cancelling
                ? "正在取消"
                : busy
                  ? escArmed
                    ? "再按一次 ESC 终止任务（或点击直接终止）"
                    : "终止生成（按 ESC 两次）"
                  : "发送"
            }
          >
            {busy ? (
              escArmed ? (
                <span className="chat-cancel-esc">ESC</span>
              ) : (
                <Square size={15} />
              )
            ) : (
              <Send size={15} />
            )}
          </button>
        </div>
      </div>
      {busy && lastMsg?.role === "assistant" && lastMsg.status === "streaming" && (
        <div className={`chat-busy-hint ${escArmed ? "is-esc-armed" : ""}`}>
          {escArmed ? "再按一次 ESC 终止任务" : "AI 正在生成…"}
        </div>
      )}
      {pendingQuestion && (
        <QuestionCard
          request={pendingQuestion}
          submitting={questionSubmitting}
          error={questionError}
          onSubmit={(answers) => void answerQuestion(answers)}
          onSkip={() => void answerQuestion({})}
        />
      )}
    </div>
  );
});
