//! TokenTracker CLI 集成（移植自 CC-GUI `src-tauri/src/tokentracker.rs`）
//!
//! 使用统计仪表盘由全局安装的 `tokentracker-cli` npm 包提供本地 HTTP 服务
//! （`tokentracker serve`，绑定 127.0.0.1）。该服务不返回 CORS 头，因此
//! 前端所有数据请求都经 [`tt_proxy`] 命令隧道转发。
//!
//! 命令契约（与 CC-GUI 一致）：
//! - `tt_detect_cli`      检测 CLI 是否安装（含版本探测）
//! - `tt_install_cli`     npm -g 安装 tokentracker-cli
//! - `tt_server_status`   探测本地服务是否在运行
//! - `tt_ensure_server`   确保服务运行（未运行则拉起，等待就绪）
//! - `tt_proxy`           代理请求（路径白名单：/functions/tokentracker-*、/api/local-auth）
//!
//! 与 CC-GUI 的差异：去掉了仅 macOS 需要的 `fix_path_env`；二进制查找改用
//! `where`/`which`（与 frp.rs 同款）并补充 npm 全局 bin 目录探测。

use serde::Serialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tokio::time::timeout;

use crate::log_to_file;

/// 同一 npm 包暴露多个 bin 别名，按序探测。
const TT_BIN_CANDIDATES: [&str; 3] = ["tokentracker", "tracker", "tokentracker-cli"];
/// `tokentracker serve` 默认端口。
const TT_DEFAULT_PORT: u16 = 7680;
/// [`tt_server_status`] 扫描的端口范围。
const TT_STATUS_SCAN_PORTS: std::ops::RangeInclusive<u16> = 7680..=7684;
/// 启动新服务时考虑的端口范围（避免占用已有服务端口）。
const TT_ENSURE_PORT_RANGE: std::ops::RangeInclusive<u16> = 7680..=7690;
/// 健康检查端点。
const TT_USER_STATUS_PATH: &str = "/functions/tokentracker-user-status";
/// 单次探测超时。
const TT_STATUS_TIMEOUT: Duration = Duration::from_millis(800);
/// 代理请求超时。
const TT_PROXY_TIMEOUT: Duration = Duration::from_secs(20);
/// CLI `--version` 探测超时。
const TT_DETECTION_TIMEOUT: Duration = Duration::from_secs(10);
/// `npm install -g tokentracker-cli` 超时。
const TT_INSTALL_TIMEOUT: Duration = Duration::from_secs(180);
/// 新拉起服务的最长就绪等待。
const TT_READY_TIMEOUT: Duration = Duration::from_secs(20);
/// 就绪探测间隔。
const TT_READY_POLL_INTERVAL: Duration = Duration::from_millis(500);

/// 我们启动或最近发现的服务的端口。绝不在 `.await` 点之间持有。
static TT_SERVER_PORT: Mutex<Option<u16>> = Mutex::new(None);

fn remembered_port() -> Option<u16> {
    TT_SERVER_PORT.lock().ok().and_then(|guard| *guard)
}

fn store_port(port: u16) {
    if let Ok(mut guard) = TT_SERVER_PORT.lock() {
        *guard = Some(port);
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtCliStatus {
    installed: bool,
    version: Option<String>,
    bin_path: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtServerStatus {
    running: bool,
    port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct TtInstallResult {
    installed: bool,
    version: Option<String>,
    bin_path: Option<String>,
}

/// npm 全局 bin 候选目录（Windows 优先 %APPDATA%\npm，其次常见位置）。
fn npm_global_bin_candidates() -> Vec<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = Vec::new();
    #[cfg(windows)]
    {
        if let Some(appdata) = std::env::var_os("APPDATA") {
            dirs.push(std::path::PathBuf::from(appdata).join("npm"));
        }
    }
    if let Some(home) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")) {
        let home = std::path::PathBuf::from(home);
        dirs.push(home.join(".npm-global").join("bin"));
        dirs.push(home.join(".local").join("bin"));
    }
    dirs.push(std::path::PathBuf::from("/usr/local/bin"));
    dirs
}

/// 在当前 PATH 与常见 npm 全局 bin 目录中查找 CLI 二进制（`where`/`which` 优先）。
fn find_cli_binary(name: &str) -> Option<std::path::PathBuf> {
    // 1. where/which 按 PATH 查找（Windows 下 where 能返回 .cmd/.bat 路径）
    let resolver = if cfg!(windows) { "where" } else { "which" };
    if let Ok(output) = std::process::Command::new(resolver).arg(name).output() {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout);
            if let Some(first) = text.trim().lines().next() {
                let candidate = std::path::PathBuf::from(first.trim());
                if candidate.exists() {
                    return Some(candidate);
                }
            }
        }
    }
    // 2. 常见 npm 全局 bin 目录直接探测
    let extensions: &[&str] = if cfg!(windows) {
        &["cmd", "exe", "bat", "ps1"]
    } else {
        &[""]
    };
    for dir in npm_global_bin_candidates() {
        for ext in extensions {
            let candidate = if ext.is_empty() {
                dir.join(name)
            } else {
                dir.join(format!("{name}.{ext}"))
            };
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

/// 构造扩展 PATH（现有 PATH + npm 全局 bin 目录），供子进程继承。
fn build_cli_path_env() -> Option<String> {
    let mut parts: Vec<String> = Vec::new();
    if let Ok(existing) = std::env::var("PATH") {
        parts.extend(existing.split(';').map(|s| s.to_string()).filter(|s| !s.is_empty()));
    }
    let mut changed = false;
    for dir in npm_global_bin_candidates() {
        let dir_str = dir.to_string_lossy().to_string();
        if dir.is_dir() && !parts.iter().any(|p| p.eq_ignore_ascii_case(&dir_str)) {
            parts.push(dir_str);
            changed = true;
        }
    }
    if !changed {
        return None;
    }
    Some(parts.join(";"))
}

/// 构建 tokio Command，正确处理 Windows 上的 .cmd/.bat（镜像 CC-GUI 的做法）。
#[allow(unused_variables)]
fn build_async_command(bin: &str) -> tokio::process::Command {
    #[cfg(windows)]
    {
        let bin_lower = bin.to_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut cmd = tokio::process::Command::new("cmd");
            cmd.arg("/c");
            cmd.arg(bin);
            return cmd;
        }
    }
    tokio::process::Command::new(bin)
}

/// 构建 std Command，正确处理 Windows 上的 .cmd/.bat。
#[allow(unused_variables)]
fn build_std_command(bin: &str) -> std::process::Command {
    #[cfg(windows)]
    {
        let bin_lower = bin.to_lowercase();
        if bin_lower.ends_with(".cmd") || bin_lower.ends_with(".bat") {
            let mut cmd = std::process::Command::new("cmd");
            cmd.arg("/c");
            cmd.arg(bin);
            return cmd;
        }
    }
    std::process::Command::new(bin)
}

/// 对解析出的二进制执行 `--version`，返回首行 stdout。
async fn probe_tt_version(bin: &str) -> Option<String> {
    let path_env = build_cli_path_env();
    let result = timeout(TT_DETECTION_TIMEOUT, async {
        let mut cmd = build_async_command(bin);
        if let Some(path) = path_env {
            cmd.env("PATH", path);
        }
        cmd.arg("--version")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .output()
            .await
    })
    .await;

    match result {
        Ok(Ok(output)) if output.status.success() => {
            let stdout = String::from_utf8_lossy(&output.stdout);
            let first_line = stdout.lines().next().unwrap_or_default().trim().to_string();
            if first_line.is_empty() {
                None
            } else {
                Some(first_line)
            }
        }
        _ => None,
    }
}

/// 检测全局安装的 TokenTracker CLI。
async fn detect_cli() -> TtCliStatus {
    for name in TT_BIN_CANDIDATES {
        let Some(bin_path) = find_cli_binary(name) else {
            continue;
        };
        let bin = bin_path.to_string_lossy().to_string();
        let version = probe_tt_version(&bin).await;
        return TtCliStatus {
            installed: true,
            version,
            bin_path: Some(bin),
        };
    }

    TtCliStatus {
        installed: false,
        version: None,
        bin_path: None,
    }
}

fn output_snippet(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes)
        .chars()
        .take(800)
        .collect::<String>()
        .trim()
        .to_string()
}

fn resolve_npm_bin() -> String {
    find_cli_binary("npm")
        .map(|path| path.to_string_lossy().to_string())
        .unwrap_or_else(|| "npm".to_string())
}

async fn install_cli() -> Result<TtInstallResult, String> {
    log_to_file("tokentracker: installing tokentracker-cli via npm");
    let npm_bin = resolve_npm_bin();
    let result = timeout(TT_INSTALL_TIMEOUT, async {
        let mut cmd = build_async_command(&npm_bin);
        if let Some(path) = build_cli_path_env() {
            cmd.env("PATH", path);
        }
        cmd.arg("install")
            .arg("-g")
            .arg("tokentracker-cli")
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .output()
            .await
    })
    .await
    .map_err(|_| {
        format!(
            "tokentracker-cli install timed out after {}s",
            TT_INSTALL_TIMEOUT.as_secs()
        )
    })?
    .map_err(|error| format!("failed to run npm install for tokentracker-cli: {error}"))?;

    if !result.status.success() {
        let stderr = output_snippet(&result.stderr);
        let stdout = output_snippet(&result.stdout);
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!(
            "tokentracker-cli install failed with status {}{}",
            result.status,
            if detail.is_empty() {
                String::new()
            } else {
                format!(": {detail}")
            }
        ));
    }

    let cli = detect_cli().await;
    if !cli.installed {
        return Err("tokentracker-cli install completed but CLI was not found on PATH".to_string());
    }

    Ok(TtInstallResult {
        installed: true,
        version: cli.version,
        bin_path: cli.bin_path,
    })
}

fn build_http_client(request_timeout: Duration) -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .connect_timeout(request_timeout)
        .timeout(request_timeout)
        .build()
        .map_err(|error| format!("Failed to build HTTP client: {error}"))
}

/// 服务运行判定：user-status 端点返回 HTTP 200 且 body 为 JSON 对象。
async fn probe_server_on_port(client: &reqwest::Client, port: u16) -> bool {
    let url = format!("http://127.0.0.1:{port}{TT_USER_STATUS_PATH}");
    let Ok(response) = client.get(&url).send().await else {
        return false;
    };
    if response.status() != reqwest::StatusCode::OK {
        return false;
    }
    let Ok(body) = response.text().await else {
        return false;
    };
    serde_json::from_str::<serde_json::Value>(&body)
        .map(|value| value.is_object())
        .unwrap_or(false)
}

/// 先探测记忆端口，再扫描默认范围。
async fn detect_server_status() -> TtServerStatus {
    let fallback_port = remembered_port().unwrap_or(TT_DEFAULT_PORT);
    let client = match build_http_client(TT_STATUS_TIMEOUT) {
        Ok(client) => client,
        Err(err) => {
            log_to_file(&format!("tokentracker: {err}"));
            return TtServerStatus {
                running: false,
                port: fallback_port,
            };
        }
    };

    let mut candidates: Vec<u16> = Vec::new();
    if let Some(port) = remembered_port() {
        candidates.push(port);
    }
    for port in TT_STATUS_SCAN_PORTS {
        if !candidates.contains(&port) {
            candidates.push(port);
        }
    }

    for port in candidates {
        if probe_server_on_port(&client, port).await {
            store_port(port);
            return TtServerStatus {
                running: true,
                port,
            };
        }
    }

    TtServerStatus {
        running: false,
        port: fallback_port,
    }
}

/// 在 [`TT_ENSURE_PORT_RANGE`] 中找一个当前空闲的端口。
fn find_free_port() -> Option<u16> {
    for port in TT_ENSURE_PORT_RANGE {
        if std::net::TcpListener::bind(("127.0.0.1", port)).is_ok() {
            return Some(port);
        }
    }
    None
}

/// 分离方式拉起 `tokentracker serve`。子进程句柄有意丢弃，让服务在调用
/// 返回后继续运行（与官方 TokenTracker 桌面客户端行为一致）。
fn spawn_server(bin: &str, port: u16) -> Result<(), String> {
    let mut cmd = build_std_command(bin);
    cmd.arg("serve")
        .arg("--no-open")
        .arg("--port")
        .arg(port.to_string())
        .env("TOKENTRACKER_NO_TELEMETRY", "1")
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    if let Some(path_env) = build_cli_path_env() {
        cmd.env("PATH", path_env);
    }
    cmd.spawn()
        .map_err(|error| format!("Failed to start tokentracker server: {error}"))?;
    Ok(())
}

/// 检测 TokenTracker CLI 是否全局安装。
#[tauri::command]
pub(crate) async fn tt_detect_cli() -> Result<TtCliStatus, String> {
    Ok(detect_cli().await)
}

/// 检测本地 TokenTracker 服务是否在运行。
#[tauri::command]
pub(crate) async fn tt_server_status() -> Result<TtServerStatus, String> {
    Ok(detect_server_status().await)
}

/// 用 npm 全局安装 TokenTracker CLI。
#[tauri::command]
pub(crate) async fn tt_install_cli() -> Result<TtInstallResult, String> {
    install_cli().await
}

/// 确保本地 TokenTracker 服务运行，未运行则启动。
#[tauri::command]
pub(crate) async fn tt_ensure_server() -> Result<TtServerStatus, String> {
    let status = detect_server_status().await;
    if status.running {
        return Ok(status);
    }

    let cli = detect_cli().await;
    if !cli.installed {
        return Err("tokentracker_cli_not_installed".to_string());
    }
    let bin = cli
        .bin_path
        .clone()
        .ok_or_else(|| "tokentracker_cli_not_installed".to_string())?;

    let port = find_free_port()
        .ok_or_else(|| "No free port for tokentracker server (7680-7690)".to_string())?;

    spawn_server(&bin, port)?;

    let client = build_http_client(TT_STATUS_TIMEOUT)?;
    let deadline = Instant::now() + TT_READY_TIMEOUT;
    loop {
        if probe_server_on_port(&client, port).await {
            store_port(port);
            return Ok(TtServerStatus {
                running: true,
                port,
            });
        }
        if Instant::now() >= deadline {
            return Err(format!(
                "tokentracker server did not become ready on port {port} within {}s",
                TT_READY_TIMEOUT.as_secs()
            ));
        }
        tokio::time::sleep(TT_READY_POLL_INTERVAL).await;
    }
}

/// 代理请求到本地 TokenTracker 服务（绕过 webview CORS）。
///
/// `path` 可带查询串并原样透传，但必须匹配白名单：
/// `/functions/tokentracker-*` 或 `/api/local-auth`。
#[tauri::command]
pub(crate) async fn tt_proxy(
    method: String,
    path: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
) -> Result<serde_json::Value, String> {
    let path_only = path.split('?').next().unwrap_or(path.as_str());
    if !(path_only.starts_with("/functions/tokentracker-") || path_only == "/api/local-auth") {
        return Err(format!("tokentracker proxy path not allowed: {path}"));
    }

    let http_method = match method.trim().to_ascii_uppercase().as_str() {
        "GET" => reqwest::Method::GET,
        "POST" => reqwest::Method::POST,
        other => return Err(format!("tokentracker proxy method not allowed: {other}")),
    };

    let port = remembered_port().unwrap_or(TT_DEFAULT_PORT);
    let url = format!("http://127.0.0.1:{port}{path}");
    let client = build_http_client(TT_PROXY_TIMEOUT)?;

    let mut request = client.request(http_method, &url);
    if let Some(headers) = headers {
        for (name, value) in headers {
            let Ok(header_name) = reqwest::header::HeaderName::from_bytes(name.as_bytes()) else {
                continue;
            };
            let Ok(header_value) = reqwest::header::HeaderValue::from_str(&value) else {
                continue;
            };
            request = request.header(header_name, header_value);
        }
    }
    if let Some(body) = body {
        request = request.body(body);
    }

    let response = request
        .send()
        .await
        .map_err(|error| format!("tokentracker server unreachable: {error}"))?;
    let status = response.status();
    let text = response
        .text()
        .await
        .map_err(|error| format!("Failed to read tokentracker response body: {error}"))?;
    if !status.is_success() {
        let snippet: String = text.chars().take(500).collect();
        return Err(format!(
            "tokentracker server returned HTTP {status}: {snippet}"
        ));
    }
    serde_json::from_str::<serde_json::Value>(&text)
        .map_err(|error| format!("Failed to parse tokentracker response as JSON: {error}"))
}
