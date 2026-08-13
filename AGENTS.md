# Agent notes (KKCoder)

## Frontend source index (required)

- **Authoritative catalog:** [`src/SOURCE_INDEX.md`](src/SOURCE_INDEX.md)
- **Always-on rule:** [`.cursor/rules/source-index.mdc`](.cursor/rules/source-index.mdc)

When you add, remove, rename, or change exports under `src/`, update `SOURCE_INDEX.md` in the same change, and keep `components/index.ts` / `hooks/index.ts` / `utils/index.ts` aligned when APIs are public.

Organization conventions (not a full file list): `.trellis/spec/frontend/directory-structure.md`.

## GUI 参考

如果涉及到GUI模块的功能，都可以参考 `D:\CODE\desktop-cc-gui`

## 日志（debug 定位必读）

**日志根目录：`src-tauri/logs/`**（dev 模式下即 `D:\MyCode\KKCODER\src-tauri\logs\`）

| 文件 | 内容 |
|------|------|
| `global.log` | 后端全局日志（启动 / 数据库 / 设置 / 无会话上下文事件），旧 `kkcoder_debug.log` 已废弃 |
| `sessions/<sessionId>.log` | **每个 sessionId 单独一个日志文件**：终端 spawn/close、`claude_chat` 发送/恢复/取消/turn 结束、兼容终端、会话注册等 |
| `frontend.log` | 前端操作日志（`utils/log.ts` 批量经 `append_frontend_log` 命令落盘），含标签/会话/聊天/设置/模型选择等操作 |

约定：
- 有 `session_id` 上下文的日志一律写 `log_session(&session_id, ...)`；其余写 `log_to_file(...)`（→ global.log）
- 单文件上限 20MB，超出自动滚动为 `.log.1`
- 前端日志同时保留 localStorage `kkcoder_logs`（上限 500 条）作崩溃追溯保险
- 定位用户 GUI 操作问题：优先看 `logs/frontend.log`（前端操作）与 `logs/sessions/<sessionId>.log`（对应会话的后端行为）配对分析
