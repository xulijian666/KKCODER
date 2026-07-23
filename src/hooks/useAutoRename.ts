import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { invoke } from "@tauri-apps/api/core";
import type { Session } from "../components/Sidebar";
import { log } from "../utils/log";

export interface UseAutoRenameOptions {
  sessions: Session[];
  setSessions: Dispatch<SetStateAction<Session[]>>;
}

export function useAutoRename({ sessions, setSessions }: UseAutoRenameOptions) {
  const initialRenameTimes = (() => {
    try {
      return JSON.parse(localStorage.getItem("kkcoder_last_rename_times") || "{}") as Record<string, number>;
    } catch {
      return {} as Record<string, number>;
    }
  })();
  const lastRenameTimesRef = useRef<Record<string, number>>(initialRenameTimes);
  const renamedSinceLastInputRef = useRef<Set<string>>(new Set());

  const triggerAutoRename = useCallback(
    (source: string) => {
      const mode = localStorage.getItem("kkcoder_setting_namer_mode") || "heuristic";
      const skipFavorites = localStorage.getItem("kkcoder_setting_auto_rename_skip_favorites") !== "false";
      const command = mode === "llm" ? "llm_rename_sessions" : "auto_rename_sessions";
      const params: Record<string, unknown> = {
        skipFavorites,
        projectFilter: null,
      };

      if (mode === "llm") {
        const apiKey = localStorage.getItem("kkcoder_setting_llm_api_key") || "";
        if (!apiKey) {
          log(`${source} auto-rename: LLM mode enabled but API key is empty, skipping.`);
          return;
        }
        params.apiUrl = localStorage.getItem("kkcoder_setting_llm_api_url") || "https://api.deepseek.com";
        params.apiKey = apiKey;
        params.model = localStorage.getItem("kkcoder_setting_llm_model") || "deepseek-v4-flash";
        params.lastRenameTimes = JSON.stringify(lastRenameTimesRef.current);
      }

      invoke<{ session_id: string; old_name: string; new_name: string; changed: boolean }[]>(command, params)
        .then((results) => {
          const changed = results.filter((result) => result.changed);
          if (changed.length === 0) return;
          log(`${source} auto-rename (${mode}): ${changed.length} sessions renamed.`);
          const now = Date.now() / 1000;
          for (const result of changed) {
            lastRenameTimesRef.current[result.session_id] = now;
          }
          try {
            localStorage.setItem("kkcoder_last_rename_times", JSON.stringify(lastRenameTimesRef.current));
          } catch {
            // ignore
          }
          invoke<Session[]>("get_sessions")
            .then((updated) => {
              if (updated) setSessions(updated);
            })
            .catch(() => {});
        })
        .catch((error) => log(`${source} auto-rename failed: ${error}`));
    },
    [setSessions],
  );

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (localStorage.getItem("kkcoder_setting_auto_rename_idle") !== "true") return;

      const now = Date.now();
      const idleMinutes = parseInt(localStorage.getItem("kkcoder_setting_idle_minutes") || "5", 10);
      const idleMilliseconds = idleMinutes * 60 * 1000;
      const skipFavorites = localStorage.getItem("kkcoder_setting_auto_rename_skip_favorites") !== "false";

      let hasIdle = false;
      for (const session of sessions) {
        if (session.deleted || session.type !== "claude") continue;
        if (skipFavorites && session.favorite) continue;
        if (renamedSinceLastInputRef.current.has(session.id)) continue;
        const lastActive = session.lastUserMessageAt
          ? new Date(session.lastUserMessageAt).getTime()
          : 0;
        if (lastActive > 0 && now - lastActive >= idleMilliseconds) {
          renamedSinceLastInputRef.current.add(session.id);
          hasIdle = true;
        }
      }

      if (hasIdle) triggerAutoRename("Idle");
    }, 60000);

    return () => window.clearInterval(interval);
  }, [sessions, triggerAutoRename]);

  const clearRenameMark = useCallback((sessionId: string) => {
    renamedSinceLastInputRef.current.delete(sessionId);
  }, []);

  return {
    triggerAutoRename,
    clearRenameMark,
  };
}
