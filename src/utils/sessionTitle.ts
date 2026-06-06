export interface CapturedUserInput {
  buffer: string;
  submitted: boolean;
  submittedInput: string;
}

const ANSI_ESCAPE_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const NON_TEXT_CONTROL_PATTERN = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
const BLOCKED_TITLE_PATTERNS = [
  /bypass\s+permissions/i,
  /shift\+tab\s+to\s+cycle/i,
  /dangerously-skip-permissions/i,
];
const MAX_TITLE_LENGTH = 60;

function stripAnsi(text: string): string {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

function removeLastChar(text: string): string {
  const chars = Array.from(text);
  chars.pop();
  return chars.join("");
}

export function captureUserInputData(buffer: string, data: string): CapturedUserInput {
  let nextBuffer = buffer;
  let submitted = false;
  let submittedInput = "";
  const cleanData = stripAnsi(data);

  for (const char of cleanData) {
    if (char === "\r") {
      if (!submitted) {
        submitted = true;
        submittedInput = nextBuffer;
      }
      continue;
    }

    // 粘贴的换行符不作为提交触发，也不加入 buffer
    if (char === "\n") {
      continue;
    }

    if (submitted) {
      continue;
    }

    if (char === "\x7f" || char === "\b") {
      nextBuffer = removeLastChar(nextBuffer);
      continue;
    }

    if (NON_TEXT_CONTROL_PATTERN.test(char)) {
      NON_TEXT_CONTROL_PATTERN.lastIndex = 0;
      continue;
    }

    nextBuffer += char;
  }

  return {
    buffer: nextBuffer,
    submitted,
    submittedInput,
  };
}

export function deriveSessionTitleFromInput(rawInput: string): string | null {
  const raw = stripAnsi(rawInput)
    .replace(NON_TEXT_CONTROL_PATTERN, " ")
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .find(Boolean);

  if (!raw) return null;

  let cleanName = raw;

  cleanName = cleanName
    .replace(/^[\s>#$⇠❯⏵›»:.-]+/, "")
    .replace(/^(?:user|human|用户)\s*[:：]\s*/i, "")
    .trim();

  if (!cleanName) return null;
  if (!/[\p{L}\p{N}]/u.test(cleanName)) return null;
  if (BLOCKED_TITLE_PATTERNS.some((pattern) => pattern.test(cleanName))) {
    return null;
  }

  const chars = Array.from(cleanName);
  if (chars.length > MAX_TITLE_LENGTH) {
    return `${chars.slice(0, MAX_TITLE_LENGTH).join("")}...`;
  }

  return cleanName;
}
