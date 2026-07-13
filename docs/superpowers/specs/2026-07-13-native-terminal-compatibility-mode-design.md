# Claude Code 原生终端兼容模式设计

## 目标

为 Windows 上的 Claude Code 增加一套完全独立的内嵌原生终端后端，绕开现有 `portable-pty -> xterm -> WebView2` 显示链路，同时保留 KKCoder 的项目、标签页和会话管理能力。

兼容模式默认关闭。未开启时，现有终端实现、启动命令和行为保持不变。

## 方案比较

### 方案一：经典 Windows 控制台 HWND 嵌入（采用）

显式启动 `conhost.exe` 和 `cmd.exe`，在其中运行 Claude Code。Rust 获取控制台窗口 HWND，移除标题栏和边框，将其作为子窗口嵌入 KKCoder 主窗口，并根据 React 中终端占位区域的尺寸调整位置。

优点：复用已验证正常的 Windows 原生控制台渲染路径；不经过 xterm；依赖较少；可以与当前 Tauri 架构并存。

风险：跨进程 HWND 嵌入存在 DPI、焦点、层级和窗口生命周期兼容性，需要先做可行性验证。

### 方案二：Windows Terminal WinUI TermControl

通过 WinUI 3/XAML Islands 集成 Windows Terminal 的原生控件。

优点：现代终端体验最好。

缺点：需要引入 C++/WinRT、WinUI 运行时和复杂的安装包依赖，会显著改变当前 Rust/Tauri 构建链路。

### 方案三：自研 DirectWrite/Direct2D 终端

使用终端解析器配合原生 DirectWrite/Direct2D 绘制。

优点：完全可控。

缺点：相当于维护一套新的终端模拟器，输入法、宽字符、ANSI、鼠标协议和性能风险过高。

## 隔离原则

1. 设置键使用独立的 `kkcoder_setting_claude_terminal_mode`，值为 `standard` 或 `native`，默认 `standard`。
2. 兼容模式第一版只作用于 Claude Code；Pi 和 Codex 始终继续使用标准终端。
3. 保留现有 `TerminalTab.tsx`、`spawn_terminal`、`write_to_terminal` 和 `PtyManager` 的标准路径，不在其中加入原生控制台分支。
4. 新增 `NativeTerminalTab.tsx` 和 Rust `native_terminal` 模块，由 App 层根据设置进行组件路由。
5. 原生模式的会话存储仍使用现有 SQLite `sessions` 表，不新增一套会话数据库。
6. 原生模式启动失败时只影响对应标签，不自动启动标准终端，避免同一个 Claude 会话被重复拉起。
7. Windows 之外不显示兼容模式开关，编译时使用 `cfg(target_os = "windows")` 隔离 Win32 代码。

## 总体架构

### 前端组件

新增 `NativeTerminalTab.tsx`，职责仅包括：

- 渲染一个不承载字符内容的终端占位区域。
- 通过 `ResizeObserver` 获取占位区域边界和 `devicePixelRatio`。
- 调用原生终端命令完成创建、绑定、调整尺寸、显示、隐藏和聚焦。
- 标签激活时显示并聚焦对应原生窗口，非激活时隐藏。
- 接收 Rust 发出的会话状态、错误、用户消息和完成事件。
- 将路径插入、队列任务和会话关闭操作路由到原生终端命令。

App 层只增加一次明确路由：Claude 会话且设置为 `native` 时渲染 `NativeTerminalTab`，其他情况继续渲染原 `TerminalTab`。

### Rust 原生终端模块

新增 `src-tauri/src/native_terminal/`：

- `mod.rs`：Tauri 命令和模块入口。
- `manager.rs`：`NativeTerminalManager`，按 KKCoder session ID 保存原生会话。
- `process.rs`：构造并启动 `conhost.exe -> cmd.exe -> claude` 命令。
- `window.rs`：Win32 HWND 查找、去边框、`SetParent`、`SetWindowPos`、显示、隐藏和焦点。
- `input.rs`：使用 Win32 Unicode 输入事件向指定原生控制台发送文本和按键。
- `monitor.rs`：监控 Claude JSONL 会话文件并向前端发出状态事件。

新增独立的 `NativeTerminalManager` 状态，不复用或修改 `PtyManager.sessions`。
每个原生会话加入独立 Windows Job Object，关闭标签或退出应用时终止完整的 conhost、cmd 和 Claude 进程树。

## 会话生命周期

### 新建会话

1. 前端继续生成 KKCoder session ID 和标准 UUID `agentSessionId`。
2. 数据库写入逻辑保持不变。
3. 原生模式调用 `spawn_native_terminal`。
4. Rust 在项目目录启动：

   `conhost.exe cmd.exe /d /k claude --dangerously-skip-permissions --session-id <agentSessionId>`

5. Rust 找到 conhost HWND，移除顶层窗口样式并嵌入主窗口。
6. JSONL 监控器等待对应 `<agentSessionId>.jsonl` 出现。

### 恢复会话

1. 继续使用数据库中的 `agentSessionId`。
2. 启动命令使用：

   `conhost.exe cmd.exe /d /k claude --dangerously-skip-permissions --resume <agentSessionId>`

3. 不使用当前标准终端中的 `/resume` 延时输入逻辑。
4. 恢复失败时在对应标签显示错误，不创建新的 Claude 会话。

### 标签切换与关闭

- 激活标签：`show_native_terminal`，更新位置并聚焦。
- 非激活标签：`hide_native_terminal`。
- 关闭标签：`close_native_terminal`，终止该控制台进程树并销毁 HWND。
- 应用退出：统一关闭所有原生会话，避免遗留 conhost 和 Claude 进程。

## 功能保持

### 自动命名与最近活动时间

复用现有 `find_claude_jsonl` 路径规则。监控器解析新增 JSONL 记录：

- Rust 将用户消息作为 Tauri event 发给前端。
- 前端复用现有 `deriveSessionTitleFromInput` 和会话更新时间逻辑，不在 Rust 中复制标题算法。
- 每次用户消息更新 `last_user_message_at`，并设置 `kkcoder_session_has_dialogue_<sessionId>` 等价状态。

### 忙碌状态与完成提醒

- 发现新的用户消息后标记 busy。
- 根据 Claude JSONL 中的 assistant 消息、工具调用结束和最终停止状态标记 idle。
- 状态变化通过 Tauri event 发送给前端，继续复用侧边栏忙碌点、标签发光和完成提示音。
- 可行性阶段会用真实 Claude JSONL 样本验证完成判定；若 JSONL 无法稳定表达最终停止状态，再增加 Claude Code 的临时会话级 hooks 作为旁路事件源，不修改用户全局 Claude 配置。

### 路径和队列文本插入

- 新增 `write_to_native_terminal` 命令。
- Rust 先激活对应子窗口，再通过 Win32 `SendInput` 的 Unicode 模式输入文本。
- 回车作为独立按键事件发送，保持现有队列任务的提交语义。
- 文件路径仍沿用当前前端格式化和引号规则。

### 搜索和历史记录

继续使用现有 Claude JSONL 搜索与转录读取逻辑，与终端显示后端无关。

## 设置界面

在“终端设置”增加“Claude Code 原生兼容模式”开关：

- 默认关闭。
- 说明文字明确标注仅影响 Claude Code、仅 Windows 可用。
- 修改后只影响新打开或重新打开的 Claude 标签，不热切换正在运行的会话，避免重复进程。
- 设置为标准模式后，下一次打开会话恢复到现有 xterm 后端。

## 可行性验证门槛

正式接入完整会话功能前，必须先完成一个受设置保护的 Windows 可行性阶段，并在目标机器验证：

1. conhost 窗口能够稳定嵌入 Tauri 主窗口，不出现独立任务栏窗口。
2. 主窗口移动、最大化、恢复和拖动尺寸时，原生终端始终与占位区域对齐。
3. 标签切换能正确隐藏和显示多个原生终端。
4. 鼠标、键盘、中文输入法、复制粘贴和滚轮正常。
5. Claude Code 大量输出和滚动不再出现左侧残影。
6. DPI 为 100%、125% 和多显示器切换时坐标正确。

任何一项失败都停止继续扩展功能，优先解决 HWND 嵌入基础问题；不修改标准终端作为补偿。

## 错误处理

- 找不到 `conhost.exe`、`cmd.exe` 或 `claude`：显示明确错误和“使用标准模式重新打开”按钮。
- 找不到控制台 HWND：终止已启动进程，避免产生不可见后台会话。
- `SetParent` 或 DPI 操作失败：记录 Win32 错误码并关闭该原生会话。
- JSONL 监控失败：终端仍可使用，但状态卡显示“活动状态不可用”，不错误地发送完成通知。
- 原生进程意外退出：标签显示退出状态，可选择重新恢复同一 `agentSessionId`。

## 测试策略

### TypeScript

- 默认设置必须选择标准终端。
- 原生模式只路由 Claude 会话，Pi/Codex 始终路由标准终端。
- 设置变化不热切换已运行标签。
- 路径插入和队列提交调用正确的终端传输命令。

### Rust

- 新建和恢复命令参数的转义与 UUID 处理。
- `NativeTerminalManager` 创建、显示、隐藏、关闭状态转换。
- JSONL 用户/assistant 事件到 busy、idle、自动命名事件的映射。
- Win32 错误时的进程清理。

### Windows 集成验证

- 单会话和多会话 HWND 嵌入。
- 中文 IME、Unicode 路径、粘贴和快捷键。
- 窗口 resize、最大化、DPI 变化和标签切换。
- 新建、关闭、重新打开并恢复同一 Claude 会话。
- 标准模式回归测试，确认原有终端行为不变。

## 非目标

- 第一版不为 Pi 或 Codex 提供原生兼容模式。
- 不替换现有远程访问协议。
- 原生模式第一版不提供远程端的实时终端画面；需要远程实时操作时继续使用标准模式。
- 不删除 xterm、portable-pty 或现有终端设置。
- 不在运行中的标签上动态切换终端后端。
- 不把 WinUI TermControl 或自研终端作为本次实现的一部分。
