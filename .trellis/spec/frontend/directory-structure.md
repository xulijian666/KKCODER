# 目录结构与文件组织

> KKCoder 的模块组织约定 — 基于 Tauri v2 + React + TypeScript 架构。

> **前端源码权威总目录：** [`src/SOURCE_INDEX.md`](../../../src/SOURCE_INDEX.md)  
> 新增 / 删除 / 重命名 `src/` 模块时 **必须** 同步更新该文件。强制规则：`.cursor/rules/source-index.mdc`。

---

## 顶层目录结构

```
KKCODER/
├── src/                          # 前端源码 (React + TypeScript)
│   ├── SOURCE_INDEX.md           # 前端源码权威总目录（强制维护）
│   ├── App.tsx                   # 应用编排层
│   ├── App.css                   # 全局样式 + 主题相关样式
│   ├── main.tsx                  # React DOM 挂载入口
│   ├── vite-env.d.ts             # Vite 环境类型声明
│   ├── components/               # 可复用 UI 组件 + index.ts
│   ├── hooks/                    # 自定义 Hook + index.ts
│   ├── utils/                    # 纯函数工具 + index.ts
│   └── assets/                   # 静态资源 (SVG 图标等)
├── src-tauri/                    # Tauri 后端 (Rust)
│   ├── src/
│   │   ├── main.rs               # 后端程序入口
│   │   ├── lib.rs                # SQLite / PTY / 通知核心逻辑
│   │   ├── native_terminal/      # 原生终端兼容模式模块
│   │   └── remote/               # 远程访问 (WebSocket / FRP) 模块
│   ├── capabilities/             # Tauri 安全权限配置
│   └── tauri.conf.json           # Tauri 打包与窗口配置
├── docs/                         # 项目文档
│   ├── superpowers/specs/        # 功能设计规格文档
│   └── superpowers/plans/        # 实施计划文档
├── .trellis/                     # Trellis 工作流系统
├── .cursor/                      # Cursor AI 配置 (commands/skills/agents/hooks)
├── .claude/                      # Claude Code 配置
├── .codex/                       # Codex 配置
└── .agents/skills/               # 跨平台共享 skills
```

---

## 前端模块组织

**完整文件级清单以 [`src/SOURCE_INDEX.md`](../../../src/SOURCE_INDEX.md) 为准。** 下文保留组织约定与摘要。

### Barrel 入口

| 入口 | 路径 |
|------|------|
| 组件 | `src/components/index.ts` |
| Hooks | `src/hooks/index.ts` |
| Utils | `src/utils/index.ts` |

### components/ — 组件目录

每个组件遵循以下约定：

| 文件 | 用途 | 示例 |
|------|------|------|
| `ComponentName.tsx` | 组件主体 (PascalCase) | `Sidebar.tsx`, `TerminalTab.tsx` |
| `ComponentName.css` | 组件样式 (可选，与组件同目录) | `NativeTerminalTab.css` |
| `ComponentName.test.ts` | 组件测试 (可选) | `NativeTerminalTab.test.ts` |
| `index.ts` | 组件统一导出入口 | `from "./components"` |

**核心组件清单：**

| 组件 | 职责 |
|------|------|
| `Sidebar` | 会话列表、项目树、搜索、收藏、回收站 |
| `TerminalTab` | xterm.js 虚拟终端标签页 (PTY 模式) |
| `NativeTerminalTab` | 原生终端兼容模式 (HWND 嵌入) |
| `TitleBar` | 自定义标题栏、主题切换、窗口控制 |
| `SessionTabBar` | 顶部会话标签栏（拖拽/重命名/忙碌态） |
| `TabContextMenu` | 标签页右键菜单 |
| `SessionRestorePrompt` | 启动恢复 Toast + 选择弹窗 |
| `CloseConfirmModal` | 退出确认（托盘/退出） |
| `FilePreviewPanel` | 文件预览、查找、跳行、添加到对话 |
| `NewSessionModal` | 新建会话弹窗 |
| `SettingsModal` | 系统设置弹窗 (主题、终端、提示音) |
| `RemoteSettingsPanel` | 远程访问 / FRP / 设备配对设置 |
| `MdEditorModal` | CLAUDE.md / AGENTS.md 编辑器 |
| `FileEditorModal` | 文件编辑器弹窗 |
| `ProjectTree` | 右侧项目文件树 |
| `DirectoryPickerModal` | 目录选择器弹窗 |
| `ConfirmModal` | 通用确认弹窗 |

### hooks/ — 自定义 Hook

| 文件 | 职责 |
|------|------|
| `index.ts` | Hook 统一导出入口 |
| `usePanelResize.ts` | 侧边栏/项目树水平拖拽调宽 |
| `useTheme.ts` | 主题状态、下拉菜单与 CSS 变量应用 |
| `useShortcuts.ts` | 快捷短语本地状态与变更监听 |
| `useAutoRename.ts` | 会话名称自动修正（heuristic / LLM） |
| `useSessionQueueEngine.ts` | 任务队列状态与自动调度 |
| `useSessions.ts` | 会话 CRUD、启动加载、远程 spawn、回收站 |
| `useSessionTabs.ts` | 标签打开/关闭/拖拽/恢复队列/右键菜单状态 |
| `useUnreadCompletions.ts` | AI 完成闪烁、焦点、任务栏角标 |
| `useWindowChrome.ts` | 窗口尺寸/关闭行为/标题栏拖拽 |
| `useTabFlipAnimation.ts` | 标签页 FLIP 排序动画 |

### utils/ — 工具函数目录

纯函数工具库，按职责划分文件；`utils/index.ts` 为统一导出入口。

| 文件 | 职责 |
|------|------|
| `uuid.ts` | 安全 UUID 生成 |
| `log.ts` | 持久化前端日志 |
| `pathHelpers.ts` | 路径展示辅助 |
| `theme.ts` | 6 套主题 CSS 变量与 applyTheme |
| `sessionTitle.ts` | 会话标题推导 |
| `sessionResume.ts` | 会话恢复命令构建 |
| `sessionActivity.ts` | 会话活动时间格式化与排序 |
| `sessionQueue.ts` | 会话任务队列管理 |
| `sessionCleanup.ts` | 会话清理设置 |
| `terminalMode.ts` | 终端模式解析 (standard/native) |
| `terminalKeyPolicy.ts` | 终端按键策略 (Ctrl+C 行为) |
| `terminalScheme.ts` | 终端主题色同步 |
| `terminalTransport.ts` | 终端写入命令路由 |
| `nativeTerminalLifecycle.ts` | 原生终端生命周期管理 |
| `markdown.ts` | Markdown 渲染 |
| `highlighter.ts` | 代码高亮 |
| `textFiles.ts` | 文本文件类型检测 |
| `unreadCompletions.ts` | AI 回答未读计数 |
| `taskbarBadge.ts` | 任务栏未读角标 |

---

## 后端模块组织 (Rust)

```
src-tauri/src/
├── main.rs                       # 入口 + Tauri builder
├── lib.rs                        # 数据库迁移 + PTY 锁 + 音效
├── native_terminal/              # 原生终端模块
│   ├── mod.rs                    # 模块入口
│   ├── manager.rs                # 终端管理器
│   ├── command.rs                # 命令执行
│   └── boundary.rs               # 边界处理
└── remote/                       # 远程访问模块
    ├── mod.rs                    # 模块入口
    ├── server.rs                 # WebSocket 服务端
    ├── auth.rs                   # 认证
    ├── conversation.rs           # 会话协议
    ├── state.rs                  # 状态管理
    ├── session_actor.rs          # Session Actor
    ├── ws.rs                     # WebSocket 连接
    ├── frp.rs                    # FRP 穿透
    ├── handlers.rs               # 请求处理器
    ├── tui_watcher.rs            # TUI 进程监控
    └── tui_detector.rs           # TUI 进程检测
```

---

## 文件命名约定

| 类型 | 约定 | 示例 |
|------|------|------|
| React 组件 | PascalCase | `Sidebar.tsx`, `TerminalTab.tsx` |
| 工具函数 | camelCase | `sessionTitle.ts`, `terminalMode.ts` |
| CSS 样式 | 与组件同名 | `NativeTerminalTab.css` |
| 测试文件 | `*.test.ts` | `terminalMode.test.ts` |
| 类型声明 | `*.d.ts` | `vite-env.d.ts` |
| Rust 模块 | snake_case | `native_terminal/mod.rs` |

---

## 导入路径约定

```ts
// 相对路径 — 同目录或子目录
import { ConfirmModal } from "./ConfirmModal";
import { resolveCtrlCAction } from "../utils/terminalKeyPolicy";

// 跨模块引用（优先走 index 聚合入口；清单见 src/SOURCE_INDEX.md）
import { Sidebar, Session, TitleBar, FilePreviewPanel } from "./components";
import { generateUUID, log, shouldResumeSession } from "./utils";
import { useTheme, useWindowChrome, useFilePreview } from "./hooks";
```

---

## Source index maintenance

When adding, removing, or renaming modules under `src/`, update **`src/SOURCE_INDEX.md`** in the same change. Do not treat this document as a substitute for that index.

---

## 资源文件约定

| 类型 | 位置 | 说明 |
|------|------|------|
| SVG 图标 | `src/assets/material-icons/` | 单色线条图标，`stroke="currentColor"` |
| 静态资源 | `public/` | 直接通过 `/filename` 引用 |
| 文档 | `docs/` | Markdown 格式 |

---

**Language**: All documentation should be written in **English**.
