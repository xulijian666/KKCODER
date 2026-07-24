# KKCoder 前端源码总目录（Source Index）

> **本文件是前端源码的权威总索引。**  
> 新增 / 删除 / 重命名 / 挪动 `src/` 下的模块时，**必须同步更新本文件**，并视情况更新对应 barrel：`components/index.ts`、`hooks/index.ts`、`utils/index.ts`。

**最后人工维护核对：** 2026-07-24（分屏项目树绑定）

---

## 1. 维护约定（强制）

| 变更类型 | 必须做的事 |
|----------|------------|
| 新增组件 / Hook / util | 写入本文件对应章节；若对外暴露则加入对应 `index.ts` |
| 删除 / 重命名模块 | 本文件改名或删除条目；同步改 barrel 与引用方 |
| 职责变更（文件还在但用途变了） | 更新本文件「职责」一列 |
| 仅改实现、对外契约不变 | **可不**改本文件；若导出符号变化则必须改 |

**导入优先走 barrel：**

```ts
import { Sidebar, SessionTabBar } from "./components";
import { useSessions, useTheme } from "./hooks";
import { generateUUID, log } from "./utils";
```

细则见：`.trellis/spec/frontend/directory-structure.md`  
AI 强制规则：`.cursor/rules/source-index.mdc`

---

## 2. 前端树状总览

```
src/
├── main.tsx                 # React 挂载
├── App.tsx                  # 应用编排层（组合 hooks + 布局）
├── App.css                  # 全局样式 + 主题相关样式
├── vite-env.d.ts            # Vite 类型
├── SOURCE_INDEX.md          # ← 本文件（总目录）
├── components/              # UI 组件 + components/index.ts
├── hooks/                   # 自定义 Hook + hooks/index.ts
├── utils/                   # 纯函数工具 + utils/index.ts
└── assets/                  # 静态资源（图标等）
```

---

## 3. 应用入口

| 文件 | 职责 |
|------|------|
| `main.tsx` | ReactDOM 挂载根组件 |
| `App.tsx` | 窗口壳、会话/标签/分屏/队列/预览编排，组装布局与弹窗 |
| `App.css` | 全局布局、组件样式、主题相关 CSS |
| `vite-env.d.ts` | Vite / 客户端类型声明 |

---

## 4. Barrel 入口（索引串）

| Barrel | 路径 | 作用 |
|--------|------|------|
| 组件 | `components/index.ts` | 统一导出 UI 与部分预览 hook |
| Hooks | `hooks/index.ts` | 统一导出自定义 Hook |
| Utils | `utils/index.ts` | 统一导出常用纯函数与类型 |

> 说明：`useFilePreview` 实现在 `components/FilePreviewPanel.tsx`，经 `hooks/index.ts` 与 `components/index.ts` 双出口 re-export。

---

## 5. `components/` — 组件

| 文件 | 职责 | 经 `index.ts` 导出 |
|------|------|-------------------|
| `index.ts` | 组件 barrel | — |
| `Sidebar.tsx` | 会话列表、搜索、收藏、回收站、Agent 切换 | `Sidebar`, `Session`, `ClaudeIcon`, `PiIcon`, `CodexIcon` |
| `TerminalTab.tsx` | xterm.js 标准 PTY 标签 | `TerminalTab` |
| `NativeTerminalTab.tsx` | Claude 兼容/原生终端标签 | `CompatibilityTerminalTab` |
| `SessionTabBar.tsx` | 顶部标签栏 UI（分屏时双栏对齐；左栏保序待命标签、右栏 secondary） | `SessionTabBar` |
| `TabContextMenu.tsx` | 标签右键菜单（含分屏进出） | `TabContextMenu` |
| `SessionRestorePrompt.tsx` | 启动恢复 Toast + 弹窗 | `SessionRestorePrompt` |
| `CloseConfirmModal.tsx` | 退出确认（托盘/退出） | `CloseConfirmModal` |
| `TitleBar.tsx` | 自定义标题栏、主题盘、窗口按钮 | `TitleBar` |
| `FilePreviewPanel.tsx` | 文件预览 + `useFilePreview` + 右键菜单组件 | `FilePreviewPanel`, `FilePreviewContextMenu`, `useFilePreview`, 相关类型 |
| `ProjectTree.tsx` | 右侧项目文件树（支持插入另一侧） | `ProjectTree` |
| `ProjectTreeBindingBar.tsx` | 分屏下项目树绑定顶栏（跟随/钉左/钉右） | `ProjectTreeBindingBar` |
| `SettingsModal.tsx` | 设置中心（外观 / 助手 / 终端 / 通知 / 快捷短语 / 会话 / 远程 / 关于） | `SettingsModal` |
| `RemoteSettingsPanel.tsx` | 远程访问 / FRP / 设备配对 | `RemoteSettingsPanel` |
| `NewSessionModal.tsx` | 新建会话 | `NewSessionModal` |
| `MdEditorModal.tsx` | CLAUDE.md / AGENTS.md 编辑 | `MdEditorModal` |
| `FileEditorModal.tsx` | 文本文件编辑 | `FileEditorModal` |
| `DirectoryPickerModal.tsx` | 目录选择 | `DirectoryPickerModal` |
| `ConfirmModal.tsx` | 通用确认框 | `ConfirmModal` |
| `AppToastHost.tsx` | 应用级静默 Toast 栈（替代原生 alert） | `AppToastHost` |
| `DirectoryPickerModal.css` | 目录选择器样式 | — |
| `NativeTerminalTab.css` | 兼容终端样式 | — |
| `NativeTerminalTab.test.ts` | 兼容终端测试 | — |
| `NativeTerminalRouting.test.ts` | App 路由到兼容终端的结构断言 | — |

---

## 6. `hooks/` — 自定义 Hook

| 文件 | 职责 | 经 `index.ts` 导出 |
|------|------|-------------------|
| `index.ts` | Hook barrel | — |
| `useSessions.ts` | 会话 CRUD、启动加载、远程 spawn、回收站 | `useSessions`, `AgentType` |
| `useSessionTabs.ts` | 标签开闭/拖拽/恢复队列/右键状态 | `useSessionTabs`, `TabContextMenuState` |
| `useTerminalSplit.ts` | 最多 2 路左右分屏（固定右侧、拖条调比例、拖标签进右屏） | `useTerminalSplit` |
| `useProjectTreeBinding.ts` | 分屏下项目树绑定会话解析 | `useProjectTreeBinding` |
| `useSessionQueueEngine.ts` | 任务队列状态与自动调度 | `useSessionQueueEngine` |
| `useUnreadCompletions.ts` | AI 完成闪烁、焦点、任务栏角标 | `useUnreadCompletions` |
| `useAutoRename.ts` | 空闲/触发会话改名 | `useAutoRename` |
| `useWindowChrome.ts` | 窗体尺寸、关闭策略、标题栏拖拽 | `useWindowChrome` |
| `useTheme.ts` | 主题状态与下拉 | `useTheme` |
| `usePanelResize.ts` | 侧栏/项目树水平拖拽调宽 | `usePanelResize` |
| `useShortcuts.ts` | 快捷短语状态 | `useShortcuts` |
| `useTabFlipAnimation.ts` | 标签 FLIP 动画 | `useTabFlipAnimation` |
| `useAppFeedback.ts` | 订阅反馈总线，驱动 Toast / 确认队列 | `useAppFeedback` |
| `useReturnTerminalFocusWhenUnblocked.ts` | 叠加层关闭后归还终端焦点 | `useReturnTerminalFocusWhenUnblocked` |
| （re-export）`FilePreviewPanel` 内 | 文件预览逻辑 | `useFilePreview`, `UseFilePreviewOptions` |

---

## 7. `utils/` — 工具库

| 文件 | 职责 | 经 `index.ts` 导出（主要） |
|------|------|---------------------------|
| `index.ts` | Utils barrel | — |
| `uuid.ts` | 安全 UUID | `generateUUID` |
| `log.ts` | 持久化前端日志 | `log` |
| `pathHelpers.ts` | 路径展示 | `getFolderName` |
| `theme.ts` | 6 套主题 CSS 变量 / apply | `applyTheme`, `readStoredTheme`, `persistTheme`, `DEFAULT_THEME`, `THEME_STORAGE_KEY` |
| `sessionQueue.ts` | 队列纯函数 | `clearSessionQueue`, `enqueueSessionTask`, `getSessionQueue`, `removeSessionTask`, `QueueBySession` |
| `enabledAgents.ts` | Agent 启用开关与可见列表 | `loadEnabledAgents`, `saveEnabledAgents`, `isAgentEnabled`, `getVisibleAgents`, `AgentType`, `EnabledAgents` |
| `appFeedback.ts` | 静默反馈总线（notify / confirmAction） | `notify`, `notifyInfo`, `notifySuccess`, `notifyWarning`, `notifyError`, `confirmAction`, `formatFeedbackError` |
| `terminalFocus.ts` | 活动终端焦点契约（request / 判定叠加层 / 可选 sessionId） | `requestActiveTerminalFocus`, `returnFocusToActiveTerminal`, `FOCUS_ACTIVE_TERMINAL_EVENT` |
| `terminalSplit.ts` | 双槽分屏纯函数与持久化；标签拖放 MIME / 读写 sessionId | `SESSION_DRAG_MIME`, `isSessionDragEvent`, `readSessionIdFromDataTransfer`, `TERMINAL_SPLIT_STORAGE_KEY`, `clampSplitRatio`, `pickSplitCompanionSessionId`, `placeSessionBesideInTabOrder`, 类型 |
| `projectTreeBinding.ts` | 项目树绑定策略（跟随聚焦 / 钉左 / 钉右） | `resolveTreeBoundSessionId`, `reconcileProjectTreeBindingMode`, `resolveOtherSplitSessionId`, `ProjectTreeBindingMode` |
| `sessionResume.ts` | 恢复命令与对话标记 | `shouldResumeSession` 等（见文件） |
| `sessionActivity.ts` | 最近活动时间 | `updateSessionLastUserMessageAt` |
| `sessionCleanup.ts` | 清理设置读写 | `readSessionCleanupSettings` 等 |
| `sessionTitle.ts` | 会话标题推导 | 按需直接 import |
| `unreadCompletions.ts` | 未读完成集合 | `addUnreadCompletion`, `getUnreadCompletionCount`, `markSessionRead` |
| `taskbarBadge.ts` | 任务栏角标 | `syncTaskbarUnreadBadge` |
| `terminalMode.ts` | standard / native 模式 | `CLAUDE_TERMINAL_MODE_KEY`, `resolveClaudeTerminalMode`, `shouldUseNativeTerminal`, `ClaudeTerminalMode` |
| `terminalTransport.ts` | 写入命令路由 | `resolveTerminalWriteCommand` |
| `terminalKeyPolicy.ts` | Ctrl+C 等策略 | 按需 |
| `terminalScheme.ts` | 终端配色方案 | 按需（Settings 使用） |
| `nativeTerminalLifecycle.ts` | 原生终端生命周期工厂 | 按需 |
| `markdown.ts` | Markdown → HTML | 按需 |
| `highlighter.ts` | 代码高亮行 | 按需 |
| `textFiles.ts` | 可预览文本类型 | 按需 |
| `materialFileIcons.ts` | 文件图标映射 | 按需 |
| `*.test.ts` | 上述工具的单元测试 | — |

未全部塞进 `utils/index.ts` 的模块：**允许**从具体文件 import；若开始被多处使用，应加入 barrel 并更新本表。

---

## 8. 会话域依赖关系（简图）

```
App.tsx
  ├─ useWindowChrome / useTheme / usePanelResize / useShortcuts
  ├─ useAppFeedback → AppToastHost / ConfirmModal（全局静默反馈）
  ├─ useReturnTerminalFocusWhenUnblocked（叠加层关闭 → 终端焦点）
  ├─ useSessionTabs  ←→ (refs) useSessions / useSessionQueueEngine
  ├─ useTerminalSplit（双槽分屏 · 与 activeSessionId 协同）
  ├─ useProjectTreeBinding（项目树绑定左/右/跟随）
  ├─ useUnreadCompletions
  ├─ useAutoRename
  ├─ useFilePreview → FilePreviewPanel
  └─ UI: Sidebar, SessionTabBar, TabContextMenu,
         SessionRestorePrompt, CloseConfirmModal, TitleBar, ...
```

跨模块循环依赖用 **ref 桥**（见 `App.tsx` 内 `*Ref`）断开，勿再把状态揉回单文件上帝组件。

---

## 9. 后端索引（指针）

Rust 侧不在本文件逐文件维护；结构见：

- `.trellis/spec/frontend/directory-structure.md` →「后端模块组织」
- 入口：`src-tauri/src/lib.rs`，子模块 `native_terminal/`、`remote/`

若拆分 `lib.rs`，建议另建 `src-tauri/SOURCE_INDEX.md` 或扩展本节。

---

## 10. 变更检查清单（提交前）

- [ ] 本文件已更新条目
- [ ] 对应 `index.ts` 导出已对齐
- [ ] `App.tsx` / 调用方 import 路径正确
- [ ] `npm run build` / 相关测试通过
