pub mod boundary;
pub mod command;
pub mod manager;

use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::{AppHandle, Emitter, State};

use self::boundary::safe_emit_boundary;
use self::command::build_claude_args;
use self::manager::{NativeSession, NativeTerminalManager};

const READER_BUFFER_SIZE: usize = 16 * 1024;
const PENDING_BUFFER_LIMIT: usize = 256 * 1024;

#[tauri::command]
pub fn spawn_compat_terminal(
    app_handle: AppHandle,
    manager: State<'_, NativeTerminalManager>,
    session_id: String,
    directory: String,
    agent_session_id: String,
    is_reopen: bool,
    initial_cols: Option<u16>,
    initial_rows: Option<u16>,
) -> Result<(), String> {
    {
        let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
        if sessions.contains_key(&session_id) {
            return Ok(());
        }
    }

    let directory_path = std::path::Path::new(&directory);
    if !directory_path.is_dir() {
        return Err(format!("项目目录不存在或不是文件夹: {directory}"));
    }

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows: initial_rows.unwrap_or(24).clamp(8, 120),
            cols: initial_cols.unwrap_or(80).clamp(40, 300),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("创建兼容 PTY 失败: {error}"))?;

    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = CommandBuilder::new("powershell.exe");
        command.arg("-NoLogo");
        command.arg("-NoProfile");
        command.arg("-ExecutionPolicy");
        command.arg("Bypass");
        command
    };
    #[cfg(not(target_os = "windows"))]
    let mut command = CommandBuilder::new("bash");

    command.cwd(std::path::PathBuf::from(&directory));
    command.env("TERM", "xterm-256color");
    command.env("COLORTERM", "truecolor");
    command.env("TERM_PROGRAM", "KKCoder-Compatibility");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| format!("启动兼容终端 Shell 失败: {error}"))?;
    drop(pair.slave);

    let master = pair.master;
    let writer = master
        .take_writer()
        .map_err(|error| format!("获取兼容终端输入流失败: {error}"))?;
    let mut reader = master
        .try_clone_reader()
        .map_err(|error| format!("获取兼容终端输出流失败: {error}"))?;
    let master = Arc::new(Mutex::new(master));
    let writer = Arc::new(Mutex::new(writer));
    let child = Arc::new(Mutex::new(child));

    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    sessions.insert(
        session_id.clone(),
        NativeSession {
            master: master.clone(),
            writer: writer.clone(),
            child: child.clone(),
        },
    );
    drop(sessions);

    let event_name = format!("compat-terminal-output-{session_id}");
    let sessions_for_reader = manager.sessions.clone();
    let session_id_for_reader = session_id.clone();
    std::thread::spawn(move || {
        let mut buffer = [0u8; READER_BUFFER_SIZE];
        let mut pending = Vec::<u8>::with_capacity(READER_BUFFER_SIZE * 2);
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(read) => {
                    pending.extend_from_slice(&buffer[..read]);
                    let safe = safe_emit_boundary(&pending);
                    if safe > 0 {
                        let encoded = STANDARD.encode(&pending[..safe]);
                        let _ = app_handle.emit(&event_name, encoded);
                        pending.drain(..safe);
                    } else if pending.len() > PENDING_BUFFER_LIMIT {
                        let encoded = STANDARD.encode(&pending);
                        let _ = app_handle.emit(&event_name, encoded);
                        pending.clear();
                    }
                }
                Err(_) => break,
            }
        }
        if !pending.is_empty() {
            let _ = app_handle.emit(&event_name, STANDARD.encode(&pending));
        }
        if let Ok(mut sessions) = sessions_for_reader.lock() {
            sessions.remove(&session_id_for_reader);
        }
    });

    let claude_command = format!("claude {}\r\n", build_claude_args(is_reopen, &agent_session_id).join(" "));
    std::thread::sleep(std::time::Duration::from_millis(300));
    let mut input = writer.lock().map_err(|e| e.to_string())?;
    input
        .write_all(claude_command.as_bytes())
        .map_err(|error| format!("启动 Claude Code 失败: {error}"))?;
    input.flush().map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn write_to_compat_terminal(
    manager: State<'_, NativeTerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "兼容终端会话不存在".to_string())?;
    let mut writer = session.writer.lock().map_err(|e| e.to_string())?;
    writer.write_all(data.as_bytes()).map_err(|e| e.to_string())?;
    writer.flush().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn resize_compat_terminal(
    manager: State<'_, NativeTerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "兼容终端会话不存在".to_string())?;
    let master = session.master.lock().map_err(|e| e.to_string())?;
    master
        .resize(PtySize {
            rows: rows.max(8),
            cols: cols.max(40),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn close_compat_terminal(
    manager: State<'_, NativeTerminalManager>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = manager.sessions.lock().map_err(|e| e.to_string())?;
    if let Some(session) = sessions.remove(&session_id) {
        let mut child = session.child.lock().map_err(|e| e.to_string())?;
        let _ = child.kill();
    }
    Ok(())
}
