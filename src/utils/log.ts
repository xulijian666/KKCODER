const MAX_PERSISTED_LOGS = 200;
const LOGS_STORAGE_KEY = "kkcoder_logs";
/** 防抖落盘间隔：热路径调用只写内存，避免每次 console.log 都同步读写 localStorage */
const FLUSH_DEBOUNCE_MS = 800;
/** 内存积压达到该条数时立即落盘，防止日志堆积丢失 */
const FLUSH_IMMEDIATE_THRESHOLD = 50;

const pendingLogs: string[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flushLogs(): void {
  if (flushTimer !== null) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (pendingLogs.length === 0) return;
  const batch = pendingLogs.splice(0, pendingLogs.length);
  try {
    const existingLogs = JSON.parse(localStorage.getItem(LOGS_STORAGE_KEY) || "[]") as string[];
    existingLogs.push(...batch);
    if (existingLogs.length > MAX_PERSISTED_LOGS) {
      existingLogs.splice(0, existingLogs.length - MAX_PERSISTED_LOGS);
    }
    localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(existingLogs));
  } catch {
    // Ignore localStorage failures (private mode / quota).
  }
}

/** Persist frontend logs so reloads/crashes can still be traced via localStorage. */
export function log(message: string): void {
  const timestamp = new Date().toISOString();
  const fullMessage = `[JS][${timestamp}] ${message}`;
  console.log(fullMessage);
  pendingLogs.push(fullMessage);
  if (pendingLogs.length >= FLUSH_IMMEDIATE_THRESHOLD) {
    flushLogs();
  } else if (flushTimer === null) {
    flushTimer = setTimeout(flushLogs, FLUSH_DEBOUNCE_MS);
  }
}

// 页面隐藏/卸载时尽力落盘，缩小崩溃追踪的丢失窗口
if (typeof window !== "undefined") {
  const flushOnExit = () => flushLogs();
  window.addEventListener("pagehide", flushOnExit);
  window.addEventListener("beforeunload", flushOnExit);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushLogs();
  });
}
