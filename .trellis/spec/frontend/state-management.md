# 状态管理规范

> KKCoder 的本地状态、全局状态与服务器状态管理约定。

---

## 状态管理架构

KKCoder **不使用** Redux、Zustand、Jotai 等第三方状态管理库。状态管理基于：

| 层级 | 方式 | 用途 |
|------|------|------|
| 本地状态 | `useState` + `useRef` | 组件内部 UI 状态 |
| 跨组件状态 | Props drilling + 回调 | 父子/兄弟组件通信 |
| 全局事件 | `CustomEvent` | 跨层级组件通信 |
| 持久化 | `localStorage` | 用户偏好设置 |
| 后端数据 | Tauri `invoke` + SQLite | 会话、配置等持久数据 |

---

## 本地状态 — useState

### 基本模式

```tsx
const [sessions, setSessions] = useState<Session[]>([]);
const [activeSessionId, setActiveSessionId] = useState<string>("");
const [showModal, setShowModal] = useState<boolean>(false);
```

### 函数式更新

```tsx
// 依赖前一个状态时，使用函数式更新
setGlowingSessionIds((prev) => markSessionRead(prev, activeSessionId));
setTerminalModeBySession((previous) => {
  const next: Record<string, ClaudeTerminalMode> = {};
  for (const sessionId of openTabIds) {
    next[sessionId] = previous[sessionId] ?? claudeTerminalMode;
  }
  return next;
});
```

### 惰性初始化

```tsx
// 从 localStorage 读取初始值 — 使用函数式初始化避免每次渲染都读取
const [currentTheme, setCurrentTheme] = useState<string>(() => {
  return localStorage.getItem("kkcoder_setting_theme") || "light-premium";
});
```

---

## Ref 状态 — useRef

### 用途

- 存储不需要触发重渲染的可变值
- 存储需要在 effect 回调中访问的最新值（避免 stale closure）
- 存储 DOM 引用
- 存储第三方库实例（如 xterm.js Terminal）

### 模式

```tsx
// 存储回调的最新引用
const onSpawnedRef = useRef(onSpawned);
onSpawnedRef.current = onSpawned;  // 每次渲染更新

// 存储终端实例
const terminalRef = useRef<Terminal | null>(null);
const fitAddonRef = useRef<FitAddon | null>(null);

// 存储 Promise 链
const listenerReadyRef = useRef<Promise<void>>(Promise.resolve());
```

---

## 跨组件通信 — CustomEvent

### 事件命名约定

```
kkcoder-<domain>-<action>
```

示例：
- `kkcoder-claude-terminal-mode-change` — 终端模式切换
- `kkcoder-preview-font-change` — 预览字体变更
- `kkcoder-preview-font-size-change` — 预览字号变更

### 派发事件

```tsx
window.dispatchEvent(
  new CustomEvent("kkcoder-claude-terminal-mode-change", { detail: "native" })
);
```

### 监听事件

```tsx
useEffect(() => {
  const handleModeChange = (event: Event) => {
    const mode = resolveClaudeTerminalMode((event as CustomEvent<string>).detail);
    setClaudeTerminalMode(mode);
  };
  window.addEventListener("kkcoder-claude-terminal-mode-change", handleModeChange);
  return () => {
    window.removeEventListener("kkcoder-claude-terminal-mode-change", handleModeChange);
  };
}, []);
```

---

## 持久化状态 — localStorage

### Key 命名约定

| 前缀 | 用途 | 示例 |
|------|------|------|
| `kkcoder_setting_` | 用户设置 | `kkcoder_setting_theme` |
| `kkcoder_sidebar_` | 侧边栏状态 | `kkcoder_sidebar_width` |
| `kkcoder_show_` | 显示/隐藏状态 | `kkcoder_show_project_tree` |
| `kkcoder_cached_` | 缓存数据 | `kkcoder_cached_claude_version` |
| `kkcoder_logs` | 调试日志 | `kkcoder_logs` |

### 读写模式

```tsx
// 读取
const theme = localStorage.getItem("kkcoder_setting_theme") || "light-premium";

// 写入
localStorage.setItem("kkcoder_sidebar_width", newWidth.toString());

// 删除
localStorage.removeItem("kkcoder_setting_ccswitch_path");
```

### 安全读取（带 try/catch）

```tsx
function log(msg: string) {
  try {
    const existingLogs = JSON.parse(localStorage.getItem("kkcoder_logs") || "[]");
    existingLogs.push(fullMsg);
    if (existingLogs.length > 200) {
      existingLogs.shift();
    }
    localStorage.setItem("kkcoder_logs", JSON.stringify(existingLogs));
  } catch (e) {}
}
```

---

## 后端数据 — Tauri invoke

### 数据获取

```tsx
// 获取会话列表
const sessions = await invoke<Session[]>("get_sessions");

// 获取单个会话
const session = await invoke<Session>("get_session", { id });
```

### 数据修改

```tsx
// 创建会话
await invoke("create_session", { name, path, type });

// 删除会话
await invoke("delete_session", { id });

// 更新会话
await invoke("update_session", { id, name: newName });
```

### 错误处理

```tsx
invoke("launch_ccswitch", { path }).catch((err) => {
  alert(`启动 ccswitch.exe 失败:\n${err}`);
});
```

---

## 计算状态 — useMemo

```tsx
// 窗口实例 — 只创建一次
const appWindow = useMemo(() => getCurrentWindow(), []);

// 计算开销大的值
const sortedSessions = useMemo(() => {
  return sortSessionsByActivityDesc(sessions);
}, [sessions]);
```

---

## 稳定回调 — useCallback

```tsx
const handleMinimize = useCallback(() => {
  appWindow.minimize().catch((err) => log(`Failed to minimize: ${err}`));
}, [appWindow]);

const handleSelectSession = useCallback((id: string) => {
  setActiveSessionId(id);
  setOpenTabIds((prev) => prev.includes(id) ? prev : [...prev, id]);
}, []);
```

---

## 禁止模式

| 禁止行为 | 正确做法 |
|----------|----------|
| 引入 Redux/Zustand 等状态库 | 使用 useState + CustomEvent |
| 在组件间传递过深的 props | 使用事件或 context |
| 直接修改 state 对象 | 使用 setter 函数或不可变更新 |
| 在渲染中读取 localStorage | 使用惰性初始化 + useEffect 同步 |
| 忽略 invoke 调用的错误处理 | 使用 .catch() 处理错误 |

---

**Language**: All documentation should be written in **English**.
