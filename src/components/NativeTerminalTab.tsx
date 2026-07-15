import React, { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import {
  captureUserInputData,
  deriveSessionTitleFromInput,
} from "../utils/sessionTitle";
import { resolveCtrlCAction } from "../utils/terminalKeyPolicy";
import {
  createNativeTerminalLifecycle,
  type NativeTerminalLifecycle,
} from "../utils/nativeTerminalLifecycle";
import {
  getActiveTerminalTheme,
  TERMINAL_SCHEME_CHANGE_EVENT,
} from "../utils/terminalScheme";
import "./NativeTerminalTab.css";

interface CompatibilityTerminalTabProps {
  sessionId: string;
  directory: string;
  agentSessionId: string;
  isReopen: boolean;
  isActive?: boolean;
  onSpawned?: () => void;
  onStateChange?: (busy: boolean) => void;
  onCommandComplete?: () => void;
  onUserSubmittedInput?: (sessionId: string, submittedAt: string) => void;
  onRenameSession?: (sessionId: string, newName: string) => void;
}

const decodeBase64Bytes = (encoded: string): Uint8Array => {
  const binary = atob(encoded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
};

export const CompatibilityTerminalTab: React.FC<CompatibilityTerminalTabProps> = ({
  sessionId,
  directory,
  agentSessionId,
  isReopen,
  isActive = false,
  onSpawned,
  onStateChange,
  onCommandComplete,
  onUserSubmittedInput,
  onRenameSession,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const listenerReadyRef = useRef<Promise<void>>(Promise.resolve());
  const lifecycleRef = useRef<NativeTerminalLifecycle | null>(null);
  const spawnedRef = useRef(false);
  const activeRef = useRef(isActive);
  const onSpawnedRef = useRef(onSpawned);
  onSpawnedRef.current = onSpawned;
  const onStateChangeRef = useRef(onStateChange);
  onStateChangeRef.current = onStateChange;
  const onCommandCompleteRef = useRef(onCommandComplete);
  onCommandCompleteRef.current = onCommandComplete;
  const onUserSubmittedInputRef = useRef(onUserSubmittedInput);
  onUserSubmittedInputRef.current = onUserSubmittedInput;
  const onRenameSessionRef = useRef(onRenameSession);
  onRenameSessionRef.current = onRenameSession;
  const userInputBufferRef = useRef("");
  const isAnsweringRef = useRef(false);
  const commandStartTimeRef = useRef(0);
  const completionTimerRef = useRef<number | null>(null);
  const autoTitleDoneStorageKey = `kkcoder_session_auto_title_done_${sessionId}`;
  const [status, setStatus] = useState<"starting" | "ready" | "error">("starting");
  const [error, setError] = useState("");

  useEffect(() => {
    activeRef.current = isActive;
    const terminal = terminalRef.current;
    if (!terminal || !isActive) return;

    requestAnimationFrame(() => {
      try {
        fitAddonRef.current?.fit();
        terminal.focus();
      } catch (reason) {
        console.error("Failed to activate compatibility terminal", reason);
      }
    });
  }, [isActive]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const fontFamily = localStorage.getItem("kkcoder_setting_font_family") || "Cascadia Mono";
    const fontSize = Number.parseFloat(localStorage.getItem("kkcoder_setting_font_size") || "13.5");
    const scrollback = Number.parseInt(localStorage.getItem("kkcoder_setting_scrollback") || "10000", 10);
    const decoder = new TextDecoder("utf-8");
    const terminalTheme = getActiveTerminalTheme();
    const terminal = new Terminal({
      cols: 80,
      rows: 24,
      cursorBlink: true,
      fontFamily: `${fontFamily}, Fira Code, Consolas, Monaco, monospace`,
      fontSize: Number.isFinite(fontSize) ? fontSize : 13.5,
      scrollback: Number.isFinite(scrollback) ? scrollback : 10000,
      scrollOnEraseInDisplay: true,
      windowsPty: { backend: "conpty" },
      theme: terminalTheme,
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    terminal.attachCustomKeyEventHandler((event) => {
      // Ctrl+C — 有选区则复制，无选区则发送中断
      if (event.ctrlKey && event.code === "KeyC") {
        if (event.type !== "keydown") return false;

        const action = resolveCtrlCAction(
          terminal.hasSelection(),
          userInputBufferRef.current,
          event.repeat,
        );
        if (action === "copy") {
          navigator.clipboard.writeText(terminal.getSelection()).catch((reason) => {
            console.error("Failed to copy compatibility terminal selection", reason);
          });
        } else if (action === "interrupt") {
          userInputBufferRef.current = "";
          invoke("write_to_compat_terminal", { sessionId, data: "\x03" }).catch((reason) => {
            console.error("Failed to clear compatibility terminal input", reason);
          });
        }
        return false;
      }

      // Ctrl+V — 优先检测剪贴板图片（截图粘贴），其次处理文件路径，最后纯文本
      if (event.ctrlKey && event.code === "KeyV") {
        if (event.type !== "keydown" || event.repeat) return false;

        const pasteClipboardImage = async (): Promise<boolean> => {
          try {
            const clipboardItems = await navigator.clipboard.read();
            for (const clipboardItem of clipboardItems) {
              for (const type of clipboardItem.types) {
                if (!type.startsWith("image/")) continue;
                try {
                  const blob = await clipboardItem.getType(type);
                  const ext =
                    type.includes("jpeg") || type.includes("jpg")
                      ? "jpg"
                      : type.includes("gif")
                        ? "gif"
                        : type.includes("webp")
                          ? "webp"
                          : "png";
                  const filename = `clipboard_img_${Date.now()}_${Math.random().toString(36).substring(2, 9)}.${ext}`;
                  const arrayBuffer = await blob.arrayBuffer();
                  const bytes = Array.from(new Uint8Array(arrayBuffer));
                  const filePath = await invoke<string>("save_clipboard_image", { bytes, filename });
                  terminal.paste(`"${filePath}"`);
                  return true;
                } catch (e) {
                  console.error("Failed to save clipboard image in compat terminal:", e);
                  return false;
                }
              }
            }
          } catch (e) {
            console.error("Failed to read clipboard items for image in compat terminal:", e);
          }
          return false;
        };

        navigator.clipboard
          .readText()
          .then(async (text) => {
            if (!text || !text.trim()) {
              const pastedImage = await pasteClipboardImage();
              if (!pastedImage) {
                console.warn("Clipboard has neither text nor image in compat terminal.");
              }
              return;
            }

            let isFilePath = false;
            try {
              isFilePath = await invoke<boolean>("check_if_paths_exist", { text });
            } catch (err) {
              console.error(`Failed to check if paths exist in compat terminal: ${err}`);
            }

            if (isFilePath) {
              const lines = text
                .split(/\r?\n/)
                .map((l) => l.trim())
                .filter((l) => l.length > 0);
              const formatted = lines
                .map((line) => {
                  const clean = line
                    .replace(/^"(.*)"$/, "$1")
                    .replace(/^'(.*)'$/, "$1");
                  return `"${clean}"`;
                })
                .join(" ");
              terminal.paste(formatted);
              return;
            }

            terminal.paste(text);
          })
          .catch(async (err) => {
            console.error("Failed to read clipboard text in compat terminal:", err);
            await pasteClipboardImage();
          });

        return false;
      }

      return true;
    });

    let cancelled = false;
    let unlisten: UnlistenFn | null = null;
    let writeFrame: number | null = null;
    let fitFrame: number | null = null;
    let queuedOutput: string[] = [];

    const beginAnswering = () => {
      isAnsweringRef.current = true;
      commandStartTimeRef.current = Date.now();
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      onStateChangeRef.current?.(true);
    };

    const completeAnswer = () => {
      if (!isAnsweringRef.current) return;
      const elapsed = (Date.now() - commandStartTimeRef.current) / 1000;
      const notifyEnabled = localStorage.getItem("kkcoder_setting_notify_on_complete") !== "false";
      const notifyThreshold = Number.parseFloat(
        localStorage.getItem("kkcoder_setting_notify_threshold") || "2",
      );
      const playSound = localStorage.getItem("kkcoder_setting_play_sound") !== "false";
      const tone = localStorage.getItem("kkcoder_setting_sound_tone") || "dingdong";
      const volume = Number.parseInt(localStorage.getItem("kkcoder_setting_sound_volume") || "80", 10);

      if (notifyEnabled && elapsed >= notifyThreshold) {
        invoke("play_notification_sound", {
          tone,
          volume,
          title: "KKCoder AI 终端",
          message: playSound ? `回答完毕！本次运行共耗时 ${elapsed.toFixed(1)} 秒。` : null,
        }).catch((reason) => console.error("Failed to notify compatibility completion", reason));
      }

      isAnsweringRef.current = false;
      completionTimerRef.current = null;
      onStateChangeRef.current?.(false);
      onCommandCompleteRef.current?.();
    };

    const scheduleCompletion = (latestOutput: string) => {
      if (!isAnsweringRef.current) return;
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
      }
      const looksLikePrompt = /(?:^|\r?\n)\s*[❯>]\s*$/u.test(latestOutput)
        || /bypass permissions on|shift\+tab to cycle/i.test(latestOutput);
      completionTimerRef.current = window.setTimeout(completeAnswer, looksLikePrompt ? 800 : 3500);
    };

    const flushOutput = () => {
      writeFrame = null;
      if (queuedOutput.length === 0) return;
      const output = queuedOutput.join("");
      queuedOutput = [];
      terminal.write(output);
    };

    listenerReadyRef.current = listen<string>(`compat-terminal-output-${sessionId}`, (event) => {
      if (cancelled) return;
      const text = decoder.decode(decodeBase64Bytes(event.payload), { stream: true });
      if (!text) return;
      queuedOutput.push(text);
      scheduleCompletion(text);
      if (writeFrame === null) {
        writeFrame = requestAnimationFrame(flushOutput);
      }
    }).then((stopListening) => {
      if (cancelled) {
        stopListening();
      } else {
        unlisten = stopListening;
      }
    });

    const dataDisposable = terminal.onData((data) => {
      const captured = captureUserInputData(userInputBufferRef.current, data);
      userInputBufferRef.current = captured.buffer;
      let submittedAt: string | null = null;

      if (captured.submitted) {
        const rawInput = captured.submittedInput.trim();
        if (rawInput) submittedAt = new Date().toISOString();

        if (!isReopen && !localStorage.getItem(autoTitleDoneStorageKey)) {
          const title = deriveSessionTitleFromInput(rawInput);
          if (title) {
            localStorage.setItem(autoTitleDoneStorageKey, "true");
            localStorage.setItem(`kkcoder_session_has_dialogue_${sessionId}`, "true");
            onRenameSessionRef.current?.(sessionId, title);
          }
        }

        userInputBufferRef.current = "";
        beginAnswering();
      }

      invoke("write_to_compat_terminal", { sessionId, data })
        .then(() => {
          if (submittedAt) {
            onUserSubmittedInputRef.current?.(sessionId, submittedAt);
          }
        })
        .catch((reason) => {
          console.error("Failed to write to compatibility terminal", reason);
          if (captured.submitted) {
            isAnsweringRef.current = false;
            onStateChangeRef.current?.(false);
          }
        });
    });

    const handleInsertConversationTag = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string; text: string }>).detail;
      if (!detail || detail.sessionId !== sessionId || !detail.text) return;
      userInputBufferRef.current += detail.text;
      invoke("write_to_compat_terminal", { sessionId, data: detail.text })
        .then(() => terminal.focus())
        .catch((reason) => console.error("Failed to insert path into compatibility terminal", reason));
    };
    window.addEventListener("kkcoder-insert-conversation-tag", handleInsertConversationTag);

    const handleProgrammaticSubmission = (event: Event) => {
      const detail = (event as CustomEvent<{ sessionId: string }>).detail;
      if (!detail || detail.sessionId !== sessionId) return;
      beginAnswering();
    };
    window.addEventListener("kkcoder-compat-terminal-submitted", handleProgrammaticSubmission);

    const handleFontChange = (e: Event) => {
      const detail = (e as CustomEvent<string>).detail;
      if (!terminalRef.current) return;
      terminalRef.current.options.fontFamily = `${detail}, Fira Code, Consolas, Monaco, monospace`;
      fitAddonRef.current?.fit();
    };
    window.addEventListener("kkcoder-font-change", handleFontChange);

    const handleTerminalSchemeChange = () => {
      if (!terminalRef.current) return;
      terminalRef.current.options.theme = getActiveTerminalTheme();
    };
    window.addEventListener(TERMINAL_SCHEME_CHANGE_EVENT, handleTerminalSchemeChange);

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      if (!spawnedRef.current || cols < 40 || rows < 8) return;
      invoke("resize_compat_terminal", { sessionId, cols, rows }).catch((reason) => {
        console.error("Failed to resize compatibility terminal", reason);
      });
    });

    const scheduleFit = () => {
      if (!activeRef.current || container.offsetWidth <= 0 || container.offsetHeight <= 0) return;
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      fitFrame = requestAnimationFrame(() => {
        fitFrame = requestAnimationFrame(() => {
          fitFrame = null;
          try {
            fitAddon.fit();
          } catch (reason) {
            console.error("Failed to fit compatibility terminal", reason);
          }
        });
      });
    };
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(container);
    scheduleFit();

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      window.removeEventListener("kkcoder-insert-conversation-tag", handleInsertConversationTag);
      window.removeEventListener("kkcoder-compat-terminal-submitted", handleProgrammaticSubmission);
      window.removeEventListener("kkcoder-font-change", handleFontChange);
      window.removeEventListener(TERMINAL_SCHEME_CHANGE_EVENT, handleTerminalSchemeChange);
      dataDisposable.dispose();
      resizeDisposable.dispose();
      unlisten?.();
      if (writeFrame !== null) cancelAnimationFrame(writeFrame);
      if (fitFrame !== null) cancelAnimationFrame(fitFrame);
      if (completionTimerRef.current !== null) {
        window.clearTimeout(completionTimerRef.current);
        completionTimerRef.current = null;
      }
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    lifecycleRef.current ??= createNativeTerminalLifecycle(
      async () => {
        await listenerReadyRef.current;
        const dimensions = fitAddonRef.current?.proposeDimensions();
        await invoke("spawn_compat_terminal", {
          sessionId,
          directory,
          agentSessionId,
          isReopen,
          initialCols: dimensions?.cols ?? 80,
          initialRows: dimensions?.rows ?? 24,
        });
      },
      () => invoke("close_compat_terminal", { sessionId }),
    );
    const lifecycle = lifecycleRef.current;
    const lease = lifecycle.acquire();

    lease.ready
      .then((isCurrentMount) => {
        if (!isCurrentMount || cancelled) return;
        spawnedRef.current = true;
        setStatus("ready");
        onSpawnedRef.current?.();
        try {
          fitAddonRef.current?.fit();
          if (activeRef.current) terminalRef.current?.focus();
        } catch (reason) {
          console.error("Failed to finalize compatibility terminal layout", reason);
        }
      })
      .catch((reason) => {
        if (cancelled) return;
        setStatus("error");
        setError(String(reason));
      });

    return () => {
      cancelled = true;
      spawnedRef.current = false;
      lifecycle.release(lease.ticket).catch((reason) => {
        console.error("Failed to close compatibility terminal", reason);
      });
    };
  }, [agentSessionId, directory, isReopen, sessionId]);

  return (
    <div className="native-terminal-shell">
      <div className="native-terminal-container" ref={containerRef} />
      {status === "starting" && (
        <div className="native-terminal-status">正在启动独立兼容终端…</div>
      )}
      {status === "error" && (
        <div className="native-terminal-error">
          <strong>兼容终端模式启动失败</strong>
          <span>{error}</span>
          <span>请关闭该标签后重试，或在设置中切回标准终端模式。</span>
        </div>
      )}
    </div>
  );
};
