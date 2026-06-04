// KKCoder Tauri 后端核心代码 - SQLite 数据库持久化及 PTY 虚拟终端控制
use std::sync::{Arc, Mutex};
use std::collections::HashMap;
use tauri::{State, AppHandle, Emitter};
use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};
use std::io::Write;

// 极其可靠的本地调试文件日志输出器，自动写入 kkcoder_debug.log 以便于闪退后追溯
fn log_to_file(message: &str) {
    use std::fs::OpenOptions;
    use std::io::Write;
    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .write(true)
        .append(true)
        .open("kkcoder_debug.log")
    {
        let now = std::time::SystemTime::now();
        let since_the_epoch = now.duration_since(std::time::UNIX_EPOCH).unwrap_or_default();
        let _ = writeln!(file, "[Timestamp: {}ms] {}", since_the_epoch.as_millis(), message);
    }
}

struct ActiveSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn std::io::Write + Send>,
    spawn_token: u64,
}

#[derive(Default)]
pub struct PtyManager {
    sessions: Arc<Mutex<HashMap<String, ActiveSession>>>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct Session {
    id: String,
    name: String,
    project: String,
    path: String,
    #[serde(rename = "type")]
    session_type: String, // "claude" or "pi"
    #[serde(rename = "agentSessionId")]
    agent_session_id: String,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    created_at: Option<String>,
    #[serde(default)]
    favorite: i32, // 0 for normal, 1 for favorite
    #[serde(default)]
    deleted: i32, // 0 for active, 1 for in trash
    #[serde(rename = "deletedAt", skip_serializing_if = "Option::is_none")]
    deleted_at: Option<String>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize)]
struct RecentProject {
    name: String,
    path: String,
}

#[derive(Clone, serde::Serialize)]
struct PtyOutputPayload {
    session_id: String,
    data: String,
}

// 获取本地 SQLite 数据库路径 (工作区 kkcoder.db)
fn get_db_path() -> std::path::PathBuf {
    let mut path = std::env::current_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    path.push("kkcoder.db");
    path
}

// 初始化本地 SQLite 数据库表结构
fn initialize_database() -> Result<(), rusqlite::Error> {
    let db_path = get_db_path();
    log_to_file(&format!("initialize_database called. DB Path: {:?}", db_path));
    let conn = rusqlite::Connection::open(db_path)?;
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            project TEXT NOT NULL,
            path TEXT NOT NULL,
            type TEXT NOT NULL,
            agent_session_id TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            favorite INTEGER DEFAULT 0
        )",
        [],
    )?;

    // 动态平滑迁移：尝试添加 favorite, deleted, deleted_at 字段。忽略错误（若字段已存在）
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN favorite INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN deleted INTEGER DEFAULT 0", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN deleted_at DATETIME", []);

    // 物理清理超过 7 天的已删除会话 (基于本地时间计算或直接按 UTC)
    let _ = conn.execute(
        "DELETE FROM sessions WHERE deleted = 1 AND datetime(deleted_at) < datetime('now', '-7 days')",
        [],
    );

    conn.execute(
        "CREATE TABLE IF NOT EXISTS recent_projects (
            path TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            last_used_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;
    log_to_file("initialize_database completed successfully.");
    Ok(())
}

// ==================== SQLite 数据库 Tauri Commands ====================

// 1. 获取所有持久化保存的终端会话
#[tauri::command]
fn get_sessions() -> Result<Vec<Session>, String> {
    log_to_file("get_sessions command called.");
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| {
        log_to_file(&format!("get_sessions DB open error: {}", e));
        e.to_string()
    })?;
    let mut stmt = conn.prepare("SELECT id, name, project, path, type, agent_session_id, created_at, favorite, deleted, deleted_at FROM sessions ORDER BY created_at ASC")
        .map_err(|e| {
            log_to_file(&format!("get_sessions prepare stmt error: {}", e));
            e.to_string()
        })?;
    
    let rows = stmt.query_map([], |row| {
        Ok(Session {
            id: row.get(0)?,
            name: row.get(1)?,
            project: row.get(2)?,
            path: row.get(3)?,
            session_type: row.get(4)?,
            agent_session_id: row.get(5)?,
            created_at: Some(row.get(6)?),
            favorite: row.get(7)?,
            deleted: row.get(8)?,
            deleted_at: row.get(9)?,
        })
    }).map_err(|e| {
        log_to_file(&format!("get_sessions query map error: {}", e));
        e.to_string()
    })?;

    let mut result = Vec::new();
    for row in rows {
        if let Ok(sess) = row {
            result.push(sess);
        }
    }
    log_to_file(&format!("get_sessions finished. Found {} sessions.", result.len()));
    Ok(result)
}

// 2. 插入或修改会话，并同步登记项目路径到最近使用列表中
#[tauri::command]
fn add_session(session: Session) -> Result<(), String> {
    log_to_file(&format!("add_session command called: id={}, name={}, project={}, path={}, type={}, agent_session_id={}, favorite={}", 
        session.id, session.name, session.project, session.path, session.session_type, session.agent_session_id, session.favorite));
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| {
        log_to_file(&format!("add_session DB open error: {}", e));
        e.to_string()
    })?;
    
    log_to_file("add_session execute INSERT OR REPLACE into sessions...");
    conn.execute(
        "INSERT OR REPLACE INTO sessions (id, name, project, path, type, agent_session_id, favorite, deleted, deleted_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        rusqlite::params![
            &session.id,
            &session.name,
            &session.project,
            &session.path,
            &session.session_type,
            &session.agent_session_id,
            session.favorite,
            session.deleted,
            session.deleted_at,
        ],
    ).map_err(|e| {
        log_to_file(&format!("add_session execute sessions row error: {}", e));
        e.to_string()
    })?;
    log_to_file("add_session sessions row written.");
    
    log_to_file("add_session execute INSERT OR REPLACE into recent_projects...");
    // 更新最近项目使用列表
    conn.execute(
        "INSERT OR REPLACE INTO recent_projects (path, name, last_used_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)",
        [&session.path, &session.project],
    ).map_err(|e| {
        log_to_file(&format!("add_session execute recent_projects row error: {}", e));
        e.to_string()
    })?;
    log_to_file("add_session recent_projects row written.");

    log_to_file("add_session completed successfully.");
    Ok(())
}

// 3. 删除本地持久化的会话 (软删除，移入回收站)
#[tauri::command]
fn delete_session(id: String) -> Result<(), String> {
    log_to_file(&format!("delete_session (soft delete) command called: id={}", id));
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("UPDATE sessions SET deleted = 1, deleted_at = datetime('now', 'localtime') WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 3a. 彻底删除本地持久化的会话 (物理删除)
#[tauri::command]
fn delete_session_permanently(id: String) -> Result<(), String> {
    log_to_file(&format!("delete_session_permanently command called: id={}", id));
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 3b. 恢复从回收站中的会话
#[tauri::command]
fn restore_session(id: String) -> Result<(), String> {
    log_to_file(&format!("restore_session command called: id={}", id));
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("UPDATE sessions SET deleted = 0, deleted_at = NULL WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 3c. 清空回收站
#[tauri::command]
fn empty_trash() -> Result<(), String> {
    log_to_file("empty_trash command called.");
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM sessions WHERE deleted = 1", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

// 4. 读取最近点选的项目路径 (前 20 个，过滤掉左侧栏已不存在的无会话项目)
#[tauri::command]
fn get_recent_projects() -> Result<Vec<RecentProject>, String> {
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn.prepare("SELECT name, path FROM recent_projects WHERE path IN (SELECT DISTINCT path FROM sessions) ORDER BY last_used_at DESC LIMIT 20")
        .map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(RecentProject {
            name: row.get(0)?,
            path: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut result = Vec::new();
    for row in rows {
        if let Ok(proj) = row {
            result.push(proj);
        }
    }
    Ok(result)
}

// ==================== 系统控制与 PTY 引擎 Tauri Commands ====================

// 5. 呼起系统原生目录选择框
#[tauri::command]
fn select_directory() -> Option<String> {
    let folder = rfd::FileDialog::new()
        .set_title("选择项目路径")
        .pick_folder();
    folder.map(|p| p.to_string_lossy().to_string())
}

// 6. 在资源管理器中打开指定项目目录
#[tauri::command]
fn open_project_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = path;
        Err("该操作系统暂不支持直接打开文件夹".to_string())
    }
}

// 7. 拉起本地虚拟终端并运行 Agent (重连会话自动键入 /resume 恢复上下文)
#[tauri::command]
fn spawn_terminal(
    session_id: String,
    directory: String,
    agent_type: String,
    agent_session_id: String,
    is_reopen: bool,
    state: State<'_, PtyManager>,
    app_handle: AppHandle,
) -> Result<(), String> {
    log_to_file(&format!(
        "spawn_terminal called: session_id={}, directory={}, agent_type={}, agent_session_id={}, is_reopen={}",
        session_id, directory, agent_type, agent_session_id, is_reopen
    ));

    // 生成微秒级唯一启动识别 Token，防止 React StrictMode 双重挂载或快速切换导致的多线程重复输入
    let spawn_token = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    log_to_file(&format!("spawn_terminal generated spawn_token: {}", spawn_token));

    // 🎯 检查是否已经在运行中，若是则直接返回，防范 duplicate spawning 重复拉起
    {
        let sessions = state.sessions.lock().unwrap();
        if sessions.contains_key(&session_id) {
            log_to_file(&format!("spawn_terminal: Session {} is already active in sessions map. Skipping duplicate spawn.", session_id));
            return Ok(());
        }
    }

    // 物理路径预检，防止 ConPTY 引擎工作目录无效导致进程 Panic 崩溃闪退
    let path = std::path::Path::new(&directory);
    if !path.exists() || !path.is_dir() {
        let err_msg = format!("项目目录路径不存在或不是一个有效文件夹，请核对路径: {}", directory);
        log_to_file(&format!("spawn_terminal path error: {}", err_msg));
        return Err(err_msg);
    }
    log_to_file("spawn_terminal directory exists and is a valid directory.");

    log_to_file("Obtaining native PTY system...");
    let pty_system = native_pty_system();
    log_to_file("PTY system obtained. Opening PTY...");
    let pair = pty_system.openpty(PtySize {
        rows: 24,
        cols: 80,
        pixel_width: 0,
        pixel_height: 0,
    }).map_err(|e: anyhow::Error| {
        let err_msg = format!("openpty failed: {}", e);
        log_to_file(&format!("spawn_terminal error: {}", err_msg));
        err_msg
    })?;
    log_to_file("PTY opened successfully.");

    #[cfg(target_os = "windows")]
    let mut cmd = {
        let mut c = CommandBuilder::new("powershell.exe");
        c.arg("-NoLogo");
        c.arg("-NoProfile");
        c.arg("-ExecutionPolicy");
        c.arg("Bypass");
        c
    };
    #[cfg(not(target_os = "windows"))]
    let mut cmd = CommandBuilder::new("bash");

    log_to_file(&format!("Setting slave working directory to: {}", directory));
    cmd.cwd(std::path::PathBuf::from(&directory));

    log_to_file("Spawning command in PTY slave...");
    let mut _child = pair.slave.spawn_command(cmd).map_err(|e: anyhow::Error| {
        let err_msg = format!("spawn_command failed: {}", e);
        log_to_file(&format!("spawn_terminal error: {}", err_msg));
        err_msg
    })?;
    log_to_file("Slave process spawned successfully.");
    
    let master = pair.master;
    log_to_file("Taking master writer...");
    let mut writer = master.take_writer().map_err(|e: anyhow::Error| {
        let err_msg = format!("take_writer failed: {}", e);
        log_to_file(&format!("spawn_terminal error: {}", err_msg));
        err_msg
    })?;
    log_to_file("Cloning master reader...");
    let reader = master.try_clone_reader().map_err(|e: anyhow::Error| {
        let err_msg = format!("try_clone_reader failed: {}", e);
        log_to_file(&format!("spawn_terminal error: {}", err_msg));
        err_msg
    })?;
    log_to_file("Master reader cloned.");

    // 自动运行 Agent CLI 脚本
    // 自动运行 Agent CLI 脚本
    let initial_cmd = if agent_type == "claude" {
        if is_reopen {
            "claude --dangerously-skip-permissions\r\n".to_string()
        } else {
            format!("claude --dangerously-skip-permissions --session-id \"{}\"\r\n", agent_session_id)
        }
    } else if agent_type == "pi" {
        if is_reopen {
            format!("pi --session \"{}\"\r\n", agent_session_id)
        } else {
            "pi\r\n".to_string()
        }
    } else {
        "\r\n".to_string()
    };
    log_to_file(&format!("initial_cmd prepared: {:?}", initial_cmd));

    log_to_file("Sleeping 300ms before initial command write...");
    std::thread::sleep(std::time::Duration::from_millis(300));
    
    log_to_file("Writing initial command to PTY master writer...");
    writer.write_all(initial_cmd.as_bytes()).map_err(|e: std::io::Error| {
        let err_msg = format!("write_all initial_cmd failed: {}", e);
        log_to_file(&format!("spawn_terminal error: {}", err_msg));
        err_msg
    })?;
    writer.flush().map_err(|e: std::io::Error| {
        let err_msg = format!("flush initial_cmd failed: {}", e);
        log_to_file(&format!("spawn_terminal error: {}", err_msg));
        err_msg
    })?;
    log_to_file("Initial command written and flushed.");

    // 如果是重新唤起已有的克劳德会话，则延时 2.5 秒等 Claude Banner 加载后，自动键入 /resume 还原会话
    if is_reopen && agent_type == "claude" {
        log_to_file("is_reopen is true for Claude: spawning background thread for `/resume` writing...");
        let sessions_clone = state.sessions.clone();
        let session_id_clone = session_id.clone();
        let agent_session_id_clone = agent_session_id.clone();
        std::thread::spawn(move || {
            log_to_file(&format!("Background `/resume` thread spawned. spawn_token={}. Sleeping 2500ms...", spawn_token));
            // 等待 2.5 秒让 Claude 客户端完全拉起并输出提示符
            std::thread::sleep(std::time::Duration::from_millis(2500));
            log_to_file("Background `/resume` thread sleep finished. Locking sessions map...");
            let mut sessions = sessions_clone.lock().unwrap();
            if let Some(session) = sessions.get_mut(&session_id_clone) {
                // 校验 Token：若已被新 Spawn 实例覆盖，则放弃本次过期的键入操作，彻底杜绝重复键入
                if session.spawn_token != spawn_token {
                    log_to_file(&format!("Stale spawn token detected (active={}, thread={}). Safely skipping resume typing.", session.spawn_token, spawn_token));
                    return;
                }

                let resume_cmd = format!("/resume {}", agent_session_id_clone);
                log_to_file(&format!("Background thread: writing resume cmd: {:?}", resume_cmd));
                session.writer.write_all(resume_cmd.as_bytes()).ok();
                session.writer.flush().ok();
                log_to_file("Background thread: resume cmd written. Dropping lock and sleeping 500ms...");
                
                // 释放锁，防止阻塞其他线程
                drop(sessions);
                std::thread::sleep(std::time::Duration::from_millis(500));
                
                // 重新获取锁并触发一次回车
                log_to_file("Background thread: re-acquiring lock to trigger Enter...");
                let mut sessions = sessions_clone.lock().unwrap();
                if let Some(session) = sessions.get_mut(&session_id_clone) {
                    if session.spawn_token != spawn_token {
                        log_to_file("Stale spawn token during Enter key trigger. Safely skipping Enter.");
                        return;
                    }
                    session.writer.write_all(b"\r\n").ok();
                    session.writer.flush().ok();
                    log_to_file("Background thread: Enter key sent!");
                } else {
                    log_to_file("Background thread error during Enter send: session lost!");
                }
            } else {
                log_to_file("Background thread error: active session not found inside sessions map!");
            }
        });
    }

    // 如果是首次创建的 Pi 会话，则延时 2.0 秒等 Pi 客户端完全拉起后，自动键入 /session 获取并存储 session ID
    if !is_reopen && agent_type == "pi" {
        log_to_file("!is_reopen is true for Pi: spawning background thread for `/session` writing...");
        let sessions_clone = state.sessions.clone();
        let session_id_clone = session_id.clone();
        std::thread::spawn(move || {
            log_to_file(&format!("Background `/session` thread spawned. spawn_token={}. Sleeping 2000ms...", spawn_token));
            std::thread::sleep(std::time::Duration::from_millis(2000));
            log_to_file("Background `/session` thread sleep finished. Locking sessions map...");
            let mut sessions = sessions_clone.lock().unwrap();
            if let Some(session) = sessions.get_mut(&session_id_clone) {
                if session.spawn_token != spawn_token {
                    log_to_file(&format!("Stale spawn token detected (active={}, thread={}). Safely skipping session query.", session.spawn_token, spawn_token));
                    return;
                }

                log_to_file("Background thread: writing /session cmd...");
                session.writer.write_all(b"/session\r\n").ok();
                session.writer.flush().ok();
                log_to_file("Background thread: /session cmd written!");
            }
        });
    }

    let session_id_clone = session_id.clone();
    let app_handle_clone = app_handle.clone();
    let sessions_map_clone = state.sessions.clone();
    
    log_to_file("Spawning PTY reader listener thread...");
    std::thread::spawn(move || {
        log_to_file("PTY reader listener thread spawned.");
        let mut reader = reader;
        let mut buffer = [0u8; 4096];
        while let Ok(n) = reader.read(&mut buffer) {
            if n == 0 { 
                log_to_file("PTY reader thread: read EOF (0 bytes). Exiting reader loop.");
                break; 
            }
            let data = String::from_utf8_lossy(&buffer[..n]).to_string();
            app_handle_clone.emit("pty-output", PtyOutputPayload {
                session_id: session_id_clone.clone(),
                data,
            }).ok();
        }
        log_to_file("PTY reader listener thread exited.");
        // 当进程退出时，自动从 sessions map 中清理，以防下一次无法重新拉起
        let mut sessions = sessions_map_clone.lock().unwrap();
        sessions.remove(&session_id_clone);
        log_to_file(&format!("Session {} cleaned up from sessions map after PTY EOF.", session_id_clone));
    });

    log_to_file("Locking sessions map to insert active session...");
    let mut sessions = state.sessions.lock().unwrap();
    sessions.insert(session_id, ActiveSession {
        master,
        writer,
        spawn_token,
    });
    log_to_file(&format!("Session inserted into sessions map with spawn_token {}. spawn_terminal finished successfully!", spawn_token));

    Ok(())
}

// 8. 写入 PTY 终端
#[tauri::command]
fn write_to_terminal(
    session_id: String,
    data: String,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let mut sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get_mut(&session_id) {
        session.writer.write_all(data.as_bytes()).map_err(|e: std::io::Error| e.to_string())?;
        session.writer.flush().map_err(|e: std::io::Error| e.to_string())?;
        Ok(())
    } else {
        Err(format!("会话 {} 不存在", session_id))
    }
}

// 9. PTY 视口缩放
#[tauri::command]
fn resize_terminal(
    session_id: String,
    cols: u16,
    rows: u16,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    let sessions = state.sessions.lock().unwrap();
    if let Some(session) = sessions.get(&session_id) {
        session.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        }).map_err(|e: anyhow::Error| e.to_string())?;
        Ok(())
    } else {
        Err(format!("会话 {} 不存在", session_id))
    }
}

// 11. 在本地数据库中对会话进行重命名
#[tauri::command]
fn rename_session(id: String, new_name: String) -> Result<(), String> {
    log_to_file(&format!("rename_session called: id={}, new_name={}", id, new_name));
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("UPDATE sessions SET name = ?1 WHERE id = ?2", [&new_name, &id])
        .map_err(|e| e.to_string())?;
    log_to_file("rename_session completed successfully.");
    Ok(())
}

// 12. 在本地数据库中切换会话收藏状态
#[tauri::command]
fn toggle_favorite(id: String, favorite: i32) -> Result<(), String> {
    log_to_file(&format!("toggle_favorite called: id={}, favorite={}", id, favorite));
    let db_path = get_db_path();
    let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute("UPDATE sessions SET favorite = ?1 WHERE id = ?2", [&favorite.to_string(), &id])
        .map_err(|e| e.to_string())?;
    log_to_file("toggle_favorite completed successfully.");
    Ok(())
}

// 13. 检查路径是否存在且为目录，如果不存在，返回特定的状态 (如 "not_exists")
#[tauri::command]
fn check_directory(path: String) -> String {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        "not_exists".to_string()
    } else if !p.is_dir() {
        "not_dir".to_string()
    } else {
        "ok".to_string()
    }
}

// 14. 自动创建多级物理目录
#[tauri::command]
fn create_directory(path: String) -> Result<(), String> {
    log_to_file(&format!("create_directory called: path={}", path));
    std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    log_to_file("create_directory completed successfully.");
    Ok(())
}

// 10. 关闭并销毁运行时 PTY 终端进程
#[tauri::command]
fn close_terminal(
    session_id: String,
    state: State<'_, PtyManager>,
) -> Result<(), String> {
    log_to_file(&format!("close_terminal called: session_id={}", session_id));
    let mut sessions = state.sessions.lock().unwrap();
    if sessions.remove(&session_id).is_some() {
        log_to_file(&format!("Session {} successfully removed and dropped.", session_id));
        Ok(())
    } else {
        log_to_file(&format!("Session {} not found in active sessions map.", session_id));
        Ok(())
    }
}

// 15. 播放本地通知音效与系统气泡通知（极其可靠，不受浏览器沙盒和后台静音限制）
#[tauri::command]
fn play_notification_sound(
    tone: String,
    volume: f64,
    title: Option<String>,
    message: Option<String>,
) -> Result<(), String> {
    log_to_file(&format!(
        "play_notification_sound called: tone={}, volume={}, title={:?}, message={:?}",
        tone, volume, title, message
    ));

    let file_name = match tone.as_str() {
        "dingdong" => "ding.wav",
        "bell" => "chimes.wav",
        "success" => "tada.wav",
        "alarm" => "Alarm01.wav",
        "bubble" => "Windows Balloon.wav",
        "crystal" => "chord.wav",
        "dream" => "Windows Notify.wav",
        "water" => "Windows Default.wav",
        _ => "ding.wav",
    };

    let wav_path = format!("C:/Windows/Media/{}", file_name);
    let vol_scaled = volume / 100.0;

    std::thread::spawn(move || {
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            let mut ps_script = format!(
                "Add-Type -AssemblyName PresentationCore; \
                 $p = New-Object System.Windows.Media.MediaPlayer; \
                 $p.Open('{}'); \
                 $p.Volume = {}; \
                 $p.Play();",
                wav_path, vol_scaled
            );

            if let (Some(t), Some(m)) = (title, message) {
                ps_script.push_str(&format!(
                    " [void] [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms'); \
                     $notification = New-Object System.Windows.Forms.NotifyIcon; \
                     $notification.Icon = [System.Drawing.SystemIcons]::Information; \
                     $notification.BalloonTipTitle = '{}'; \
                     $notification.BalloonTipText = '{}'; \
                     $notification.Visible = $true; \
                     $notification.ShowBalloonTip(3000);",
                    t.replace('\'', "''"),
                    m.replace('\'', "''")
                ));
            }

            ps_script.push_str(" Start-Sleep -s 3;");

            let _ = std::process::Command::new("powershell")
                .args(["-Command", &ps_script])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output();
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = (wav_path, vol_scaled, title, message);
        }
    });

    Ok(())
}

#[tauri::command]
fn save_clipboard_image(bytes: Vec<u8>, filename: String) -> Result<String, String> {
    use std::fs::File;
    use std::io::Write;
    
    let temp_dir = std::env::temp_dir();
    let file_path = temp_dir.join(&filename);
    
    let mut file = File::create(&file_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write bytes: {}", e))?;
        
    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn check_if_paths_exist(text: String) -> bool {
    if text.is_empty() {
        return false;
    }
    let lines: Vec<&str> = text.lines().map(|l| l.trim()).filter(|l| !l.is_empty()).collect();
    if lines.is_empty() {
        return false;
    }
    for line in lines {
        let clean = line.trim_matches(|c| c == '"' || c == '\'');
        let p = std::path::Path::new(clean);
        if !p.exists() {
            return false;
        }
    }
    true
}

#[tauri::command]
fn read_markdown_file(path: String, filename: String) -> Result<String, String> {
    use std::fs;
    let file_path = std::path::Path::new(&path).join(&filename);
    if !file_path.exists() {
        return Ok("".to_string());
    }
    fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))
}

#[tauri::command]
fn write_markdown_file(path: String, filename: String, content: String) -> Result<(), String> {
    use std::fs;
    let file_path = std::path::Path::new(&path).join(&filename);
    fs::write(&file_path, content)
        .map_err(|e| format!("Failed to write file: {}", e))
}

#[tauri::command]
fn get_claude_version() -> Result<String, String> {
    use std::process::Command;
    
    let run_cmd = || -> Result<String, std::io::Error> {
        #[cfg(target_os = "windows")]
        let output = {
            use std::os::windows::process::CommandExt;
            Command::new("cmd")
                .args(&["/C", "claude --version"])
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()?
        };
        #[cfg(not(target_os = "windows"))]
        let output = Command::new("sh").args(&["-c", "claude --version"]).output()?;
        
        if output.status.success() {
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            Ok(stdout)
        } else {
            Err(std::io::Error::new(std::io::ErrorKind::Other, "Command status non-zero"))
        }
    };

    match run_cmd() {
        Ok(stdout) => {
            if let Some(pos) = stdout.find(' ') {
                let version_num = &stdout[..pos];
                if stdout.contains("Claude Code") {
                    return Ok(format!("Claude Code {}", version_num));
                }
            }
            if !stdout.is_empty() {
                return Ok(format!("Claude Code {}", stdout));
            }
            Ok("Claude Code".to_string())
        }
        Err(_) => {
            Ok("Claude Code".to_string())
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 启动时初始化数据库表
    initialize_database().expect("Failed to initialize SQLite database");

    tauri::Builder::default()
        .manage(PtyManager::default())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::Manager;
            
            // 1. 获取默认窗口图标
            let icon = app.default_window_icon().cloned();
            
            // 2. 创建系统托盘右键菜单项
            let show_item = tauri::menu::MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
            let quit_item = tauri::menu::MenuItem::with_id(app, "quit", "退出 KKCoder", true, None::<&str>)?;
            
            let menu = tauri::menu::MenuBuilder::new(app)
                .item(&show_item)
                .separator()
                .item(&quit_item)
                .build()?;

            // 3. 构建托盘并绑定事件
            if let Some(i) = icon {
                let _tray = tauri::tray::TrayIconBuilder::new()
                    .icon(i)
                    .tooltip("KKCoder 极简 AI 终端管理器")
                    .menu(&menu)
                    .show_menu_on_left_click(false) // 左键单击/双击用于显示窗口，右键才打开菜单
                    .on_menu_event(|app, event| {
                        match event.id.as_ref() {
                            "show" => {
                                if let Some(window) = app.get_webview_window("main") {
                                    let _ = window.show();
                                    let _ = window.unminimize();
                                    let _ = window.set_focus();
                                }
                            }
                            "quit" => {
                                app.exit(0);
                            }
                            _ => {}
                        }
                    })
                    .on_tray_icon_event(|tray, event| {
                        // 左键单击时直接显示并聚焦窗口
                        if let tauri::tray::TrayIconEvent::Click { button: tauri::tray::MouseButton::Left, .. } = event {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.unminimize();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_sessions,
            add_session,
            delete_session,
            delete_session_permanently,
            restore_session,
            empty_trash,
            get_recent_projects,
            select_directory,
            open_project_folder,
            spawn_terminal,
            write_to_terminal,
            resize_terminal,
            close_terminal,
            rename_session,
            toggle_favorite,
            check_directory,
            create_directory,
            play_notification_sound,
            save_clipboard_image,
            read_markdown_file,
            write_markdown_file,
            get_claude_version,
            check_if_paths_exist
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
