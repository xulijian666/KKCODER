const MAX_PERSISTED_LOGS = 200;
const LOGS_STORAGE_KEY = "kkcoder_logs";

/** Persist frontend logs so reloads/crashes can still be traced via localStorage. */
export function log(message: string): void {
  const timestamp = new Date().toISOString();
  const fullMessage = `[JS][${timestamp}] ${message}`;
  console.log(fullMessage);
  try {
    const existingLogs = JSON.parse(localStorage.getItem(LOGS_STORAGE_KEY) || "[]") as string[];
    existingLogs.push(fullMessage);
    if (existingLogs.length > MAX_PERSISTED_LOGS) {
      existingLogs.shift();
    }
    localStorage.setItem(LOGS_STORAGE_KEY, JSON.stringify(existingLogs));
  } catch {
    // Ignore localStorage failures (private mode / quota).
  }
}
