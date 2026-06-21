use std::sync::Arc;

use axum::extract::State;
use axum::http::StatusCode;
use axum::Json;

use super::auth::AuthToken;
use super::state::RemoteServerState;

/// 会话 DTO（匹配手机端 Session 模型）
#[derive(serde::Serialize)]
pub struct SessionDTO {
    pub id: String,
    pub name: String,
    pub project: String,
    #[serde(rename = "type")]
    pub session_type: String,
    #[serde(rename = "agentSessionId")]
    pub agent_session_id: String,
    #[serde(rename = "createdAt", skip_serializing_if = "Option::is_none")]
    pub created_at: Option<String>,
    #[serde(rename = "lastUserMessageAt", skip_serializing_if = "Option::is_none")]
    pub last_user_message_at: Option<String>,
}

/// 服务器状态 DTO
#[derive(serde::Serialize)]
pub struct ServerStatusDTO {
    pub running: bool,
    pub port: u16,
    pub active_sessions: usize,
    pub paired_devices: usize,
}

/// 设备 DTO
#[derive(serde::Serialize)]
pub struct DeviceDTO {
    pub device_id: String,
    pub device_name: String,
    pub paired_at: String,
    pub last_seen: String,
}

/// 配对初始化响应
#[derive(serde::Serialize)]
pub struct PairInitResponse {
    pub pin: String,
    pub expires_in: u64,
}

/// 配对验证请求（兼容 camelCase 和 snake_case）
#[derive(serde::Deserialize)]
pub struct PairVerifyRequest {
    pub pin: String,
    #[serde(alias = "deviceName")]
    pub device_name: String,
}

/// 配对验证响应
#[derive(serde::Serialize)]
pub struct PairVerifyResponse {
    pub token: String,
    pub device_id: String,
}

/// GET /api/sessions - 获取会话列表（从 SQLite 读取非删除会话）
pub async fn list_sessions(
    State(state): State<Arc<RemoteServerState>>,
    AuthToken(_): AuthToken,
) -> Result<Json<Vec<SessionDTO>>, (StatusCode, String)> {
    let db_path = state.db_path.clone();
    let sessions = tokio::task::spawn_blocking(move || -> Result<Vec<SessionDTO>, String> {
        let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, name, project, type, agent_session_id, created_at, last_user_message_at \
                 FROM sessions WHERE deleted = 0 ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(SessionDTO {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    project: row.get(2)?,
                    session_type: row.get(3)?,
                    agent_session_id: row.get(4)?,
                    created_at: row.get(5)?,
                    last_user_message_at: row.get(6)?,
                })
            })
            .map_err(|e| e.to_string())?;

        Ok(rows.filter_map(|r| r.ok()).collect())
    })
    .await
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    Ok(Json(sessions))
}

/// GET /api/status - 服务器状态
pub async fn server_status(
    State(state): State<Arc<RemoteServerState>>,
) -> Json<ServerStatusDTO> {
    let config = state.config.lock().await;
    Json(ServerStatusDTO {
        running: true,
        port: config.port,
        active_sessions: state.session_registry.len(),
        paired_devices: state.paired_devices.len(),
    })
}

/// GET /api/devices - 获取已配对设备列表
pub async fn list_devices(
    State(state): State<Arc<RemoteServerState>>,
    AuthToken(_): AuthToken,
) -> Json<Vec<DeviceDTO>> {
    let devices: Vec<DeviceDTO> = state
        .paired_devices
        .iter()
        .map(|r| DeviceDTO {
            device_id: r.device_id.clone(),
            device_name: r.device_name.clone(),
            paired_at: r.paired_at.clone(),
            last_seen: r.last_seen.clone(),
        })
        .collect();
    Json(devices)
}

/// DELETE /api/devices/:id - 吊销设备
pub async fn revoke_device(
    State(state): State<Arc<RemoteServerState>>,
    axum::extract::Path(device_id): axum::extract::Path<String>,
    AuthToken(_): AuthToken,
) -> Result<StatusCode, (StatusCode, String)> {
    // 从内存缓存中移除
    let removed = state.paired_devices.remove(&device_id);
    if removed.is_some() {
        // 同步删除数据库记录
        let db_path = state.db_path.clone();
        tokio::task::spawn_blocking(move || {
            if let Ok(conn) = rusqlite::Connection::open(&db_path) {
                let _ = conn.execute(
                    "DELETE FROM paired_devices WHERE device_id = ?1",
                    [&device_id],
                );
            }
        });
        Ok(StatusCode::OK)
    } else {
        Err((StatusCode::NOT_FOUND, "Device not found".to_string()))
    }
}

/// POST /api/pair/init - 初始化配对（生成 PIN）
pub async fn init_pairing(
    State(state): State<Arc<RemoteServerState>>,
) -> Result<Json<PairInitResponse>, (StatusCode, String)> {
    let pin = super::auth::generate_pin();
    let expiry = super::auth::pin_expiry();

    {
        let mut config = state.config.lock().await;
        config.pairing_pin = Some(pin.clone());
        config.pin_expires_at = Some(expiry);
    }

    Ok(Json(PairInitResponse {
        pin,
        expires_in: 300,
    }))
}

/// POST /api/pair/verify - 验证 PIN，返回 token
pub async fn verify_pairing(
    State(state): State<Arc<RemoteServerState>>,
    Json(req): Json<PairVerifyRequest>,
) -> Result<Json<PairVerifyResponse>, (StatusCode, String)> {
    // 从数据库读取 PIN（Tauri 命令写入的位置）
    let (pin_value, pin_expires_at) = {
        let db_path = state.db_path.clone();
        tokio::task::spawn_blocking(move || -> Result<(Option<String>, Option<std::time::SystemTime>), String> {
            let conn = rusqlite::Connection::open(db_path).map_err(|e| e.to_string())?;
            let pin: Option<String> = conn.query_row(
                "SELECT value FROM remote_config WHERE key = 'pairing_pin'",
                [],
                |row| row.get(0),
            ).ok();
            let expires_str: Option<String> = conn.query_row(
                "SELECT value FROM remote_config WHERE key = 'pin_expires_at'",
                [],
                |row| row.get(0),
            ).ok();
            let expires_at = expires_str.and_then(|s| {
                let millis: u64 = s.parse().ok()?;
                std::time::UNIX_EPOCH.checked_add(std::time::Duration::from_millis(millis))
            });
            Ok((pin, expires_at))
        })
        .await
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e.to_string()))?
        .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?
    };

    let pin_value = pin_value.ok_or((
        StatusCode::BAD_REQUEST,
        "No active pairing session".to_string(),
    ))?;

    if !super::auth::verify_pin(&req.pin, &pin_value, pin_expires_at) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid or expired PIN".to_string()));
    }

    let token = super::auth::generate_token();
    let device_id = uuid::Uuid::new_v4().to_string();
    let now = chrono::Local::now().format("%Y-%m-%d %H:%M:%S").to_string();

    // 存入内存缓存
    state.paired_devices.insert(
        token.clone(),
        super::state::DeviceInfo {
            device_id: device_id.clone(),
            device_name: req.device_name.clone(),
            paired_at: now.clone(),
            last_seen: now.clone(),
        },
    );

    // 清除 PIN（一次性使用）
    {
        let mut config = state.config.lock().await;
        config.pairing_pin = None;
        config.pin_expires_at = None;
    }

    // 持久化到数据库
    let db_path = state.db_path.clone();
    let token_clone = token.clone();
    let device_id_clone = device_id.clone();
    let device_name = req.device_name.clone();
    tokio::task::spawn_blocking(move || {
        if let Ok(conn) = rusqlite::Connection::open(&db_path) {
            let _ = conn.execute(
                "INSERT OR REPLACE INTO paired_devices (device_id, device_name, token, paired_at, last_seen) VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![device_id_clone, device_name, token_clone, now, now],
            );
        }
    });

    Ok(Json(PairVerifyResponse {
        token,
        device_id,
    }))
}
