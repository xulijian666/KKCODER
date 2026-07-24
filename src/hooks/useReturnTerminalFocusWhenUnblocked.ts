import { useEffect, useRef } from "react";
import { requestActiveTerminalFocus } from "../utils/terminalFocus";

/**
 * 当「焦点阻断」从 true 变为 false 时，把键盘归还给活动终端。
 * 用于弹窗、确认框、队列面板、右键菜单等叠加层。
 */
export function useReturnTerminalFocusWhenUnblocked(
  isFocusBlocked: boolean,
  delayMs = 56,
): void {
  const wasBlockedRef = useRef(isFocusBlocked);

  useEffect(() => {
    const wasBlocked = wasBlockedRef.current;
    wasBlockedRef.current = isFocusBlocked;

    if (wasBlocked && !isFocusBlocked) {
      requestActiveTerminalFocus({ delayMs });
    }
  }, [isFocusBlocked, delayMs]);
}
