# Native Terminal Compatibility Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an opt-in, Windows-only Claude Code terminal mode that embeds a classic conhost window inside KKCoder without changing the existing xterm/PTY path.

**Architecture:** A new frontend `NativeTerminalTab` reports its physical bounds to a separate Rust `NativeTerminalManager`. The manager launches `conhost.exe -> cmd.exe -> claude`, finds and reparents the conhost HWND, and exposes isolated Tauri commands for lifecycle and positioning. App routing selects this component only for Claude sessions when the persisted mode is `native`.

**Tech Stack:** React 19, TypeScript, Tauri 2, Rust 2021, `windows-sys`, Win32 User/Window APIs, Node test runner, Cargo tests.

---

### Task 1: Terminal mode policy

**Files:**
- Create: `src/utils/terminalMode.ts`
- Test: `src/utils/terminalMode.test.ts`

- [ ] **Step 1: Write failing policy tests**

```ts
assert.equal(resolveClaudeTerminalMode(null), "standard");
assert.equal(resolveClaudeTerminalMode("native"), "native");
assert.equal(shouldUseNativeTerminal("claude", "native"), true);
assert.equal(shouldUseNativeTerminal("pi", "native"), false);
assert.equal(shouldUseNativeTerminal("codex", "native"), false);
```

- [ ] **Step 2: Run the focused test**

Run: `node --test --experimental-strip-types src/utils/terminalMode.test.ts`
Expected: FAIL because `terminalMode.ts` does not exist.

- [ ] **Step 3: Implement the minimal policy**

```ts
export type ClaudeTerminalMode = "standard" | "native";
export const CLAUDE_TERMINAL_MODE_KEY = "kkcoder_setting_claude_terminal_mode";
export const resolveClaudeTerminalMode = (value: string | null): ClaudeTerminalMode =>
  value === "native" ? "native" : "standard";
export const shouldUseNativeTerminal = (agentType: string, mode: ClaudeTerminalMode): boolean =>
  agentType === "claude" && mode === "native";
```

- [ ] **Step 4: Verify the focused test passes**

Run: `node --test --experimental-strip-types src/utils/terminalMode.test.ts`
Expected: 5 assertions pass.

### Task 2: Windows command builder and manager state

**Files:**
- Create: `src-tauri/src/native_terminal/mod.rs`
- Create: `src-tauri/src/native_terminal/command.rs`
- Create: `src-tauri/src/native_terminal/manager.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1: Write Rust tests for Claude command construction**

```rust
assert_eq!(
    build_claude_args(false, "550e8400-e29b-41d4-a716-446655440000"),
    vec!["--dangerously-skip-permissions", "--session-id", "550e8400-e29b-41d4-a716-446655440000"]
);
assert_eq!(
    build_claude_args(true, "550e8400-e29b-41d4-a716-446655440000"),
    vec!["--dangerously-skip-permissions", "--resume", "550e8400-e29b-41d4-a716-446655440000"]
);
```

- [ ] **Step 2: Run Cargo tests and confirm failure**

Run: `cargo test native_terminal::command --lib`
Expected: FAIL because the module is missing.

- [ ] **Step 3: Add isolated manager types**

```rust
pub struct NativeSession {
    pub child: std::process::Child,
    pub hwnd: isize,
}

#[derive(Default)]
pub struct NativeTerminalManager {
    pub sessions: std::sync::Mutex<std::collections::HashMap<String, NativeSession>>,
}
```

- [ ] **Step 4: Add Windows dependency**

```toml
windows-sys = { version = "0.59", features = [
  "Win32_Foundation",
  "Win32_System_Threading",
  "Win32_UI_WindowsAndMessaging"
] }
```

- [ ] **Step 5: Verify Cargo tests pass**

Run: `cargo test native_terminal::command --lib`
Expected: command builder tests pass.

### Task 3: Native conhost lifecycle commands

**Files:**
- Create: `src-tauri/src/native_terminal/window.rs`
- Modify: `src-tauri/src/native_terminal/mod.rs`
- Modify: `src-tauri/src/native_terminal/manager.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Implement Win32 window discovery and embedding helpers**

Use `EnumWindows` plus `GetWindowThreadProcessId` to find the conhost HWND. Remove `WS_CAPTION`, `WS_THICKFRAME`, `WS_SYSMENU`, and `WS_POPUP`; add `WS_CHILD`; call `SetParent` with the Tauri main HWND; then call `SetWindowPos`.

- [ ] **Step 2: Add isolated Tauri commands**

```rust
spawn_native_terminal(session_id, directory, agent_session_id, is_reopen, window, state)
set_native_terminal_bounds(session_id, x, y, width, height, state)
show_native_terminal(session_id, state)
hide_native_terminal(session_id, state)
focus_native_terminal(session_id, state)
close_native_terminal(session_id, state)
```

- [ ] **Step 3: Register only the new manager and commands**

Add `.manage(NativeTerminalManager::default())` and append the six new commands to `generate_handler!`. Do not modify `PtyManager`, `spawn_terminal`, `write_to_terminal`, `resize_terminal`, or `close_terminal`.

- [ ] **Step 4: Compile the Rust backend**

Run: `cargo check`
Expected: exit 0 on Windows.

### Task 4: Native terminal frontend component

**Files:**
- Create: `src/components/NativeTerminalTab.tsx`
- Create: `src/components/NativeTerminalTab.css`

- [ ] **Step 1: Add a component contract test**

Create a source-level test requiring calls to `spawn_native_terminal`, `set_native_terminal_bounds`, `show_native_terminal`, `hide_native_terminal`, and `close_native_terminal` while prohibiting `spawn_terminal`.

- [ ] **Step 2: Run the test and confirm failure**

Run: `node --test --experimental-strip-types src/components/NativeTerminalTab.test.ts`
Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the component**

The component opens one native session on mount, observes its own bounds, sends physical-pixel coordinates using `window.devicePixelRatio`, shows/focuses when active, hides when inactive, and closes on unmount. It renders only an initialization/error surface behind the native HWND.

- [ ] **Step 4: Verify the focused component test**

Run: `node --test --experimental-strip-types src/components/NativeTerminalTab.test.ts`
Expected: PASS.

### Task 5: Settings and isolated App routing

**Files:**
- Modify: `src/components/SettingsModal.tsx`
- Modify: `src/App.tsx`
- Test: `src/utils/terminalMode.test.ts`

- [ ] **Step 1: Add the persisted setting**

Initialize from `CLAUDE_TERMINAL_MODE_KEY`, persist on change, and add a terminal-settings switch labelled `Claude Code 原生兼容模式`. The explanatory text states that it affects newly opened/reopened Claude tabs only.

- [ ] **Step 2: Add one routing branch in App**

```tsx
{shouldUseNativeTerminal(s.type, claudeTerminalMode) ? (
  <NativeTerminalTab ... />
) : (
  <TerminalTab ... />
)}
```

Read the mode once when App initializes and update it through a `kkcoder-claude-terminal-mode-change` event. Do not change `TerminalTab`.

- [ ] **Step 3: Run TypeScript tests and build**

Run: `npm test`
Expected: all tests pass.

Run: `npm run build`
Expected: TypeScript and Vite build pass.

### Task 6: Feasibility verification checkpoint

**Files:**
- No additional source files.

- [ ] **Step 1: Run backend verification**

Run: `cargo test --lib`
Run: `cargo check`
Expected: both exit 0.

- [ ] **Step 2: Run frontend verification**

Run: `npm test`
Run: `npm run build`
Expected: all tests and build pass.

- [ ] **Step 3: Manual Windows acceptance**

Enable native compatibility mode, reopen one Claude session, and verify: the console is embedded in the center pane; no separate taskbar window appears; resize/maximize/tab switching work; keyboard, Chinese IME, mouse wheel, and long scrolling work; standard mode still opens the unchanged xterm terminal.

- [ ] **Step 4: Stop at the checkpoint if any HWND requirement fails**

Do not implement JSONL monitoring or input routing until the embedding checkpoint succeeds on the affected machine.

### Task 7: Feature parity after the checkpoint

**Files:**
- Create: `src-tauri/src/native_terminal/monitor.rs`
- Create: `src-tauri/src/native_terminal/input.rs`
- Modify: `src/components/NativeTerminalTab.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1: Add JSONL event-mapping tests**

Test user message -> busy/user-submitted event; final assistant message -> idle/completed event; first user message -> rename payload.

- [ ] **Step 2: Implement JSONL monitoring using existing `find_claude_jsonl` rules**

Emit `native-terminal-user-message`, `native-terminal-busy`, and `native-terminal-complete` events. Frontend reuses existing rename, activity, badge, and notification handlers.

- [ ] **Step 3: Add native Unicode input routing**

Implement `write_to_native_terminal` using focused Win32 Unicode input events. Route path insertion and queued prompts through the correct standard/native transport without changing standard terminal commands.

- [ ] **Step 4: Verify feature parity**

Run all frontend and Rust tests, builds, then manually verify new session, resume, automatic title, busy badge, completion notification, path insertion, queue submission, close, and reopen.

