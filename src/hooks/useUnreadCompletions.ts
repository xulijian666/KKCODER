import { useEffect, useRef, useState } from "react";
import type { Window as TauriWindow } from "@tauri-apps/api/window";
import {
  addUnreadCompletion,
  getUnreadCompletionCount,
  markSessionRead,
} from "../utils/unreadCompletions";
import { syncTaskbarUnreadBadge } from "../utils/taskbarBadge";
import { log } from "../utils/log";

export function useUnreadCompletions(
  activeSessionId: string,
  appWindow: TauriWindow,
) {
  const [glowingSessionIds, setGlowingSessionIds] = useState<string[]>([]);
  const activeSessionIdRef = useRef(activeSessionId);
  const isWindowFocusedRef = useRef(true);

  useEffect(() => {
    activeSessionIdRef.current = activeSessionId;
  }, [activeSessionId]);

  useEffect(() => {
    if (activeSessionId) {
      setGlowingSessionIds((previous) => markSessionRead(previous, activeSessionId));
    }
  }, [activeSessionId]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;

    appWindow
      .isFocused()
      .then((focused) => {
        isWindowFocusedRef.current = focused;
        if (focused && activeSessionIdRef.current) {
          setGlowingSessionIds((previous) =>
            markSessionRead(previous, activeSessionIdRef.current),
          );
        }
      })
      .catch((error) => log(`Failed to read window focus state: ${error}`));

    appWindow
      .onFocusChanged(({ payload: focused }) => {
        isWindowFocusedRef.current = focused;
        if (focused && activeSessionIdRef.current) {
          setGlowingSessionIds((previous) =>
            markSessionRead(previous, activeSessionIdRef.current),
          );
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      })
      .catch((error) => log(`Failed to register window focus listener: ${error}`));

    return () => {
      if (unlisten) unlisten();
    };
  }, [appWindow]);

  useEffect(() => {
    syncTaskbarUnreadBadge(getUnreadCompletionCount(glowingSessionIds), log);
  }, [glowingSessionIds]);

  useEffect(() => {
    return () => {
      syncTaskbarUnreadBadge(0, log);
    };
  }, []);

  const handleCommandComplete = (sessionId: string) => {
    setGlowingSessionIds((previous) =>
      addUnreadCompletion(
        previous,
        sessionId,
        activeSessionIdRef.current,
        isWindowFocusedRef.current,
      ),
    );
  };

  return {
    glowingSessionIds,
    setGlowingSessionIds,
    activeSessionIdRef,
    isWindowFocusedRef,
    handleCommandComplete,
  };
}
