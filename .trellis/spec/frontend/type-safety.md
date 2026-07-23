# 类型安全规范

> KKCoder 的 TypeScript 类型约定、类型组织与验证模式。

---

## TypeScript 配置

项目使用严格模式 (`strict: true`)：

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "noEmit": true
  }
}
```

---

## 核心类型定义

### 接口定义位置

| 类型 | 位置 | 示例 |
|------|------|------|
| 组件 Props | 组件文件内 | `SidebarProps`, `ConfirmModalProps` |
| 业务模型 | 组件或 utils 中导出 | `Session`, `ArchivedProject` |
| 工具类型 | `utils/` 文件中 | `TerminalWriteCommand`, `ClaudeTerminalMode` |
| 环境类型 | `*.d.ts` | `vite-env.d.ts` |

### 业务模型示例

```tsx
// Sidebar.tsx — 会话模型
export interface Session {
  id: string;
  name: string;
  project: string;
  path: string;
  type: "claude" | "pi" | "codex";    // 联合类型字面量
  agentSessionId: string;
  createdAt?: string;
  lastUserMessageAt?: string;
  favorite: number;                     // 0 = 普通, 1 = 已收藏
  deleted?: number;                     // 0 = 活动, 1 = 回收站
  deletedAt?: string;
  isTemp?: boolean;
  matchSnippets?: string[];
}

export interface ArchivedProject {
  id: number;
  project_name: string;
  project_path: string;
  archived_at: string;
  archive_month: string;
  sessions_data: string;               // JSON string
}
```

---

## 类型导入约定

### 值导入 vs 类型导入

```tsx
// 值导入
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";

// 类型导入 — 使用 import type
import type { UnlistenerFn } from "@tauri-apps/api/event";
import type { NativeTerminalLifecycle } from "../utils/nativeTerminalLifecycle";

// 混合导入 — 值 + 类型
import { shouldUseNativeTerminal, type ClaudeTerminalMode } from "../utils/terminalMode";
```

---

## 联合类型与字面量类型

### Agent 类型

```tsx
// 组件 Props 中
selectedAgent: "claude" | "pi" | "codex";
onSelectAgent: (agent: "claude" | "pi" | "codex") => void;
```

### 终端模式

```tsx
// utils/terminalMode.ts
export type ClaudeTerminalMode = "standard" | "native";
export type TerminalWriteCommand = "write_to_terminal" | "write_to_compat_terminal";
```

---

## 类型守卫与类型断言

### 类型守卫

```tsx
// 事件类型守卫
const handleTerminalModeChange = (event: Event) => {
  const mode = resolveClaudeTerminalMode((event as CustomEvent<string>).detail);
  setClaudeTerminalMode(mode);
};
```

### 安全类型断言

```tsx
// JSON 解析后的类型断言
const existingLogs = JSON.parse(localStorage.getItem("kkcoder_logs") || "[]") as string[];
```

---

## 泛型使用

### invoke 泛型

```tsx
// 指定返回类型
const sessions = await invoke<Session[]>("get_sessions");
const session = await invoke<Session>("get_session", { id });
```

### 工具函数泛型

```tsx
// 通用 JSON 安全解析
function safeJsonParse<T>(json: string, fallback: T): T {
  try {
    return JSON.parse(json) as T;
  } catch {
    return fallback;
  }
}
```

---

## 可选属性与默认值

### Props 可选属性

```tsx
interface ConfirmModalProps {
  show: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;      // 可选 — 带默认值 "确定"
  cancelText?: string;       // 可选 — 带默认值 "取消"
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;        // 可选 — 默认 false
}
```

### 解构默认值

```tsx
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  confirmText = "确定",
  cancelText = "取消",
  isDanger = false,
}) => { /* ... */ };
```

---

## 禁止模式

| 禁止行为 | 正确做法 |
|----------|----------|
| 使用 `any` 类型 | 定义具体类型或使用 `unknown` |
| 使用 `as` 随意断言 | 使用类型守卫或 narrowing |
| 禁用 `noUnusedLocals` | 删除未使用的变量 |
| 使用 `// @ts-ignore` | 修复类型错误 |
| 在泛型中省略参数 | 显式指定泛型参数 |
| 使用 `object` 类型 | 定义具体接口 |

---

**Language**: All documentation should be written in **English**.
