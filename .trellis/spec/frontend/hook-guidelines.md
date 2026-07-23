# 自定义 Hook 规范

> KKCoder 的自定义 Hook 命名、数据获取与生命周期管理模式。

---

## Hook 命名约定

| 类型 | 命名规则 | 示例 |
|------|----------|------|
| 自定义 Hook | `use` 前缀 + 描述性名称 | `useSessionQueue`, `useNativeTerminalLifecycle` |
| 工厂函数 | `create` 前缀 + 描述性名称 | `createNativeTerminalLifecycle` |
| 解析函数 | `resolve` 前缀 | `resolveClaudeTerminalMode`, `resolveTerminalWriteCommand` |
| 判断函数 | `should` / `can` / `is` 前缀 | `shouldUseNativeTerminal`, `shouldResumeSession` |
| 构建函数 | `build` 前缀 | `buildCmdResumeCommand`, `buildPowerShellResumeCommand` |
| 获取函数 | `get` 前缀 | `getFolderName`, `getSessionQueue`, `getUnreadCompletionCount` |

---

## 自定义 Hook 模式

### 状态 Hook — useSessionQueue

```ts
// src/utils/sessionQueue.ts
import { useState, useCallback } from "react";

export const useSessionQueue = () => {
  const [queue, setQueue] = useState<QueueBySession>({});

  const enqueue = useCallback((sessionId: string, task: QueueTask) => {
    setQueue((prev) => ({
      ...prev,
      [sessionId]: [...(prev[sessionId] || []), task],
    }));
  }, []);

  const dequeue = useCallback((sessionId: string) => {
    setQueue((prev) => {
      const rest = { ...prev };
      const tasks = rest[sessionId] || [];
      if (tasks.length <= 1) {
        delete rest[sessionId];
      } else {
        rest[sessionId] = tasks.slice(1);
      }
      return rest;
    });
  }, []);

  return { queue, enqueue, dequeue, getSessionTasks: (id) => queue[id] || [] };
};
```

### 生命周期工厂 — createNativeTerminalLifecycle

```ts
// src/utils/nativeTerminalLifecycle.ts
export const createNativeTerminalLifecycle = (
  spawn: () => Promise<void>,
  close: () => Promise<void>,
): NativeTerminalLifecycle => {
  let generation = 0;
  let spawnPromise: Promise<void> | null = null;

  return {
    acquire() {
      generation += 1;
      const ticket = generation;
      spawnPromise ??= Promise.resolve().then(spawn);
      return {
        ticket,
        ready: spawnPromise.then(() => generation === ticket),
      };
    },
    async release(ticket) {
      const pendingSpawn = spawnPromise;
      if (!pendingSpawn) return;
      try { await pendingSpawn; } catch { return; }
      await Promise.resolve();
      if (generation !== ticket || spawnPromise !== pendingSpawn) return;
      await close();
      spawnPromise = null;
    },
  };
};
```

### 在组件中使用

```tsx
// NativeTerminalTab.tsx
const lifecycleRef = useRef<NativeTerminalLifecycle | null>(null);

useEffect(() => {
  lifecycleRef.current = createNativeTerminalLifecycle(
    async () => { /* spawn terminal */ },
    async () => { /* close terminal */ },
  );
  return () => {
    lifecycleRef.current?.release(0);
  };
}, [sessionId]);
```

---

## 数据获取模式

### Tauri invoke (后端通信)

```ts
// 直接调用 — 简单场景
const result = await invoke<Session[]>("get_sessions");

// 带参数
await invoke("create_session", { name, path, type });

// 错误处理
invoke("launch_ccswitch", { path }).catch((err) => {
  alert(`启动失败: ${err}`);
});
```

### 事件监听

```ts
useEffect(() => {
  let unlisten: UnlistenerFn | null = null;

  listen("terminal-output", (event) => {
    const output = event.payload as string;
    terminal.write(output);
  }).then((fn) => { unlisten = fn; });

  return () => { unlisten?.(); };
}, []);
```

---

## 副作用管理

### 标准 useEffect 模式

```tsx
useEffect(() => {
  // 初始化逻辑
  const initialize = async () => {
    const sessions = await invoke<Session[]>("get_sessions");
    setSessions(sessions);
  };
  initialize();

  // 清理函数
  return () => {
    // 取消订阅、清理资源
  };
}, [dependency1, dependency2]);  // 明确的依赖数组
```

### 事件监听器注册

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

### 拖拽/鼠标全局事件

```tsx
useEffect(() => {
  if (!isResizing) return;

  document.body.style.userSelect = "none";
  document.body.style.cursor = "col-resize";

  const handleMouseMove = (e: MouseEvent) => {
    const newWidth = Math.max(200, Math.min(450, e.clientX));
    setSidebarWidth(newWidth);
  };
  const handleMouseUp = () => {
    setIsResizing(false);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };

  document.addEventListener("mousemove", handleMouseMove);
  document.addEventListener("mouseup", handleMouseUp);

  return () => {
    document.removeEventListener("mousemove", handleMouseMove);
    document.removeEventListener("mouseup", handleMouseUp);
    document.body.style.userSelect = "";
    document.body.style.cursor = "";
  };
}, [isResizing]);
```

---

## localStorage 持久化 Hook

### 状态 + localStorage 同步

```tsx
const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
  const saved = localStorage.getItem("kkcoder_sidebar_width");
  return saved ? parseInt(saved, 10) : 300;
});

useEffect(() => {
  localStorage.setItem("kkcoder_sidebar_width", sidebarWidth.toString());
}, [sidebarWidth]);
```

### localStorage Key 命名约定

```
kkcoder_setting_<name>     — 用户设置项
kkcoder_sidebar_width      — 侧边栏宽度
kkcoder_show_project_tree  — 项目树显示状态
kkcoder_cached_<name>      — 缓存数据
kkcoder_logs               — 调试日志
```

---

## 禁止模式

| 禁止行为 | 正确做法 |
|----------|----------|
| 在 Hook 中直接修改 DOM | 使用 ref + useEffect |
| 在 useEffect 中省略依赖数组 | 总是声明完整依赖 |
| 在循环或条件中调用 Hook | 只在组件顶层调用 Hook |
| 在 Hook 中直接 throw | 使用 try/catch 或返回错误状态 |
| 忽略 useEffect 清理函数 | 总是返回清理函数 |

---

**Language**: All documentation should be written in **English**.
