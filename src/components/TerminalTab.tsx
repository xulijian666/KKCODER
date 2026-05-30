import React, { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "xterm-addon-fit";
import "xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

interface TerminalTabProps {
  sessionId: string;
  directory: string;
  agentType: "claude" | "pi";
  agentSessionId: string;
  isReopen: boolean;
  onSpawned?: () => void;
  onCaptureSessionId?: (sessionId: string, agentSessionId: string) => void;
}

const getTerminalThemeColors = (themeName: string, agentType: "claude" | "pi") => {
  let isDark = false;
  if (themeName === "dark-blue" || themeName === "dark-purple" || themeName === "dark-zinc") {
    isDark = true;
  } else if (themeName === "auto") {
    isDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  } else {
    isDark = false;
  }

  return {
    background: isDark ? "#000000" : "#ffffff",
    foreground: isDark ? "#f8fafc" : "#334155",
    cursor: agentType === "claude" ? "#f97316" : "#10b981", // 橙色/绿色光标
    selectionBackground: isDark ? "rgba(255, 255, 255, 0.2)" : "rgba(59, 130, 246, 0.3)",
    black: isDark ? "#000000" : "#0f172a",
    red: "#ef4444",
    green: "#10b981",
    yellow: "#f59e0b",
    blue: "#3b82f6",
    magenta: "#8b5cf6",
    cyan: "#06b6d4",
    // 浅色模式下，ANSI White 必须映射为深灰色，否则白底白字无法看清
    white: isDark ? "#ffffff" : "#475569",
    // 浅色模式下，明亮色版本需要降低亮度（使用深沉的高饱和度色），保证高对比度与易读性
    brightBlack: isDark ? "#94a3b8" : "#64748b",
    brightRed: isDark ? "#f87171" : "#dc2626",
    brightGreen: isDark ? "#34d399" : "#16a34a",
    brightYellow: isDark ? "#fbbf24" : "#d97706",
    brightBlue: isDark ? "#60a5fa" : "#2563eb",
    brightMagenta: isDark ? "#a78bfa" : "#7c3aed",
    brightCyan: isDark ? "#22d3ee" : "#0891b2",
    // 浅色模式下，ANSI Bright White 必须映射为炭黑色，保证完美易读性
    brightWhite: isDark ? "#ffffff" : "#0f172a",
  };
};

export const TerminalTab: React.FC<TerminalTabProps> = ({
  sessionId,
  directory,
  agentType,
  agentSessionId,
  isReopen,
  onSpawned,
  onCaptureSessionId,
}) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const capturedRef = useRef<boolean>(false);

  const isAnsweringRef = useRef<boolean>(false);
  const commandStartTimeRef = useRef<number>(0);
  const lastOutputTimeRef = useRef<number>(0);
  const debounceTimeoutRef = useRef<any>(null);



  useEffect(() => {
    const log = (msg: string) => {
      const time = new Date().toISOString();
      const fullMsg = `[JS][TerminalTab][${sessionId}][${time}] ${msg}`;
      console.log(fullMsg);
      try {
        const existingLogs = JSON.parse(localStorage.getItem("kkcoder_logs") || "[]");
        existingLogs.push(fullMsg);
        if (existingLogs.length > 200) {
          existingLogs.shift();
        }
        localStorage.setItem("kkcoder_logs", JSON.stringify(existingLogs));
      } catch (e) {}
    };

    log(`useEffect triggered: directory=${directory}, agentType=${agentType}, isReopen=${isReopen}`);
    if (!terminalRef.current) {
      log("Error: terminalRef.current is null! Returning.");
      return;
    }

    log("Initializing Terminal instance...");
    // 1. 根据当前选择的主题自适应配置终端黑白底色 (前三个黑底，后三个白底)
    const savedTheme = localStorage.getItem("kkcoder_setting_theme") || "light-premium";
    const savedFont = localStorage.getItem("kkcoder_setting_font_family") || "Cascadia Mono";
    const savedSizeStr = localStorage.getItem("kkcoder_setting_font_size");
    const savedSize = savedSizeStr ? parseFloat(savedSizeStr) : 13.5;
    const initialColors = getTerminalThemeColors(savedTheme, agentType);

    const term = new Terminal({
      cursorBlink: true,
      fontSize: savedSize,
      fontFamily: `${savedFont}, Fira Code, Consolas, Monaco, monospace`,
      theme: initialColors,
      convertEol: true,
    });

    log("Loading FitAddon and opening terminal in container...");
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(terminalRef.current);

    // 绑定自定义键盘按键处理器：支持 Ctrl+C 进行快捷复制且禁用退出命令，支持 Ctrl+V 完美粘贴且阻断重复
    term.attachCustomKeyEventHandler((arg) => {
      if (arg.ctrlKey && arg.code === "KeyC") {
        if (arg.type === "keydown") {
          if (term.hasSelection()) {
            const selectedText = term.getSelection();
            navigator.clipboard.writeText(selectedText).catch((err) => {
              log(`Failed to copy selected text via Ctrl+C: ${err}`);
            });
          }
        }
        return false; // 返回 false 拦截所有默认行为 (禁用 PTY 响应 Ctrl+C 退出进程)
      }

      if (arg.ctrlKey && arg.code === "KeyV") {
        if (arg.type === "keydown" && !arg.repeat) {
          log("Ctrl+V keydown event captured in terminal. Reading clipboard...");
          navigator.clipboard.readText().then((text) => {
            if (text) {
              log(`Pasting clipboard content synchronously in user gesture loop (len=${text.length}).`);
              if (agentType === "pi") {
                const processedText = text.replace(/\r?\n/g, " ");
                term.paste(processedText);
              } else {
                term.paste(text);
              }
            }
          }).catch((err) => {
            log(`Failed to read clipboard for Ctrl+V paste: ${err}`);
          });
        }
        return false; // 返回 false 拦截浏览器默认及 keyup/keydown 重复事件，规避双重粘贴
      }
      return true;
    });

    // 绑定选择改变处理器：当有文本被选中时，自动将其复制到剪贴板中 (高度平替 copyOnSelect)
    term.onSelectionChange(() => {
      if (term.hasSelection()) {
        const selectedText = term.getSelection();
        navigator.clipboard.writeText(selectedText).catch((err) => {
          log(`Failed to copy selection on select: ${err}`);
        });
      }
    });
    
    // 延迟少许等 DOM 渲染完成后精准测量尺寸
    log("Scheduling initial fit addon measurement (100ms)...");
    setTimeout(() => {
      try {
        log("Executing fitAddon.fit()");
        fitAddon.fit();
        log("fitAddon.fit() completed.");
      } catch (e) {
        log(`Error running fitAddon.fit(): ${e}`);
        console.error(e);
      }
    }, 100);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    let unlistenFn: (() => void) | null = null;

    // 2. 异步注册监听 Rust 后端 PTY Event 消息流
    log("Setting up pty-output listener...");
    const setupListener = async () => {
      try {
        unlistenFn = await listen<{ session_id: string; data: string }>(
          "pty-output",
          (event) => {
            if (event.payload.session_id === sessionId) {
              term.write(event.payload.data);

              // 智能回答/任务执行完毕检测与提示音系统
              if (isAnsweringRef.current) {
                lastOutputTimeRef.current = Date.now();
                if (debounceTimeoutRef.current) {
                  clearTimeout(debounceTimeoutRef.current);
                }
                debounceTimeoutRef.current = setTimeout(() => {
                  // 600ms 内无新 PTY 输出，判定命令/回答执行完全结束
                  const elapsed = (Date.now() - commandStartTimeRef.current) / 1000;
                  log(`检测到 PTY 静默，执行结束。本次持续耗时: ${elapsed.toFixed(2)} 秒`);

                  const notifyEnabled = localStorage.getItem("kkcoder_setting_notify_on_complete") !== "false";
                  const notifyThresholdStr = localStorage.getItem("kkcoder_setting_notify_threshold");
                  const notifyThreshold = notifyThresholdStr ? parseFloat(notifyThresholdStr) : 2.0;
                  const playSoundEnabled = localStorage.getItem("kkcoder_setting_play_sound") !== "false";
                  const soundTone = localStorage.getItem("kkcoder_setting_sound_tone") || "dingdong";
                  const soundVolumeStr = localStorage.getItem("kkcoder_setting_sound_volume");
                  const soundVolume = soundVolumeStr ? parseInt(soundVolumeStr, 10) : 80;

                  if (notifyEnabled && elapsed >= notifyThreshold) {
                    log(`满足提示阈值 (${elapsed.toFixed(2)}s >= ${notifyThreshold}s)。触发提示音与系统通知。`);
                    
                    invoke("play_notification_sound", {
                      tone: soundTone,
                      volume: soundVolume,
                      title: "KKCoder AI 终端",
                      message: playSoundEnabled 
                        ? `回答完毕！本次运行共耗时 ${elapsed.toFixed(1)} 秒。`
                        : null // 若不启用播放提示音，则仅通过 null 标记静默通知
                    }).catch((err) => {
                      log(`Failed to trigger play_notification_sound: ${err}`);
                    });
                  }

                  isAnsweringRef.current = false;
                  debounceTimeoutRef.current = null;
                }, 600);
              }

              // 首次创建的 Pi 终端：自动捕获 /session 指令返回的实际 session ID 并回传保存
              if (agentType === "pi" && !isReopen && !capturedRef.current) {
                const rawOutput = event.payload.data;
                // 1. 尝试匹配 "Session ID: xxx" 格式
                const match = rawOutput.match(/(?:Session ID|session id|Session|session)\s*[:=]?\s*([a-zA-Z0-9\-]{8,64})/i);
                if (match && match[1] && match[1].toLowerCase() !== "session") {
                  const capturedId = match[1];
                  capturedRef.current = true;
                  log(`Captured Pi real session ID: ${capturedId}`);
                  if (onCaptureSessionId) {
                    onCaptureSessionId(sessionId, capturedId);
                  }
                } else {
                  // 2. 尝试匹配标准 UUID 格式
                  const uuidMatch = rawOutput.match(/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/);
                  if (uuidMatch) {
                    const capturedId = uuidMatch[0];
                    capturedRef.current = true;
                    log(`Captured Pi UUID session ID: ${capturedId}`);
                    if (onCaptureSessionId) {
                      onCaptureSessionId(sessionId, capturedId);
                    }
                  }
                }
              }
            }
          }
        );
        log("pty-output listener registered successfully.");
      } catch (e) {
        log(`Failed to set up pty-output listener: ${e}`);
      }
    };
    setupListener();

    // 3. 监听前端的键盘按键并将 keystroke 发送到 Rust PTY
    log("Binding term.onData to write_to_terminal...");
    const onDataDisposable = term.onData((data) => {
      // 当输入流中含有回车键或换行符时，标志着用户发送了命令，启动回答计时器
      if (data.includes("\r") || data.includes("\n")) {
        isAnsweringRef.current = true;
        commandStartTimeRef.current = Date.now();
        lastOutputTimeRef.current = Date.now();
      }
      invoke("write_to_terminal", { sessionId, data }).catch((err) => {
        log(`write_to_terminal error: ${err}`);
      });
    });

    // 4. 监听终端自身的 resize 事件并同步到 PTY
    log("Binding term.onResize to resize_terminal...");
    const onResizeDisposable = term.onResize(({ cols, rows }) => {
      invoke("resize_terminal", { sessionId, cols, rows }).catch((err) => {
        log(`resize_terminal error: ${err}`);
      });
    });

    // 5. 调用 Rust spawn_terminal 接口拉起后端 PTY 进程
    log("Calling Backend invoke('spawn_terminal')...");
    invoke("spawn_terminal", { sessionId, directory, agentType, agentSessionId, isReopen })
      .then(() => {
        log("Backend spawn_terminal resolved successfully.");
        if (onSpawned) {
          onSpawned();
        }
        // PTY 成功拉起后，触发一次初始的尺寸同步
        try {
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            log(`Proposing terminal dimensions: cols=${dims.cols}, rows=${dims.rows}`);
            invoke("resize_terminal", {
              sessionId,
              cols: dims.cols,
              rows: dims.rows,
            }).catch((err) => log(`Initial resize_terminal error: ${err}`));
          }
        } catch (e) {
          log(`Error proposing dimensions: ${e}`);
          console.error(e);
        }
      })
      .catch((err) => {
        log(`Backend spawn_terminal REJECTED: ${err}`);
        term.write(
          `\r\n\x1b[31m[KKCoder 核心错误] 无法拉起本地虚拟终端: ${err}\x1b[0m\r\n`
        );
      });

    // 6. 监听窗口 resize 事件自动重绘
    const handleWindowResize = () => {
      try {
        fitAddon.fit();
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          invoke("resize_terminal", {
            sessionId,
            cols: dims.cols,
            rows: dims.rows,
          }).catch((err) => log(`Window resize sync error: ${err}`));
        }
      } catch (e) {
        // 捕获未挂载时测量的尺寸异常
      }
    };
    // 监听全局 contextmenu 并使用捕获阶段，确保能先于 xterm.js 拦截并调用 preventDefault()，实现右键静默复制
    const handleRawContextMenu = (e: MouseEvent) => {
      if (terminalRef.current && terminalRef.current.contains(e.target as Node)) {
        e.preventDefault();
        e.stopPropagation();
        
        if (term.hasSelection()) {
          const selectedText = term.getSelection();
          navigator.clipboard.writeText(selectedText)
            .then(() => {
              log("Copied selection quietly on right-click.");
            })
            .catch((err) => {
              log(`Failed to copy selection on contextmenu: ${err}`);
            });
        }
      }
    };
    document.addEventListener("contextmenu", handleRawContextMenu, true);

    // 注册系统级粘贴静默盾牌，彻底防范任何 WebView2 原生 edit 命令引发的双份粘贴或非预期落盘事件
    const handlePaste = (e: ClipboardEvent) => {
      log("Native paste event captured in silent shield. Silencing standard insertion...");
      e.preventDefault();
      e.stopPropagation();
    };
    const terminalElement = terminalRef.current;
    if (terminalElement) {
      terminalElement.addEventListener("paste", handlePaste, true);
    }

    window.addEventListener("resize", handleWindowResize);

    // 7. 监听主题切换的全局自定义事件，实现 PTY 终端画布底色实时刷新 (黑底 `#000000` / 白底 `#ffffff`)
    const handleThemeChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      const newTheme = customEvent.detail;
      log(`Received theme change event: theme=${newTheme}`);
      const newColors = getTerminalThemeColors(newTheme, agentType);
      term.options.theme = newColors;
    };
    window.addEventListener("kkcoder-theme-change", handleThemeChange);

    // 7b. 监听终端字体切换的全局自定义事件，实现 PTY 终端字体实时更新
    const handleFontChange = (e: Event) => {
      const customEvent = e as CustomEvent<string>;
      const newFont = customEvent.detail;
      log(`Received font change event: font=${newFont}`);
      term.options.fontFamily = `${newFont}, Fira Code, Consolas, Monaco, monospace`;
    };
    window.addEventListener("kkcoder-font-change", handleFontChange);

    // 7c. 监听终端字号切换的全局自定义事件，实现 PTY 终端字号实时更新并自动重测尺寸
    const handleFontSizeChange = (e: Event) => {
      const customEvent = e as CustomEvent<number>;
      const newSize = customEvent.detail;
      log(`Received font size change event: size=${newSize}`);
      term.options.fontSize = newSize;
      
      // 精准防抖动触发 fit，等 Canvas 重绘完成
      setTimeout(() => {
        try {
          fitAddon.fit();
          const dims = fitAddon.proposeDimensions();
          if (dims) {
            invoke("resize_terminal", {
              sessionId,
              cols: dims.cols,
              rows: dims.rows,
            }).catch((err) => log(`Font size change resize sync error: ${err}`));
          }
        } catch (err) {}
      }, 50);
    };
    window.addEventListener("kkcoder-font-size-change", handleFontSizeChange);

    return () => {
      log("TerminalTab unmounting. Cleaning up...");
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      document.removeEventListener("contextmenu", handleRawContextMenu, true);
      if (terminalElement) {
        terminalElement.removeEventListener("paste", handlePaste, true);
      }
      window.removeEventListener("resize", handleWindowResize);
      window.removeEventListener("kkcoder-theme-change", handleThemeChange);
      window.removeEventListener("kkcoder-font-change", handleFontChange);
      window.removeEventListener("kkcoder-font-size-change", handleFontSizeChange);
      onDataDisposable.dispose();
      onResizeDisposable.dispose();
      if (unlistenFn) {
        unlistenFn();
      }
      term.dispose();
      log("TerminalTab cleanup finished.");
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, directory, agentType]);

  return (
    <div className="terminal-container">
      <div className="terminal-ref" ref={terminalRef} />
    </div>
  );
};
