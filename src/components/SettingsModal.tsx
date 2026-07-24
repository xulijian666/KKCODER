import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { DirectoryPickerModal } from "./DirectoryPickerModal";
import {
  DEFAULT_SESSION_CLEANUP_DAYS,
  MIN_SESSION_CLEANUP_DAYS,
  normalizeSessionCleanupDays,
  SESSION_CLEANUP_DAYS_KEY,
  SESSION_CLEANUP_ENABLED_KEY,
} from "../utils/sessionCleanup";
import {
  CLAUDE_TERMINAL_MODE_KEY,
  resolveClaudeTerminalMode,
  type ClaudeTerminalMode,
} from "../utils/terminalMode";
import { RemoteSettingsPanel } from "./RemoteSettingsPanel";
import {
  TERMINAL_SCHEME_MODE_KEY,
  TERMINAL_SCHEME_JSON_KEY,
  resolveTerminalSchemeMode,
  parseWindowsTerminalScheme,
  dispatchTerminalSchemeChange,
  type TerminalSchemeMode,
} from "../utils/terminalScheme";
import { applyTheme, DEFAULT_THEME, THEME_STORAGE_KEY } from "../utils/theme";
import {
  loadEnabledAgents,
  saveEnabledAgents,
  type EnabledAgents,
} from "../utils/enabledAgents";

// 会话名称修正 localStorage keys
const AUTO_RENAME_ON_STARTUP_KEY = "kkcoder_setting_auto_rename_startup";
const AUTO_RENAME_ON_IDLE_KEY = "kkcoder_setting_auto_rename_idle";
const AUTO_RENAME_SKIP_FAVORITES_KEY = "kkcoder_setting_auto_rename_skip_favorites";
const NAMER_MODE_KEY = "kkcoder_setting_namer_mode";
const LLM_API_URL_KEY = "kkcoder_setting_llm_api_url";
const LLM_API_KEY_KEY = "kkcoder_setting_llm_api_key";
const LLM_MODEL_KEY = "kkcoder_setting_llm_model";
const IDLE_MINUTES_KEY = "kkcoder_setting_idle_minutes";

interface RenameResult {
  session_id: string;
  old_name: string;
  new_name: string;
  changed: boolean;
}


type SettingsMenuId =
  | "appearance"
  | "agents"
  | "terminal"
  | "notifications"
  | "shortcuts"
  | "sessions"
  | "remote"
  | "about";

const SETTINGS_MENU: { id: SettingsMenuId; label: string; group: string }[] = [
  { id: "appearance", label: "外观", group: "体验" },
  { id: "agents", label: "AI 助手", group: "体验" },
  { id: "terminal", label: "终端", group: "工作区" },
  { id: "notifications", label: "通知", group: "工作区" },
  { id: "shortcuts", label: "快捷短语", group: "工作区" },
  { id: "sessions", label: "会话", group: "管理" },
  { id: "remote", label: "远程", group: "管理" },
  { id: "about", label: "关于", group: "其他" },
];

interface SettingsModalProps {
  show: boolean;
  onClose: () => void;
  onSessionsRenamed?: () => void; // 修正完成后刷新会话列表
}


export const SettingsModal: React.FC<SettingsModalProps> = ({ show, onClose, onSessionsRenamed }) => {
  const [activeMenu, setActiveMenu] = useState<SettingsMenuId>("appearance");
  const [showFilePicker, setShowFilePicker] = useState(false);

  useEffect(() => {
    if (show) {
      setShowFilePicker(false);
    }
  }, [show]);

  // 播放提示音效预览（不显示通知气泡）
  const triggerPreview = (tone: string, volume: number) => {
    invoke("play_notification_sound", {
      tone,
      volume,
      title: null,
      message: null,
    }).catch((err) => console.error("播放音效预览失败:", err));
  };

  // --- 1. 读取并配置各项通用设置 (持久化存储) ---
  const [theme, setTheme] = useState<string>(() => {
    return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
  });
  const [enabledAgents, setEnabledAgents] = useState<EnabledAgents>(() => loadEnabledAgents());
  // Language state removed to satisfy TS6133 strict check
  const [closeBehavior, setCloseBehavior] = useState<string>(() => {
    return localStorage.getItem("kkcoder_setting_close_behavior") || "exit";
  });
  const [notifyOnComplete, setNotifyOnComplete] = useState<boolean>(() => {
    const val = localStorage.getItem("kkcoder_setting_notify_on_complete");
    return val === null ? true : val === "true";
  });
  const [notifyThreshold, setNotifyThreshold] = useState<number>(() => {
    const val = localStorage.getItem("kkcoder_setting_notify_threshold");
    return val === null ? 2.0 : parseFloat(val);
  });
  const [playSound, setPlaySound] = useState<boolean>(() => {
    const val = localStorage.getItem("kkcoder_setting_play_sound");
    return val === null ? true : val === "true";
  });
  const [soundTone, setSoundTone] = useState<string>(() => {
    return localStorage.getItem("kkcoder_setting_sound_tone") || "dingdong";
  });
  const [soundVolume, setSoundVolume] = useState<number>(() => {
    const val = localStorage.getItem("kkcoder_setting_sound_volume");
    return val === null ? 80 : parseInt(val, 10);
  });
  const [fontFamily, setFontFamily] = useState<string>(() => {
    return localStorage.getItem("kkcoder_setting_font_family") || "Cascadia Mono";
  });
  const [fontSize, setFontSize] = useState<number>(() => {
    const val = localStorage.getItem("kkcoder_setting_font_size");
    return val === null ? 13.5 : parseFloat(val);
  });
  const [previewFontFamily, setPreviewFontFamily] = useState<string>(() => {
    return localStorage.getItem("kkcoder_setting_preview_font_family") || "monospace";
  });
  const [previewFontSize, setPreviewFontSize] = useState<number>(() => {
    const val = localStorage.getItem("kkcoder_setting_preview_font_size");
    return val === null ? 12.5 : parseFloat(val);
  });
  const [scrollback, setScrollback] = useState<number>(() => {
    const val = localStorage.getItem("kkcoder_setting_scrollback");
    return val === null ? 10000 : parseInt(val, 10);
  });
  const [claudeTerminalMode, setClaudeTerminalMode] = useState<ClaudeTerminalMode>(() => {
    return resolveClaudeTerminalMode(localStorage.getItem(CLAUDE_TERMINAL_MODE_KEY));
  });
  const [terminalSchemeMode, setTerminalSchemeMode] = useState<TerminalSchemeMode>(() => {
    return resolveTerminalSchemeMode(localStorage.getItem(TERMINAL_SCHEME_MODE_KEY));
  });
  const [terminalSchemeJson, setTerminalSchemeJson] = useState<string>(() => {
    return localStorage.getItem(TERMINAL_SCHEME_JSON_KEY) || "";
  });
  const [terminalSchemeError, setTerminalSchemeError] = useState<string>("");
  const [terminalSchemeName, setTerminalSchemeName] = useState<string>(() => {
    const raw = localStorage.getItem(TERMINAL_SCHEME_JSON_KEY);
    if (!raw) return "";
    const parsed = parseWindowsTerminalScheme(raw);
    return parsed.ok ? (parsed.scheme.name || "自定义") : "";
  });
  const [sessionCleanupEnabled, setSessionCleanupEnabled] = useState<boolean>(() => {
    return localStorage.getItem(SESSION_CLEANUP_ENABLED_KEY) === "true";
  });
  const [sessionCleanupDays, setSessionCleanupDays] = useState<number>(() => {
    return normalizeSessionCleanupDays(localStorage.getItem(SESSION_CLEANUP_DAYS_KEY));
  });

  const [shortcutsEnabled, setShortcutsEnabled] = useState<boolean>(() => {
    const val = localStorage.getItem("kkcoder_shortcuts_enabled");
    return val === null ? false : val === "true";
  });

  const [shortcutsList, setShortcutsList] = useState<{ title: string; content: string }[]>(() => {
    const val = localStorage.getItem("kkcoder_shortcuts_list");
    if (val) {
      try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) {
          // 确保长度为 3，若不足补齐，若超出截断
          const list = [...parsed];
          while (list.length < 3) list.push({ title: "", content: "" });
          return list.slice(0, 3);
        }
      } catch (e) {
        // ignore
      }
    }
    return [
      { title: "继续", content: "继续完成" },
      { title: "", content: "" },
      { title: "", content: "" },
    ];
  });

  const [ccswitchPath, setCcswitchPath] = useState<string>(() => {
    return localStorage.getItem("kkcoder_setting_ccswitch_path") || "";
  });

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_ccswitch_path", ccswitchPath);
    window.dispatchEvent(new CustomEvent("kkcoder-ccswitch-path-change", { detail: ccswitchPath }));
  }, [ccswitchPath]);



  // --- 会话名称修正设置 ---
  const [autoRenameOnStartup, setAutoRenameOnStartup] = useState<boolean>(() => {
    return localStorage.getItem(AUTO_RENAME_ON_STARTUP_KEY) === "true";
  });
  const [autoRenameOnIdle, setAutoRenameOnIdle] = useState<boolean>(() => {
    return localStorage.getItem(AUTO_RENAME_ON_IDLE_KEY) === "true";
  });
  const [autoRenameSkipFavorites, setAutoRenameSkipFavorites] = useState<boolean>(() => {
    const val = localStorage.getItem(AUTO_RENAME_SKIP_FAVORITES_KEY);
    return val === null ? true : val === "true";
  });
  const [isRenaming, setIsRenaming] = useState(false);
  const [lastRenameResult, setLastRenameResult] = useState<string | null>(null);

  // LLM 模式配置
  const [namerMode, setNamerMode] = useState<"heuristic" | "llm">(() => {
    return (localStorage.getItem(NAMER_MODE_KEY) as "heuristic" | "llm") || "heuristic";
  });
  const [llmApiUrl, setLlmApiUrl] = useState<string>(() => {
    return localStorage.getItem(LLM_API_URL_KEY) || "https://api.deepseek.com";
  });
  const [llmApiKey, setLlmApiKey] = useState<string>(() => {
    return localStorage.getItem(LLM_API_KEY_KEY) || "";
  });
  const [llmModel, setLlmModel] = useState<string>(() => {
    return localStorage.getItem(LLM_MODEL_KEY) || "deepseek-v4-flash";
  });
  const [idleMinutes, setIdleMinutes] = useState<number>(() => {
    const val = localStorage.getItem(IDLE_MINUTES_KEY);
    return val === null ? 5 : parseInt(val, 10);
  });


  // --- 2. 写入各项设置至 localStorage ---
  useEffect(() => {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
    applyTheme(theme);
    window.dispatchEvent(new CustomEvent("kkcoder-theme-change", { detail: theme }));
  }, [theme]);

  useEffect(() => {
    saveEnabledAgents(enabledAgents);
  }, [enabledAgents]);

  // 监听外部（如调色盘）的主题变动事件以同步本地 theme 状态
  useEffect(() => {
    const handleExternalThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      const newTheme = customEvent.detail;
      if (newTheme !== theme) {
        setTheme(newTheme);
      }
    };
    window.addEventListener("kkcoder-theme-change", handleExternalThemeChange);
    return () => window.removeEventListener("kkcoder-theme-change", handleExternalThemeChange);
  }, [theme]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_close_behavior", closeBehavior);
  }, [closeBehavior]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_notify_on_complete", String(notifyOnComplete));
  }, [notifyOnComplete]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_notify_threshold", String(notifyThreshold));
  }, [notifyThreshold]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_play_sound", String(playSound));
  }, [playSound]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_sound_tone", soundTone);
  }, [soundTone]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_sound_volume", String(soundVolume));
  }, [soundVolume]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_font_family", fontFamily);
    window.dispatchEvent(new CustomEvent("kkcoder-font-change", { detail: fontFamily }));
  }, [fontFamily]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_font_size", String(fontSize));
    window.dispatchEvent(new CustomEvent("kkcoder-font-size-change", { detail: fontSize }));
  }, [fontSize]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_preview_font_family", previewFontFamily);
    window.dispatchEvent(new CustomEvent("kkcoder-preview-font-change", { detail: previewFontFamily }));
  }, [previewFontFamily]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_preview_font_size", String(previewFontSize));
    window.dispatchEvent(new CustomEvent("kkcoder-preview-font-size-change", { detail: previewFontSize }));
  }, [previewFontSize]);

  useEffect(() => {
    localStorage.setItem(SESSION_CLEANUP_ENABLED_KEY, String(sessionCleanupEnabled));
  }, [sessionCleanupEnabled]);

  useEffect(() => {
    localStorage.setItem("kkcoder_setting_scrollback", String(scrollback));
  }, [scrollback]);

  useEffect(() => {
    localStorage.setItem(CLAUDE_TERMINAL_MODE_KEY, claudeTerminalMode);
    window.dispatchEvent(new CustomEvent("kkcoder-claude-terminal-mode-change", {
      detail: claudeTerminalMode,
    }));
  }, [claudeTerminalMode]);

  useEffect(() => {
    localStorage.setItem(TERMINAL_SCHEME_MODE_KEY, terminalSchemeMode);
    dispatchTerminalSchemeChange();
  }, [terminalSchemeMode]);

  const applyCustomScheme = () => {
    const result = parseWindowsTerminalScheme(terminalSchemeJson);
    if (!result.ok) {
      setTerminalSchemeError(result.error);
      return;
    }
    setTerminalSchemeError("");
    setTerminalSchemeName(result.scheme.name || "自定义");
    // 规范化后存一份，确保下次加载稳定
    const normalized = JSON.stringify(
      {
        name: result.scheme.name || "Custom",
        background: result.theme.background,
        foreground: result.theme.foreground,
        cursorColor: result.theme.cursor,
        selectionBackground: result.theme.selectionBackground,
        black: result.theme.black,
        red: result.theme.red,
        green: result.theme.green,
        yellow: result.theme.yellow,
        blue: result.theme.blue,
        purple: result.theme.magenta,
        cyan: result.theme.cyan,
        white: result.theme.white,
        brightBlack: result.theme.brightBlack,
        brightRed: result.theme.brightRed,
        brightGreen: result.theme.brightGreen,
        brightYellow: result.theme.brightYellow,
        brightBlue: result.theme.brightBlue,
        brightPurple: result.theme.brightMagenta,
        brightCyan: result.theme.brightCyan,
        brightWhite: result.theme.brightWhite,
      },
      null,
      2,
    );
    setTerminalSchemeJson(normalized);
    localStorage.setItem(TERMINAL_SCHEME_JSON_KEY, normalized);
    setTerminalSchemeMode("custom");
    dispatchTerminalSchemeChange();
  };

  useEffect(() => {
    localStorage.setItem(SESSION_CLEANUP_DAYS_KEY, String(normalizeSessionCleanupDays(sessionCleanupDays)));
  }, [sessionCleanupDays]);

  useEffect(() => {
    localStorage.setItem("kkcoder_shortcuts_enabled", String(shortcutsEnabled));
    window.dispatchEvent(new Event("kkcoder-shortcuts-change"));
  }, [shortcutsEnabled]);

  useEffect(() => {
    localStorage.setItem("kkcoder_shortcuts_list", JSON.stringify(shortcutsList));
    window.dispatchEvent(new Event("kkcoder-shortcuts-change"));
  }, [shortcutsList]);

  useEffect(() => {
    localStorage.setItem(AUTO_RENAME_ON_STARTUP_KEY, String(autoRenameOnStartup));
  }, [autoRenameOnStartup]);

  useEffect(() => {
    localStorage.setItem(AUTO_RENAME_ON_IDLE_KEY, String(autoRenameOnIdle));
  }, [autoRenameOnIdle]);

  useEffect(() => {
    localStorage.setItem(AUTO_RENAME_SKIP_FAVORITES_KEY, String(autoRenameSkipFavorites));
  }, [autoRenameSkipFavorites]);

  useEffect(() => {
    localStorage.setItem(NAMER_MODE_KEY, namerMode);
  }, [namerMode]);

  useEffect(() => {
    localStorage.setItem(LLM_API_URL_KEY, llmApiUrl);
  }, [llmApiUrl]);

  useEffect(() => {
    localStorage.setItem(LLM_API_KEY_KEY, llmApiKey);
  }, [llmApiKey]);

  useEffect(() => {
    localStorage.setItem(LLM_MODEL_KEY, llmModel);
  }, [llmModel]);

  useEffect(() => {
    localStorage.setItem(IDLE_MINUTES_KEY, String(idleMinutes));
  }, [idleMinutes]);


  // 监听键盘 ESC 键关闭设置弹窗与子弹窗
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (showFilePicker) {
          setShowFilePicker(false);
        } else {
          onClose();
        }
      }
    };
    if (show) {
      window.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [show, onClose, showFilePicker]);

  if (!show) return null;

  const menuTitle =
    SETTINGS_MENU.find((item) => item.id === activeMenu)?.label ?? "设置";

  // 手动触发修正
  const handleManualRename = async () => {
    if (isRenaming) return;
    setIsRenaming(true);
    setLastRenameResult(null);
    try {
      let results: RenameResult[];
      if (namerMode === "llm") {
        if (!llmApiKey.trim()) {
          setLastRenameResult("请先填写 API Key");
          setIsRenaming(false);
          return;
        }
        let lastTimes: Record<string, number> = {};
        try { lastTimes = JSON.parse(localStorage.getItem("kkcoder_last_rename_times") || "{}"); } catch {}
        results = await invoke<RenameResult[]>("llm_rename_sessions", {
          apiUrl: llmApiUrl,
          apiKey: llmApiKey,
          model: llmModel,
          skipFavorites: autoRenameSkipFavorites,
          projectFilter: null,
          lastRenameTimes: JSON.stringify(lastTimes),
        });
        // 更新修正时间表
        const now = Date.now() / 1000;
        for (const r of results.filter((r) => r.changed)) {
          lastTimes[r.session_id] = now;
        }
        try { localStorage.setItem("kkcoder_last_rename_times", JSON.stringify(lastTimes)); } catch {}
      } else {
        results = await invoke<RenameResult[]>("auto_rename_sessions", {
          skipFavorites: autoRenameSkipFavorites,
          projectFilter: null,
        });
      }
      const changed = results.filter((r) => r.changed).length;
      const total = results.length;
      if (changed === 0) {
        setLastRenameResult(`扫描了 ${total} 个会话，所有名称已是最新`);
      } else {
        setLastRenameResult(`已修正 ${changed} / ${total} 个会话名称`);
      }
      if (changed > 0 && onSessionsRenamed) {
        onSessionsRenamed();
      }
    } catch (err) {
      setLastRenameResult(`修正失败: ${err}`);
    } finally {
      setIsRenaming(false);
    }
  };
return (
    <div className="modal-overlay show" onClick={onClose}>
      <div className="settings-card" onClick={(e) => e.stopPropagation()}>
        <div className="settings-sidebar">
          <div className="settings-sidebar-header">设置</div>
          <nav className="settings-sidebar-nav" aria-label="设置分类">
            {(["体验", "工作区", "管理", "其他"] as const).map((groupName) => {
              const items = SETTINGS_MENU.filter((item) => item.group === groupName);
              if (items.length === 0) return null;
              return (
                <div key={groupName} className="settings-nav-group">
                  <div className="settings-nav-group-label">{groupName}</div>
                  {items.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`settings-menu-item ${activeMenu === item.id ? "active" : ""}`}
                      onClick={() => setActiveMenu(item.id)}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              );
            })}
          </nav>
        </div>

        <div className="settings-main">
          <div className="settings-header">
            <span className="settings-title">{menuTitle}</span>
            <button type="button" className="settings-close" onClick={onClose} aria-label="关闭设置">
              ×
            </button>
          </div>

          <div className="settings-body">
            {activeMenu === "appearance" && (
              <div className="settings-content">
                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">主题</h3>
                    <p className="settings-section-desc">界面配色，切换后即时生效</p>
                  </div>
                  <div className="settings-group">
                    <div className="theme-grid">
                      <div className={`theme-box dark-blue-box ${theme === "dark-blue" ? "checked" : ""}`} onClick={() => setTheme("dark-blue")} title="深蓝主题">
                        <div className="theme-dot" style={{ backgroundColor: "#3b82f6" }} />
                      </div>
                      <div className={`theme-box dark-purple-box ${theme === "dark-purple" ? "checked" : ""}`} onClick={() => setTheme("dark-purple")} title="暗紫主题">
                        <div className="theme-dot" style={{ backgroundColor: "#8b5cf6" }} />
                      </div>
                      <div className={`theme-box dark-zinc-box ${theme === "dark-zinc" ? "checked" : ""}`} onClick={() => setTheme("dark-zinc")} title="碳黑主题">
                        <div className="theme-dot" style={{ backgroundColor: "#f59e0b" }} />
                      </div>
                      <div className={`theme-box light-blue-box ${theme === "light-blue" ? "checked" : ""}`} onClick={() => setTheme("light-blue")} title="冰蓝主题">
                        <div className="theme-dot" style={{ backgroundColor: "#3b82f6" }} />
                      </div>
                      <div className={`theme-box light-orange-box ${theme === "light-orange" ? "checked" : ""}`} onClick={() => setTheme("light-orange")} title="蜜橘主题">
                        <div className="theme-dot" style={{ backgroundColor: "#ea580c" }} />
                      </div>
                      <div className={`theme-box light-premium-box ${theme === "light-premium" ? "checked" : ""}`} onClick={() => setTheme("light-premium")} title="经典高雅">
                        <div className="theme-dot" style={{ backgroundColor: "#2563eb" }} />
                        {theme === "light-premium" && <span className="theme-checkmark">✓</span>}
                      </div>
                      <div className={`theme-box auto-box ${theme === "auto" ? "checked" : ""}`} onClick={() => setTheme("auto")} title="跟随系统">
                        <span className="auto-text">Auto</span>
                      </div>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">语言</h3>
                    <p className="settings-section-desc">界面语言（更多语言即将支持）</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-btn-group">
                      <button type="button" className="settings-toggle-btn active">简体中文</button>
                      <button type="button" className="settings-toggle-btn disabled" title="English 暂不可选" disabled>
                        English
                      </button>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">窗口</h3>
                    <p className="settings-section-desc">关闭主窗口时的行为</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-btn-group">
                      <button type="button" className={`settings-toggle-btn ${closeBehavior === "ask" ? "active" : ""}`} onClick={() => setCloseBehavior("ask")}>
                        每次询问
                      </button>
                      <button type="button" className={`settings-toggle-btn ${closeBehavior === "minimize" ? "active" : ""}`} onClick={() => setCloseBehavior("minimize")}>
                        最小化到托盘
                      </button>
                      <button type="button" className={`settings-toggle-btn ${closeBehavior === "exit" ? "active" : ""}`} onClick={() => setCloseBehavior("exit")}>
                        直接退出
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeMenu === "agents" && (
              <div className="settings-content">
                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">启用的助手</h3>
                    <p className="settings-section-desc">未启用的助手不会出现在侧栏切换中；Claude Code 始终可用</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input type="checkbox" checked disabled />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">Claude Code（默认）</span>
                    </div>
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input
                          type="checkbox"
                          checked={enabledAgents.pi}
                          onChange={(e) =>
                            setEnabledAgents((prev) => ({ ...prev, claude: true, pi: e.target.checked }))
                          }
                        />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">启用 Pi</span>
                    </div>
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input
                          type="checkbox"
                          checked={enabledAgents.codex}
                          onChange={(e) =>
                            setEnabledAgents((prev) => ({ ...prev, claude: true, codex: e.target.checked }))
                          }
                        />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">启用 Codex</span>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeMenu === "terminal" && (
              <div className="settings-content">
                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">字体与字号</h3>
                    <p className="settings-section-desc">终端画布显示，切换后对新输出与重绘立即生效</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">字体</div>
                    <div className="settings-btn-group">
                      {(["Cascadia Mono", "Fira Code", "Consolas", "monospace"] as const).map((family) => (
                        <button
                          key={family}
                          type="button"
                          className={`settings-toggle-btn ${fontFamily === family ? "active" : ""}`}
                          onClick={() => setFontFamily(family)}
                        >
                          {family === "monospace" ? "System" : family}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">字号</div>
                    <div className="slider-row">
                      <input type="range" min="11.0" max="22.0" step="0.5" className="settings-slider" value={fontSize} onChange={(e) => setFontSize(parseFloat(e.target.value))} />
                      <span className="slider-value">{fontSize.toFixed(1)}px</span>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">终端配色</h3>
                    <p className="settings-section-desc">默认跟随 App 主题；可粘贴 Windows Terminal 配色 JSON</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-btn-group">
                      <button type="button" className={`settings-toggle-btn ${terminalSchemeMode === "default" ? "active" : ""}`} onClick={() => { setTerminalSchemeMode("default"); setTerminalSchemeError(""); }}>
                        默认
                      </button>
                      <button type="button" className={`settings-toggle-btn ${terminalSchemeMode === "custom" ? "active" : ""}`} onClick={() => setTerminalSchemeMode("custom")}>
                        自定义{terminalSchemeName ? ` · ${terminalSchemeName}` : ""}
                      </button>
                    </div>
                    {terminalSchemeMode === "custom" && (
                      <>
                        <div className="settings-helper-text">
                          支持 windowsterminalthemes.dev 导出格式，普通模式与兼容模式均生效。
                        </div>
                        <textarea
                          className="settings-textarea"
                          value={terminalSchemeJson}
                          onChange={(e) => { setTerminalSchemeJson(e.target.value); setTerminalSchemeError(""); }}
                          placeholder={'{\n  "name": "Alabaster",\n  "background": "#f7f7f7",\n  ...\n}'}
                          rows={8}
                        />
                        <div className="settings-inline-actions">
                          <button type="button" className="settings-toggle-btn active" onClick={applyCustomScheme}>应用配色</button>
                          <button
                            type="button"
                            className="settings-toggle-btn"
                            onClick={() => {
                              setTerminalSchemeJson("");
                              setTerminalSchemeName("");
                              setTerminalSchemeError("");
                              localStorage.removeItem(TERMINAL_SCHEME_JSON_KEY);
                              setTerminalSchemeMode("default");
                            }}
                          >
                            清除
                          </button>
                          {terminalSchemeError ? (
                            <span className="settings-status settings-status-error">{terminalSchemeError}</span>
                          ) : terminalSchemeName ? (
                            <span className="settings-status settings-status-ok">已应用：{terminalSchemeName}</span>
                          ) : null}
                        </div>
                      </>
                    )}
                  </div>
                </section>

                {/Windows/i.test(navigator.userAgent) && (
                  <section className="settings-section">
                    <div className="settings-section-head">
                      <h3 className="settings-section-title">Claude 兼容模式</h3>
                      <p className="settings-section-desc">仅影响新打开的 Claude 标签</p>
                    </div>
                    <div className="settings-group">
                      <div className="settings-switch-row">
                        <label className="switch-container">
                          <input
                            type="checkbox"
                            checked={claudeTerminalMode === "native"}
                            onChange={(e) => setClaudeTerminalMode(e.target.checked ? "native" : "standard")}
                          />
                          <span className="switch-slider" />
                        </label>
                        <span className="switch-label">使用独立安全 PTY 与 xterm 渲染链路</span>
                      </div>
                    </div>
                  </section>
                )}

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">回滚缓冲</h3>
                    <p className="settings-section-desc">可回看的最大行数，重启会话后生效</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-number-field">
                      <input
                        type="number"
                        min={1000}
                        max={100000}
                        step={10000}
                        value={scrollback || ""}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          setScrollback(Number.isNaN(val) ? 0 : val);
                        }}
                        onBlur={() => {
                          let val = scrollback;
                          if (Number.isNaN(val) || val < 1000) val = 1000;
                          if (val > 100000) val = 100000;
                          setScrollback(val);
                        }}
                        className="no-native-spinners settings-number-input"
                      />
                      <div className="settings-number-steppers">
                        <button type="button" className="settings-stepper-btn" onClick={() => setScrollback((prev) => Math.min(100000, Math.max(1000, prev + 10000)))}>▲</button>
                        <button type="button" className="settings-stepper-btn" onClick={() => setScrollback((prev) => Math.min(100000, Math.max(1000, prev - 10000)))}>▼</button>
                      </div>
                    </div>
                    <div className="settings-helper-text">范围 1,000 – 100,000</div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">文件预览</h3>
                    <p className="settings-section-desc">右侧预览面板的等宽字体</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">字体</div>
                    <div className="settings-btn-group">
                      {(["Cascadia Mono", "Fira Code", "Consolas", "monospace"] as const).map((family) => (
                        <button
                          key={family}
                          type="button"
                          className={`settings-toggle-btn ${previewFontFamily === family ? "active" : ""}`}
                          onClick={() => setPreviewFontFamily(family)}
                        >
                          {family === "monospace" ? "System" : family}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">字号</div>
                    <div className="slider-row">
                      <input type="range" min="10.0" max="24.0" step="0.5" className="settings-slider" value={previewFontSize} onChange={(e) => setPreviewFontSize(parseFloat(e.target.value))} />
                      <span className="slider-value">{previewFontSize.toFixed(1)}px</span>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">外部工具</h3>
                    <p className="settings-section-desc">标题栏快捷启动 ccswitch</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">ccswitch.exe 路径</div>
                    <div className="settings-path-row">
                      <input
                        type="text"
                        className="settings-text-input"
                        placeholder="例如: C:\Program Files\ccswitch\ccswitch.exe"
                        value={ccswitchPath}
                        onChange={(e) => setCcswitchPath(e.target.value)}
                      />
                      <button type="button" className="settings-secondary-btn" onClick={() => setShowFilePicker(true)}>
                        浏览
                      </button>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeMenu === "notifications" && (
              <div className="settings-content">
                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">系统通知</h3>
                    <p className="settings-section-desc">AI 回答结束且后台时提示</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input type="checkbox" checked={notifyOnComplete} onChange={(e) => setNotifyOnComplete(e.target.checked)} />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">回答完毕时发送系统通知</span>
                    </div>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">通知阈值（持续超过此时长才通知）</div>
                    <div className="slider-row">
                      <input type="range" min="0.5" max="10.0" step="0.5" className="settings-slider" value={notifyThreshold} onChange={(e) => setNotifyThreshold(parseFloat(e.target.value))} />
                      <span className="slider-value">{notifyThreshold.toFixed(1)}s</span>
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">提示音</h3>
                    <p className="settings-section-desc">需先启用系统通知</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input type="checkbox" checked={playSound} onChange={(e) => setPlaySound(e.target.checked)} />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">回答完毕时播放提示音</span>
                    </div>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">音色</div>
                    <div className="settings-btn-group wrap-group">
                      {(["叮咚", "钟声", "成功音", "闹铃", "气泡", "水晶", "梦幻", "水滴"] as const).map((tone) => {
                        const toneKey = {
                          叮咚: "dingdong",
                          钟声: "bell",
                          成功音: "success",
                          闹铃: "alarm",
                          气泡: "bubble",
                          水晶: "crystal",
                          梦幻: "dream",
                          水滴: "water",
                        }[tone];
                        const isActive = soundTone === toneKey;
                        return (
                          <button
                            key={tone}
                            type="button"
                            className={`settings-toggle-btn ${isActive ? "active" : ""}`}
                            onClick={() => {
                              const finalTone = toneKey || "dingdong";
                              setSoundTone(finalTone);
                              triggerPreview(finalTone, soundVolume);
                            }}
                          >
                            {tone}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">音量</div>
                    <div className="slider-row">
                      <input
                        type="range"
                        min="0"
                        max="100"
                        className="settings-slider"
                        value={soundVolume}
                        onChange={(e) => setSoundVolume(parseInt(e.target.value, 10))}
                        onMouseUp={() => triggerPreview(soundTone, soundVolume)}
                      />
                      <span className="slider-value">{soundVolume}%</span>
                    </div>
                  </div>
                </section>
              </div>
            )}

            {activeMenu === "shortcuts" && (
              <div className="settings-content">
                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">状态栏快捷短语</h3>
                    <p className="settings-section-desc">最多 3 条，显示在窗口底部状态栏</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input type="checkbox" checked={shortcutsEnabled} onChange={(e) => setShortcutsEnabled(e.target.checked)} />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">启用快捷短语</span>
                    </div>
                  </div>
                  {shortcutsEnabled && (
                    <div className="settings-group settings-shortcut-list">
                      {shortcutsList.map((item, idx) => (
                        <div key={idx} className="settings-shortcut-row">
                          <span className="settings-shortcut-index">#{idx + 1}</span>
                          <input
                            type="text"
                            className="settings-text-input"
                            placeholder="显示名称"
                            value={item.title}
                            onChange={(e) => {
                              const next = [...shortcutsList];
                              next[idx] = { ...next[idx], title: e.target.value };
                              setShortcutsList(next);
                            }}
                          />
                          <input
                            type="text"
                            className="settings-text-input settings-text-input-wide"
                            placeholder="发送内容"
                            value={item.content}
                            onChange={(e) => {
                              const next = [...shortcutsList];
                              next[idx] = { ...next[idx], content: e.target.value };
                              setShortcutsList(next);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeMenu === "sessions" && (
              <div className="settings-content">
                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">定时清理</h3>
                    <p className="settings-section-desc">启动时将长期未交互会话移入回收站</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input type="checkbox" checked={sessionCleanupEnabled} onChange={(e) => setSessionCleanupEnabled(e.target.checked)} />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">启用启动清理</span>
                    </div>
                  </div>
                  <div className="settings-group">
                    <div className="settings-group-label">未交互天数</div>
                    <div className="slider-row">
                      <input
                        type="range"
                        min={MIN_SESSION_CLEANUP_DAYS}
                        max={365}
                        step={1}
                        className="settings-slider"
                        value={sessionCleanupDays}
                        onChange={(e) => setSessionCleanupDays(normalizeSessionCleanupDays(e.target.value))}
                        disabled={!sessionCleanupEnabled}
                      />
                      <span className="slider-value">{sessionCleanupDays} 天</span>
                    </div>
                    <div className="settings-helper-text">
                      默认 {DEFAULT_SESSION_CLEANUP_DAYS} 天；仅移入回收站，可在 7 天内恢复
                    </div>
                  </div>
                </section>

                <section className="settings-section">
                  <div className="settings-section-head">
                    <h3 className="settings-section-title">会话名称修正</h3>
                    <p className="settings-section-desc">根据对话内容自动生成更可读的标题</p>
                  </div>
                  <div className="settings-group">
                    <div className="settings-btn-group">
                      <button type="button" className={`settings-toggle-btn ${namerMode === "heuristic" ? "active" : ""}`} onClick={() => setNamerMode("heuristic")}>
                        快速（本地）
                      </button>
                      <button type="button" className={`settings-toggle-btn ${namerMode === "llm" ? "active" : ""}`} onClick={() => setNamerMode("llm")}>
                        精准（LLM）
                      </button>
                    </div>
                    <div className="settings-helper-text">
                      {namerMode === "heuristic"
                        ? "纯本地字符串处理，零消耗，速度更快"
                        : "调用 LLM 理解对话，生成更准确标题"}
                    </div>
                  </div>

                  {namerMode === "llm" && (
                    <div className="settings-group settings-llm-fields">
                      <div className="settings-group-label">LLM 配置（OpenAI 兼容）</div>
                      <div className="settings-field-row">
                        <span className="settings-field-label">URL</span>
                        <input type="text" className="settings-text-input" value={llmApiUrl} onChange={(e) => setLlmApiUrl(e.target.value)} placeholder="https://api.deepseek.com" />
                      </div>
                      <div className="settings-field-row">
                        <span className="settings-field-label">Key</span>
                        <input type="password" className="settings-text-input" value={llmApiKey} onChange={(e) => setLlmApiKey(e.target.value)} placeholder="sk-..." />
                      </div>
                      <div className="settings-field-row">
                        <span className="settings-field-label">模型</span>
                        <input type="text" className="settings-text-input" value={llmModel} onChange={(e) => setLlmModel(e.target.value)} placeholder="deepseek-v4-flash" />
                      </div>
                    </div>
                  )}

                  <div className="settings-group">
                    <div className="settings-group-label">触发规则</div>
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input type="checkbox" checked={autoRenameOnStartup} onChange={(e) => setAutoRenameOnStartup(e.target.checked)} />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">启动时自动修正</span>
                    </div>
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input type="checkbox" checked={autoRenameOnIdle} onChange={(e) => setAutoRenameOnIdle(e.target.checked)} />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">空闲后自动修正</span>
                    </div>
                    {autoRenameOnIdle && (
                      <div className="settings-nested">
                        <div className="slider-row">
                          <input type="range" min={1} max={60} step={1} className="settings-slider" value={idleMinutes} onChange={(e) => setIdleMinutes(parseInt(e.target.value, 10))} />
                          <span className="slider-value">{idleMinutes} 分钟</span>
                        </div>
                        <div className="settings-helper-text">空闲超过此时长且有新对话时触发</div>
                      </div>
                    )}
                    <div className="settings-switch-row">
                      <label className="switch-container">
                        <input type="checkbox" checked={autoRenameSkipFavorites} onChange={(e) => setAutoRenameSkipFavorites(e.target.checked)} />
                        <span className="switch-slider" />
                      </label>
                      <span className="switch-label">跳过收藏的会话</span>
                    </div>
                  </div>

                  <div className="settings-group settings-inline-actions">
                    <button type="button" className="settings-toggle-btn active" onClick={handleManualRename} disabled={isRenaming} style={{ opacity: isRenaming ? 0.6 : 1 }}>
                      {isRenaming ? "修正中…" : "立即修正全部"}
                    </button>
                    {lastRenameResult && <span className="settings-status">{lastRenameResult}</span>}
                  </div>
                </section>
              </div>
            )}

            {activeMenu === "remote" && (
              <div className="settings-content">
                <RemoteSettingsPanel />
              </div>
            )}

            {activeMenu === "about" && (
              <div className="settings-content about-page">
                <div className="about-logo">KK</div>
                <div className="about-title">KKCoder AI 终端管理器</div>
                <div className="about-version">版本 v1.2.0</div>
                <div className="about-desc">
                  极简、现代、克制的 AI 终端托管管理器。基于 Tauri 与 React，为硬核开发者打造丝滑的原生终端心流体验。
                </div>
                <div className="about-divider" />
                <div className="about-meta">
                  <p>© 2026 KKCoder Studio</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <DirectoryPickerModal
        show={showFilePicker}
        onClose={() => setShowFilePicker(false)}
        onSelect={(path) => setCcswitchPath(path)}
        initialPath={ccswitchPath || "D:\\"}
        mode="file"
        extensions={["exe"]}
        title="选择 ccswitch.exe 路径"
      />
    </div>
  );
};

