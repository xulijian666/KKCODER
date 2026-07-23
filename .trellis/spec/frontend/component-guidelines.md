# 组件规范

> KKCoder 的 React 组件设计模式、Props 约定与组合规范。

---

## 组件定义模式

### 函数式组件 + React.FC

所有组件使用 `React.FC<Props>` 类型定义：

```tsx
// ConfirmModal.tsx — 标准组件定义
export const ConfirmModal: React.FC<ConfirmModalProps> = ({
  show,
  title,
  message,
  confirmText = "确定",
  cancelText = "取消",
  onConfirm,
  onCancel,
  isDanger = false,
}) => {
  if (!show) return null;
  return ( /* ... */ );
};
```

### Props 接口定义

Props 接口在组件文件顶部定义，使用 `{ComponentName}Props` 命名：

```tsx
interface ConfirmModalProps {
  show: boolean;
  title: string;
  message: string | React.ReactNode;
  confirmText?: string;     // 可选参数带默认值
  cancelText?: string;
  onConfirm: () => void;
  onCancel: () => void;
  isDanger?: boolean;
}
```

---

## 组件状态管理

### 本地状态 — useState + useRef

```tsx
// 标准状态声明
const [sessions, setSessions] = useState<Session[]>([]);
const [activeSessionId, setActiveSessionId] = useState<string>("");

// 需要跨渲染保持但不触发重渲染的值用 useRef
const activeSessionIdRef = useRef<string>("");
useEffect(() => {
  activeSessionIdRef.current = activeSessionId;
}, [activeSessionId]);
```

### 从 localStorage 初始化的状态

```tsx
const [currentTheme, setCurrentTheme] = useState<string>(() => {
  return localStorage.getItem("kkcoder_setting_theme") || "light-premium";
});

const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
  const saved = localStorage.getItem("kkcoder_sidebar_width");
  return saved ? parseInt(saved, 10) : 300;
});
```

### 计算开销大的值 — useMemo

```tsx
const appWindow = useMemo(() => getCurrentWindow(), []);
```

### 稳定回调 — useCallback

```tsx
const handleMinimize = useCallback(() => {
  appWindow.minimize().catch((err) => log(`Failed to minimize: ${err}`));
}, [appWindow]);
```

---

## Ref 转发模式

组件内部 ref 通过 props 传递，使用 `useRef` + `useEffect` 保持同步：

```tsx
export const CompatibilityTerminalTab: React.FC<CompatibilityTerminalTabProps> = ({
  sessionId,
  onSpawned,
  onStateChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);

  // 回调 ref 同步 — 避免 stale closure
  const onSpawnedRef = useRef(onSpawned);
  onSpawnedRef.current = onSpawned;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
};
```

---

## 组件组合规范

### 条件渲染

```tsx
// 简单条件 — 早期返回
if (!show) return null;

// 复杂条件 — 三元表达式
{isDanger
  ? <button className="danger-style" />
  : <button className="normal-style" />
}
```

### 列表渲染

```tsx
{sessions.map((session) => (
  <SessionItem
    key={session.id}
    session={session}
    isActive={session.id === activeSessionId}
    onSelect={handleSelectSession}
  />
))}
```

---

## 事件处理约定

### DOM 事件

```tsx
// 拖拽处理
const startResize = (e: React.MouseEvent) => {
  e.preventDefault();
  setIsResizing(true);
};

// 点击外部关闭
<div className="modal-overlay" onClick={onCancel}>
  <div className="modal-card" onClick={(e) => e.stopPropagation()}>
    {/* 内容 */}
  </div>
</div>
```

### 自定义事件 (跨组件通信)

```tsx
// 派发事件
window.dispatchEvent(new CustomEvent("kkcoder-claude-terminal-mode-change", {
  detail: "native"
}));

// 监听事件
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

## Tauri 后端通信

### invoke 调用

```tsx
import { invoke } from "@tauri-apps/api/core";

// 调用 Rust 命令
invoke("launch_ccswitch", { path }).catch((err) => {
  alert(`启动 ccswitch.exe 失败:\n${err}`);
});
```

### 事件监听

```tsx
import { listen, type UnlistenerFn } from "@tauri-apps/api/event";

useEffect(() => {
  const unlisten = listen("terminal-output", (event) => {
    // 处理终端输出
  });
  return () => { unlisten.then((fn) => fn()); };
}, []);
```

---

## 组件样式约定

### CSS 文件组织

- 全局样式：`App.css`（主题变量 + 全局组件样式）
- 组件样式：`ComponentName.css`（与组件同目录，可选）

### CSS 变量引用

```css
/* 正确 — 使用 CSS 变量 */
.modal-card {
  background-color: var(--bg-sidebar);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

/* 禁止 — 硬编码颜色 */
.modal-card {
  background-color: #ffffff;  /* 禁止！ */
  color: #333333;            /* 禁止！ */
}
```

---

## 禁止模式

| 禁止行为 | 正确做法 |
|----------|----------|
| 在组件中硬编码颜色值 | 使用 `var(--xxx)` CSS 变量 |
| 使用 `any` 类型 | 定义具体接口或使用泛型 |
| 在 useEffect 中忽略清理函数 | 总是返回清理函数 |
| 在循环中使用 index 作为 key | 使用唯一稳定的 ID |
| 在组件内部直接操作 DOM | 使用 ref + useEffect |
| 使用 `React.FC` 而不定义 Props | 总是定义 Props 接口 |

---

**Language**: All documentation should be written in **English**.
