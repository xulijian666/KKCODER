# KKCoder：Claude Code GUI 聊天模式（移植 desktop-cc-gui）

> 状态：**开发中**（核心功能完成，待端到端 UI 联调）
> 更新日期：2026-08-12

---

## 1. 需求描述

KKCoder 目前只有一种跑 Claude Code 的方式：**CLI 终端模式**——起一个 PowerShell PTY，往里写
`claude --dangerously-skip-permissions [--session-id|--resume] <agent_session_id>`，用 xterm 渲染
交互式 TUI（黑底命令行界面）。

用户希望参考 **desktop-cc-gui**（ccgui）增加一种 **GUI 聊天模式**：

1. 在「设置 → AI 助手」里新增 **「交互模式」** 选项，可切换 **CLI 终端** / **GUI 聊天**。
2. GUI 模式下，Claude Code 会话渲染成聊天式界面：消息气泡、流式文本输出、推理折叠区、工具调用卡片。
3. 该模式仅对 **Claude** 生效；Pi / Codex 仍走原终端。
4. GUI 模式打开历史会话时，加载之前的对话历史。
5. 底层驱动方式：`claude -p --output-format stream-json` 非交互模式（不用 TUI），这是 ccgui 的核心封装思路。

### 已确定的范围

- ✅ AskUserQuestion 可点击选项卡（本地 MCP bridge，回答后原 turn 继续）
- ✅ `@` 项目文件/目录补全
- ✅ `/` Claude 命令与技能补全
- ✅ 图片输入（选择、粘贴、拖拽、预览、移除）
- ❌ 权限审批 UI（v1 固定 `--dangerously-skip-permissions`）
- ❌ 非图片附件输入
- ❌ 多 provider 隔离（`--settings` 临时配置）
- ❌ token / 成本面板（仅展示 `costUsd`）

---

## 2. 参考项目路径

| 项目 | 路径 | 说明 |
|---|---|---|
| desktop-cc-gui 源码 | `D:\CODE\desktop-cc-gui` | v0.8.8 本地仓库 |
| desktop-cc-gui 安装版 | `D:\SOFTl\ccgui` | cc-gui.exe / cc_gui_daemon.exe |
| 参考项目 GitHub | `https://github.com/zhukunpenglinyutong/desktop-cc-gui` | 上游开源 |

### 参考项目关键文件（移植来源）

| 文件 | 作用 |
|---|---|
| `src-tauri/src/engine/claude.rs`（约 1060-1290 行） | `build_command_with_profile`：`claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages` 命令拼装 |
| `src-tauri/src/engine/claude_message_content.rs`（140-150 行） | stream-json 输入格式：`{"type":"user","message":{"role":"user","content":[{"type":"text","text":"<msg>"}]}}` |
| `src-tauri/src/engine/events.rs` | 统一引擎事件模型（turn:started / text:delta / tool:started 等） |
| `src-tauri/src/engine/claude.rs`（约 2379 行） | Windows 杀进程树 `taskkill /PID <pid> /T /F` |

---

## 3. KKCoder 涉及文件（改动清单）

### 新增文件

| 文件 | 说明 |
|---|---|
| `src-tauri/src/claude_chat/mod.rs` | **后端核心**：`ClaudeChatManager`（turns + started_sessions 状态）、3 条 Tauri 命令、spawn `claude -p` 进程、std::thread 读线程、NDJSON→前端事件 |
| `src-tauri/src/claude_chat/parser.rs` | **NDJSON 解析**：`stream_event` 增量流 + `assistant` 累积回退 + 工具调用配对，含单测 |
| `src-tauri/src/claude_chat/askuser_mcp.rs` | **结构化问答桥**：本地 HTTP MCP server，请求等待与回答回传 |
| `src-tauri/src/claude_chat/catalog.rs` | **输入候选目录**：项目路径搜索、Claude commands/skills 聚合 |
| `src/components/ChatTab.tsx` | **前端核心**：聊天、流式输出、工具卡、补全、问题卡、图片输入 |
| `src/utils/interactionMode.ts` | 交互模式工具：`CLAUDE_INTERACTION_MODE_KEY` / `resolveClaudeInteractionMode` / `shouldUseGuiChat` |
| `src/utils/chatCompletion.ts` | `@` / `/` 光标触发检测与 token 替换纯函数 |

### 修改文件

| 文件 | 改动 |
|---|---|
| `src-tauri/src/lib.rs` | `mod claude_chat;`（9 行）、`.manage(ClaudeChatManager::default())`、generate_handler 加 3 条命令；`log_to_file` 改 `pub(crate)` |
| `src/components/SettingsModal.tsx` | 「AI 助手」区新增「Claude 交互模式」单选按钮组，写 localStorage + 派发 `kkcoder-claude-interaction-mode-change` |
| `src/App.tsx` | 新增 `claudeInteractionMode` 状态 + listener；`tabRuntimeBySession` 加 `useGuiChat`；渲染处三分支 `ChatTab / CompatibilityTerminalTab / TerminalTab` |
| `src/utils/markdown.ts` | 新增 `renderChatMarkdownToHtml`：把 LLM 输出里的原始 HTML 转义（防 prompt injection），用于聊天气泡 |
| `src/utils/index.ts` | 导出 interactionMode |
| `src/components/index.ts` | 导出 ChatTab |
| `src/App.css` | 新增 `.chat-*` 样式（消息气泡、工具卡、输入栏），全用 CSS 变量 |

### 后端命令接口（前端 invoke 用）

```
chat_send_message(sessionId, directory, agentSessionId, text, images)  → 启动 claude -p turn
chat_cancel(sessionId)                                                 → taskkill /T /F 杀进程树
chat_get_history(directory, agentSessionId)                            → 返回历史 [(role, text)]
chat_answer_question(sessionId, requestId, answers)                    → 回答 AskUserQuestion
chat_search_project_entries(directory, query)                          → `@` 文件/目录候选
chat_get_slash_items(directory)                                        → `/` 命令/技能候选
```

### 前端事件通道 `claude-chat-event`（payload 带 sessionId）

| 事件 | 字段 |
|---|---|
| `turn:started` | - |
| `text:delta` / `reasoning:delta` | `text` |
| `tool:started` | `toolId` `toolName` `input` |
| `tool:input` | `toolId` `input`（input_json_delta 增量） |
| `tool:completed` | `toolId` `output` `error` |
| `turn:finished` | `costUsd` `isError` |
| `turn:error` | `message` |
| `question:requested` | `requestId` `questions` |

---

## 4. 技术架构

```
ChatTab.tsx (React)  --invoke-->  claude_chat 模块 (Rust, src-tauri/src/claude_chat/)
  |                              | - chat_send_message: spawn `claude -p` + stream-json
  |  listen("claude-chat-event") | - 读线程逐行解析 NDJSON → 去重文本流
  |  <--- emit ---               | - chat_cancel: taskkill /T /F 杀进程树
  |  localStorage                └ 状态: turns + pending_questions + MCP server
```

**命令构建**（对齐 ccgui claude.rs）：
```
claude -p --input-format stream-json --output-format stream-json --verbose \
  --include-partial-messages --dangerously-skip-permissions \
  [--resume|--session-id] <agent_session_id>
```

**流式策略（CLI 2.1.119 实测验证）**：
- 增量文本/推理走 `stream_event.content_block_delta`（text_delta / thinking_delta）→ **真流式**
- 工具调用走 `content_block_start`（id/name）+ `input_json_delta`（partial_json 拼完整 input）
- `assistant` 累积快照作为旧版 CLI 兼容回退（无 stream_event 时）
- `result` 事件结束 turn（含 cost_usd / session_id）

**会话续聊**：每轮 send 新 spawn 一个进程；首轮 `--session-id` 建会话，之后 `--resume`（claude 从自身 jsonl 续聊）。`started_sessions: HashSet` 记录已建会话。

**结构化问答**：启动一次 loopback HTTP MCP server，Claude turn 通过 `--mcp-config` 获得 `mcp__kkcoder__AskUserQuestion`。工具调用阻塞等待前端问题卡提交，回答作为 MCP `tool_result` 返回，当前 Claude 进程原地继续。

**输入补全**：`@` 在 token 边界触发项目文件/目录搜索；`/` 仅在行首触发并聚合项目级、用户级 Claude commands/skills。键盘支持 ↑/↓、Enter/Tab、Escape。

**图片输入**：前端支持文件选择、剪贴板与拖拽，限制 PNG/JPEG/GIF/WebP、每张 10 MB、每轮 5 张；后端转换为 stream-json base64 image content block。

**进程生命周期**：Windows 用 `cmd /C claude` + `creation_flags(0x08000000)`（隐藏窗口）；cancel 用 `taskkill /PID <pid> /T /F` 杀整树；读线程 EOF 后 `child.wait()` 判退出码，未 finish 且非 0 → `turn:error`。

---

## 5. 实施计划与当前进度

| # | 阶段 | 状态 |
|---|---|---|
| 1 | 后端 `claude_chat` 模块（parser + mod） | ✅ 完成 |
| 2 | lib.rs 注册模块 / State / 命令 | ✅ 完成 |
| 3 | 交互模式设置（interactionMode.ts + SettingsModal） | ✅ 完成 |
| 4 | ChatTab 聊天组件 + 补全 + 问题卡 + 图片 + markdown 安全渲染 | ✅ 完成 |
| 5 | App.tsx 三分支渲染接线 | ✅ 完成 |
| 6 | 编译 / 单测 / 真实 CLI 输出验证 | 🔶 基本完成 |
| 7 | 端到端 UI 联调（tauri dev 实机验证） | ⬜ 待做 |

### 已完成的验证

- ✅ `cargo check` / `cargo check --lib`：编译通过（仅 1 个与本次无关的既有 warning）
- ✅ `cargo test --lib claude_chat`：**8 个解析单测全过**
- ✅ `cargo test --lib real_data_tests`：用真实 `claude -p` 输出（含工具调用）喂解析器，**验证通过**（工具 start/complete 配对、推理流、文本流、cost 提取）
- ✅ `npx tsc --noEmit`：类型检查通过
- ✅ `npx vite build`：生产构建通过
- ✅ `npm test`：32/34 通过，2 个失败为**预先存在**（`enabledAgents.test.ts` 导入未安装的 vitest；`NativeTerminalRouting.test.ts` 断言 HEAD 版本不存在的文本），与本次改动无关

### 待办

1. **端到端 UI 联调**：`npm run tauri dev` 启动，在设置里切「GUI 聊天」→ 新建 claude 会话 → 发消息 → 验证流式文本 / 工具卡 / busy / 取消 / 重开历史
2. 验证 `@`、`/`、图片三种输入入口与 AskUserQuestion 卡片
3. 切回「CLI 终端」验证原终端不受影响；Pi/Codex 在 GUI 模式下仍走 TerminalTab

---

## 6. 验证清单（联调用）

1. `cargo test -p tauri-app --lib claude_chat` — 解析单测
2. `npm run tauri dev` — 启动
3. 设置 → AI 助手 → 交互模式选「GUI 聊天」
4. 新建 claude 会话 → 验证 `@` 文件、`/` 技能/命令、图片选择/粘贴/拖拽
5. 发消息：验证流式文本、工具卡出现/完成、busy 状态、完成回调
6. 触发 AskUserQuestion → 点击/提交选项 → 验证同一 turn 继续
7. 对话中途点取消 → 验证进程树被杀、busy 清除
8. 关 tab 重开 → 验证历史气泡加载
9. 切回「CLI 终端」→ 验证仍走原 CompatibilityTerminalTab
10. Pi/Codex 会话在 GUI 模式下仍走 TerminalTab

---

## 7. 后续可扩展（本轮不做）

权限审批 UI、非图片附件、多 provider 隔离、token/成本面板、历史富结构化（历史里也渲染工具卡/图片）。
