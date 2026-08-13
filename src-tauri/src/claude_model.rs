//! Claude 模型/供应商选择：供应商与模型都在 KKCODER 里切换。
//! - 供应商列表：只读 cc-switch.db（配置由 CC Switch 管理）
//! - 切换供应商：
//!   - 可直连（apiFormat=anthropic）→ 直连覆盖：把该供应商 env 写进 settings.json（claude 直连）
//!   - 仅路由（apiFormat≠anthropic，如 OpenCode Go）→ 写回本地路由状态 + 改 cc-switch is_current，
//!     由 CC Switch 代理路由（代理用内存态，可能需要重启 CC Switch 才生效）
//! - 当前供应商名：优先 KKCODER 直连覆盖记录的 provider_id；否则路由模式读 is_current，
//!   直连模式按 apikey(base_url) 反推
//! - 模型清单：读取 settings.json env（去重、去 [1m] 后缀）；手动选模型 = 启动时加 --model

use std::collections::HashSet;
use std::sync::Mutex;

use rusqlite::{Connection, OpenFlags};
use serde::Serialize;
use tauri::State;

const PROXY_PLACEHOLDER_TOKEN: &str = "PROXY_MANAGED";
const PROXY_BASE_URL: &str = "http://127.0.0.1:15721";

/// KKCODER 全局状态：model = 手动指定模型（None = 不传 --model，用配置现状）；
/// provider_id = KKCODER 直连覆盖过的供应商（用于精确高亮，区分同 base_url 不同 key 的供应商）
#[derive(Default)]
pub struct ClaudeModelState {
    pub model: Mutex<Option<String>>,
    pub provider_id: Mutex<Option<String>>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeProviderInfo {
    pub id: String,
    pub name: String,
    /// 供应商直连地址（settings_config env 的 ANTHROPIC_BASE_URL）
    pub base_url: String,
    /// 仅支持路由：apiFormat 非 anthropic（openai_chat/openai_responses 等），Claude 无法直连
    pub route_only: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeModelInfo {
    /// 去重后的第三方模型名（已去掉 [1m]/[1M] 后缀）
    pub models: Vec<String>,
    /// 当前配置映射下实际生效的模型（未显式选择时用于展示）
    pub default_model: Option<String>,
    /// 当前生效供应商名
    pub provider_name: Option<String>,
    /// 是否本地路由模式（route_mode 判断：开关开 或 base_url 指向回环）
    pub route_mode: bool,
    /// CC Switch 路由开关是否开启（明确的开关状态）
    pub route_enabled: bool,
    /// 当前直连的供应商已不在 CC Switch 列表（被删除/改名）
    pub provider_removed: bool,
    /// 可选 claude 供应商列表（来自 cc-switch.db，只读）
    pub providers: Vec<ClaudeProviderInfo>,
}

const TIERS: [&str; 3] = ["opus", "sonnet", "haiku"];
const EXTRA_MODEL_KEYS: [&str; 3] = [
    "ANTHROPIC_MODEL",
    "ANTHROPIC_REASONING_MODEL",
    "CLAUDE_CODE_SUBAGENT_MODEL",
];

fn settings_path() -> Option<std::path::PathBuf> {
    Some(dirs::home_dir()?.join(".claude").join("settings.json"))
}

fn read_settings_json() -> Option<serde_json::Value> {
    let text = std::fs::read_to_string(settings_path()?).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_settings_json(value: &serde_json::Value) -> Result<(), String> {
    let path = settings_path().ok_or_else(|| "无法定位用户主目录".to_string())?;
    let text = serde_json::to_string_pretty(value)
        .map_err(|error| format!("settings.json 序列化失败: {error}"))?;
    std::fs::write(&path, text).map_err(|error| format!("settings.json 写入失败: {error}"))
}

/// 打开 cc-switch.db（默认只读；写入用 try_write）
fn open_cc_switch_db(writable: bool) -> Option<Connection> {
    let path = dirs::home_dir()?.join(".cc-switch").join("cc-switch.db");
    let flags = if writable {
        OpenFlags::SQLITE_OPEN_READ_WRITE
    } else {
        OpenFlags::SQLITE_OPEN_READ_ONLY
    };
    Connection::open_with_flags(&path, flags).ok()
}

/// meta JSON 里的 apiFormat 是否非 anthropic（openai_chat 等 → 仅路由）
fn meta_route_only(meta_json: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(meta_json)
        .ok()
        .and_then(|meta| meta.get("apiFormat").and_then(|v| v.as_str()).map(str::to_string))
        .is_some_and(|format| !format.trim().eq_ignore_ascii_case("anthropic"))
}

/// 读全部 claude 供应商（只读）
fn read_claude_providers(conn: &Connection) -> Vec<ClaudeProviderInfo> {
    let Ok(mut stmt) = conn.prepare(
        "SELECT id, name, settings_config, meta FROM providers WHERE app_type = 'claude'",
    ) else {
        return Vec::new();
    };
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<String>>(3)?,
            ))
        })
        .ok();
    let mut providers = Vec::new();
    for row in rows.into_iter().flatten().flatten() {
        let (id, name, config, meta) = row;
        let base_url = serde_json::from_str::<serde_json::Value>(&config)
            .ok()
            .and_then(|config| {
                config
                    .get("env")
                    .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
                    .and_then(|v| v.as_str())
                    .map(str::to_string)
            })
            .unwrap_or_default();
        let route_only = meta.as_deref().map(meta_route_only).unwrap_or(false);
        providers.push(ClaudeProviderInfo {
            id,
            name,
            base_url,
            route_only,
        });
    }
    providers
}

/// 读取所选供应商的 env（settings_config JSON 里的 env 对象）
fn read_provider_env(conn: &Connection, provider_id: &str) -> Option<serde_json::Value> {
    let raw: String = conn
        .query_row(
            "SELECT settings_config FROM providers WHERE app_type = 'claude' AND id = ?1",
            [provider_id],
            |row| row.get(0),
        )
        .ok()?;
    let config: serde_json::Value = serde_json::from_str(&raw).ok()?;
    config.get("env").cloned()
}

/// 读取某供应商是否"仅路由"（meta.apiFormat 非 anthropic）
fn read_provider_route_only(conn: &Connection, provider_id: &str) -> bool {
    let meta: Option<String> = conn
        .query_row(
            "SELECT COALESCE(meta, '') FROM providers WHERE id = ?1",
            [provider_id],
            |row| row.get(0),
        )
        .ok();
    meta.as_deref().map(meta_route_only).unwrap_or(false)
}

/// 路由开关是否开启（proxy_config.claude.enabled）——开启时 claude 全走本地代理
fn proxy_route_enabled(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT enabled FROM proxy_config WHERE app_type = 'claude'",
        [],
        |row| row.get::<_, i64>(0),
    )
    .ok()
    .is_some_and(|value| value != 0)
}

/// 按 apikey 反推供应商 (名字, 是否仅路由)：key 每家唯一，能区分同 base_url 不同 key
fn resolve_provider_by_token(conn: &Connection, token: &str) -> Option<(String, bool)> {
    let token = token.trim();
    if token.is_empty() || token.eq_ignore_ascii_case(PROXY_PLACEHOLDER_TOKEN) {
        return None;
    }
    let Ok(mut stmt) = conn.prepare(
        "SELECT name, settings_config, COALESCE(meta, '') FROM providers WHERE app_type = 'claude'",
    ) else {
        return None;
    };
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .ok()?;
    for row in rows.flatten() {
        let (name, config, meta) = row;
        let Ok(config) = serde_json::from_str::<serde_json::Value>(&config) else {
            continue;
        };
        let Some(env_token) = config
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        if env_token.trim() == token {
            return Some((name, meta_route_only(&meta)));
        }
    }
    None
}

/// 从 settings.json 的 base_url 反推供应商 (名字, 是否仅路由)
fn resolve_provider_by_base_url(conn: &Connection, base_url: &str) -> Option<(String, bool)> {
    let normalized = base_url.trim().trim_end_matches('/');
    let by_endpoint: Option<(String, bool)> = conn
        .query_row(
            "SELECT p.name, COALESCE(p.meta, '') FROM provider_endpoints e
             JOIN providers p ON p.id = e.provider_id
             WHERE e.app_type = 'claude' AND rtrim(e.url, '/') = ?1 LIMIT 1",
            [normalized],
            |row| {
                let name: String = row.get(0)?;
                let meta: String = row.get(1)?;
                Ok((name, meta_route_only(&meta)))
            },
        )
        .ok();
    if let Some(found) = by_endpoint {
        return Some(found);
    }
    let Ok(mut stmt) = conn.prepare(
        "SELECT name, settings_config, COALESCE(meta, '') FROM providers WHERE app_type = 'claude'",
    ) else {
        return None;
    };
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .ok()?;
    for row in rows.flatten() {
        let (name, config, meta) = row;
        let Ok(config) = serde_json::from_str::<serde_json::Value>(&config) else {
            continue;
        };
        let Some(url) = config
            .get("env")
            .and_then(|env| env.get("ANTHROPIC_BASE_URL"))
            .and_then(|v| v.as_str())
        else {
            continue;
        };
        if url.trim().trim_end_matches('/') == normalized {
            return Some((name, meta_route_only(&meta)));
        }
    }
    None
}

/// 记录的 provider_id 是否仍与旋钮现状匹配（env 的 base_url + token 都要对上）
fn recorded_provider_is_current(
    conn: &Connection,
    pid: &str,
    base_url: &str,
    token: &str,
) -> bool {
    if token.trim().eq_ignore_ascii_case(PROXY_PLACEHOLDER_TOKEN) || token.trim().is_empty() {
        return false;
    }
    let Ok(config) = conn.query_row(
        "SELECT settings_config FROM providers WHERE id = ?1",
        [pid],
        |row| row.get::<_, String>(0),
    ) else {
        return false;
    };
    let Ok(config) = serde_json::from_str::<serde_json::Value>(&config) else {
        return false;
    };
    let Some(env) = config.get("env") else {
        return false;
    };
    let p_url = env
        .get("ANTHROPIC_BASE_URL")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .trim_end_matches('/');
    let p_token = env
        .get("ANTHROPIC_AUTH_TOKEN")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    p_url == base_url.trim().trim_end_matches('/') && p_token == token.trim()
}

/// 去掉 [1m]/[1M] 上下文窗口后缀（仅用于展示；--model 传干净名）
fn strip_context_suffix(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.len() > 4 {
        let (head, tail) = trimmed.split_at(trimmed.len() - 4);
        if tail.eq_ignore_ascii_case("[1m]") {
            return head.trim().to_string();
        }
    }
    trimmed.to_string()
}

fn is_claude_alias(value: &str) -> bool {
    value.trim().to_ascii_lowercase().starts_with("claude-")
}

/// 某 tier 对应的上游真实模型名：优先 *_MODEL_NAME，再取非别名的 *_MODEL
fn tier_model_name(env: Option<&serde_json::Value>, tier: &str) -> Option<String> {
    let env = env?;
    let upper = tier.to_ascii_uppercase();
    if let Some(name) = env
        .get(format!("ANTHROPIC_DEFAULT_{upper}_MODEL_NAME"))
        .and_then(|value| value.as_str())
    {
        let stripped = strip_context_suffix(name);
        if !stripped.is_empty() {
            return Some(stripped);
        }
    }
    if let Some(model) = env
        .get(format!("ANTHROPIC_DEFAULT_{upper}_MODEL"))
        .and_then(|value| value.as_str())
    {
        if !is_claude_alias(model) {
            let stripped = strip_context_suffix(model);
            if !stripped.is_empty() {
                return Some(stripped);
            }
        }
    }
    None
}

#[tauri::command]
pub fn claude_model_info(state: State<'_, ClaudeModelState>) -> ClaudeModelInfo {
    let conn = open_cc_switch_db(false);
    let providers = conn
        .as_ref()
        .map(read_claude_providers)
        .unwrap_or_default();

    let Some(json) = read_settings_json() else {
        let route_enabled = conn.as_ref().map(proxy_route_enabled).unwrap_or(false);
        return ClaudeModelInfo {
            models: Vec::new(),
            default_model: None,
            provider_name: None,
            route_mode: route_enabled,
            route_enabled,
            provider_removed: false,
            providers,
        };
    };

    let env = json.get("env");
    let base_url = env
        .and_then(|value| value.get("ANTHROPIC_BASE_URL"))
        .and_then(|value| value.as_str())
        .unwrap_or("");
    // 路由开关开启 → 一律路由模式（claude 走本地代理）；否则按 base_url 兜底判断
    let route_enabled = conn.as_ref().map(proxy_route_enabled).unwrap_or(false);
    let mut route_mode =
        route_enabled || base_url.contains("127.0.0.1") || base_url.contains("localhost");
    let auth_token = env
        .and_then(|env| env.get("ANTHROPIC_AUTH_TOKEN"))
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let mut models: Vec<String> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut push_model = |name: String| {
        let key = name.to_ascii_lowercase();
        if seen.insert(key) {
            models.push(name);
        }
    };
    for tier in TIERS {
        if let Some(name) = tier_model_name(env, tier) {
            push_model(name);
        }
    }
    if let Some(env) = env {
        for key in EXTRA_MODEL_KEYS {
            if let Some(value) = env.get(key).and_then(|value| value.as_str()) {
                if !is_claude_alias(value) {
                    let name = strip_context_suffix(value);
                    if !name.is_empty() {
                        push_model(name);
                    }
                }
            }
        }
    }

    let tier = json.get("model").and_then(|value| value.as_str()).unwrap_or("");
    let default_model = tier_model_name(env, tier);

    // 当前生效供应商名。优先级：
    // 1) KKCODER 直连覆盖记录的 provider_id（且 env 匹配）→ 精确区分同地址不同 key
    // 2) 路由模式 → cc-switch is_current
    // 3) 直连模式 → 按 apikey 反推，再 base_url 兜底
    let recorded_provider_id = state
        .provider_id
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .clone();
    let use_recorded = recorded_provider_id.as_ref().is_some_and(|pid| {
        conn.as_ref()
            .is_some_and(|conn| recorded_provider_is_current(conn, pid, base_url, auth_token))
    });

    let (provider_name, provider_removed) = if route_enabled {
        // 路由开关开启：供应商由 cc-switch 当前 is_current 决定
        let name = conn.as_ref().and_then(|conn| {
            conn.query_row(
                "SELECT name FROM providers WHERE app_type = 'claude' AND is_current = 1 LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .ok()
        });
        (name, false)
    } else if use_recorded {
        let pid = recorded_provider_id.unwrap();
        let name = conn
            .as_ref()
            .and_then(|conn| {
                conn.query_row(
                    "SELECT name FROM providers WHERE id = ?1",
                    [&pid],
                    |row| row.get::<_, String>(0),
                )
                .ok()
            });
        (name.clone(), name.is_none()) // 记录过但已被删 → removed
    } else if !base_url.is_empty() {
        let resolved = conn
            .as_ref()
            .and_then(|conn| resolve_provider_by_token(conn, auth_token))
            .or_else(|| {
                conn.as_ref()
                    .and_then(|conn| resolve_provider_by_base_url(conn, base_url))
            });
        match resolved {
            Some((name, route_only)) => {
                if route_only {
                    route_mode = true;
                }
                (Some(name), false)
            }
            None => (None, true),
        }
    } else {
        (None, false)
    };

    ClaudeModelInfo {
        models,
        default_model,
        provider_name,
        route_mode,
        route_enabled,
        provider_removed,
        providers,
    }
}

/// 设置全局模型覆盖（None = 不传 --model，用配置现状）
#[tauri::command]
pub fn set_claude_model(state: State<'_, ClaudeModelState>, model: Option<String>) {
    let trimmed = model
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    crate::log_to_file(&format!("[claude_model] set model override: {:?}", trimmed));
    let mut guard = state.model.lock().unwrap_or_else(|error| error.into_inner());
    *guard = trimmed;
}

/// 切换供应商（通过 KKCODER）。
/// - 路由开关开启 → 保持走代理：写路由状态 env（127.0.0.1 + 占位 token + 该供应商模型映射），
///   并同步 cc-switch 的 is_current 指向它（代理内存态可能需要重启 cc-switch 才刷新）
/// - 路由开关关闭 → 直连覆盖：该供应商真实 env 写进 settings.json（claude 直连）；
///   仅路由供应商（apiFormat 非 anthropic，如 OpenCode Go）此时无法直连，提示需开启路由
/// 返回切换后的最新模型信息，供前端刷新。
#[tauri::command]
pub fn set_claude_provider(
    state: State<'_, ClaudeModelState>,
    provider_id: String,
) -> Result<ClaudeModelInfo, String> {
    let conn = open_cc_switch_db(false).ok_or_else(|| "无法读取 CC Switch 数据库".to_string())?;
    let provider_env = read_provider_env(&conn, &provider_id)
        .ok_or_else(|| "供应商不存在或缺少配置".to_string())?;
    let route_only = read_provider_route_only(&conn, &provider_id);
    let route_enabled = proxy_route_enabled(&conn);

    // 基于当前旋钮（settings.json）只替换 env；没有 settings.json 时以空对象起步
    let mut settings = read_settings_json().unwrap_or_else(|| serde_json::json!({}));

    if route_enabled {
        // 路由开关开启：一律走本地代理。写路由状态 env（代理地址 + 占位 token），
        // 保留该供应商的模型映射；并同步 cc-switch 的 is_current 指向它。
        crate::log_to_file(&format!(
            "[claude_model] set provider (route): {}",
            provider_id
        ));
        let mut env = provider_env;
        if let Some(value) = env.get_mut("ANTHROPIC_BASE_URL") {
            *value = serde_json::json!(PROXY_BASE_URL);
        }
        if let Some(value) = env.get_mut("ANTHROPIC_AUTH_TOKEN") {
            *value = serde_json::json!(PROXY_PLACEHOLDER_TOKEN);
        }
        settings["env"] = env;
        write_settings_json(&settings)?;
        // 尽力同步 cc-switch 的当前供应商（代理内存态可能不刷新，需重启才生效）
        if let Some(write_conn) = open_cc_switch_db(true) {
            let _ = write_conn.execute(
                "UPDATE providers SET is_current = 0 WHERE app_type = 'claude'",
                [],
            );
            let _ = write_conn.execute(
                "UPDATE providers SET is_current = 1 WHERE app_type = 'claude' AND id = ?1",
                [&provider_id],
            );
            crate::log_to_file("[claude_model] cc-switch is_current 已同步（代理需重启才刷新）");
        }
        // 路由模式下当前供应商由 cc-switch 决定，不记录为 KKCODER 直连覆盖
        {
            let mut guard = state
                .provider_id
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            *guard = None;
        }
        return Ok(claude_model_info(state));
    }

    // 路由关闭：直连覆盖。仅路由供应商此时无法直连。
    if route_only {
        crate::log_to_file(&format!(
            "[claude_model] set provider REJECTED(route-only, 路由已关): {}",
            provider_id
        ));
        return Err("该供应商需开启路由才能使用。请先在 CC Switch 打开路由开关。".to_string());
    }

    crate::log_to_file(&format!("[claude_model] set provider (direct override): {}", provider_id));
    settings["env"] = provider_env;
    write_settings_json(&settings)?;
    crate::log_to_file("[claude_model] settings.json env 已覆盖为所选供应商");
    {
        let mut guard = state
            .provider_id
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        *guard = Some(provider_id);
    }

    Ok(claude_model_info(state))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_1m_context_suffix() {
        assert_eq!(strip_context_suffix("deepseek-v4-pro[1m]"), "deepseek-v4-pro");
        assert_eq!(strip_context_suffix("deepseek-v4-pro[1M]"), "deepseek-v4-pro");
        assert_eq!(strip_context_suffix("deepseek-v4-flash"), "deepseek-v4-flash");
    }

    #[test]
    fn recognizes_claude_alias_but_not_third_party() {
        assert!(is_claude_alias("claude-opus-4-8[1M]"));
        assert!(!is_claude_alias("deepseek-v4-pro"));
    }

    #[test]
    fn tier_model_prefers_name_var_then_non_alias_model() {
        let route_env = serde_json::json!({
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "claude-opus-4-8[1M]",
            "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "deepseek-v4-pro"
        });
        assert_eq!(
            tier_model_name(Some(&route_env), "opus").as_deref(),
            Some("deepseek-v4-pro")
        );
        let direct_env = serde_json::json!({
            "ANTHROPIC_DEFAULT_OPUS_MODEL": "deepseek-v4-pro"
        });
        assert_eq!(
            tier_model_name(Some(&direct_env), "opus").as_deref(),
            Some("deepseek-v4-pro")
        );
        let alias_only = serde_json::json!({
            "ANTHROPIC_DEFAULT_SONNET_MODEL": "claude-sonnet-4-6"
        });
        assert_eq!(tier_model_name(Some(&alias_only), "sonnet"), None);
    }

    #[test]
    fn model_info_collects_deduped_models() {
        let env = serde_json::json!({
            "ANTHROPIC_DEFAULT_OPUS_MODEL_NAME": "deepseek-v4-pro",
            "ANTHROPIC_DEFAULT_SONNET_MODEL_NAME": "deepseek-v4-pro",
            "ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME": "deepseek-v4-flash",
            "CLAUDE_CODE_SUBAGENT_MODEL": "deepseek-v4-flash"
        });
        let mut models: Vec<String> = Vec::new();
        let mut seen: HashSet<String> = HashSet::new();
        let mut push = |name: String| {
            if seen.insert(name.to_ascii_lowercase()) {
                models.push(name);
            }
        };
        for tier in TIERS {
            if let Some(name) = tier_model_name(Some(&env), tier) {
                push(name);
            }
        }
        for key in EXTRA_MODEL_KEYS {
            if let Some(value) = env.get(key).and_then(|v| v.as_str()) {
                if !is_claude_alias(value) {
                    push(strip_context_suffix(value));
                }
            }
        }
        models.sort();
        assert_eq!(models, vec!["deepseek-v4-flash", "deepseek-v4-pro"]);
    }
}
