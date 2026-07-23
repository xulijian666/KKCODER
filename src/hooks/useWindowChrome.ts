import { useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow, LogicalSize } from "@tauri-apps/api/window";
import { log } from "../utils/log";

export function useWindowChrome() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);
  const [rememberCloseChoice, setRememberCloseChoice] = useState(false);

  useEffect(() => {
    const savedWidth = localStorage.getItem("kkcoder_window_width");
    const savedHeight = localStorage.getItem("kkcoder_window_height");
    const width = savedWidth ? parseInt(savedWidth, 10) : 1200;
    const height = savedHeight ? parseInt(savedHeight, 10) : 800;
    const clampedWidth = Math.max(1000, width);
    const clampedHeight = Math.max(750, height);

    appWindow
      .setSize(new LogicalSize(clampedWidth, clampedHeight))
      .then(() => appWindow.center())
      .catch((error) => {
        log(`Failed to set window size and center on boot: ${error}`);
      });

    let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
    const handleWindowResize = () => {
      if (resizeTimeout) clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        const outerWidth = window.outerWidth;
        const outerHeight = window.outerHeight;
        if (outerWidth >= 1000 && outerHeight >= 750) {
          localStorage.setItem("kkcoder_window_width", String(outerWidth));
          localStorage.setItem("kkcoder_window_height", String(outerHeight));
        }
      }, 300);
    };
    window.addEventListener("resize", handleWindowResize);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      if (resizeTimeout) clearTimeout(resizeTimeout);
    };
  }, [appWindow]);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    const setupCloseListener = async () => {
      try {
        unlisten = await appWindow.onCloseRequested(async (event) => {
          event.preventDefault();
          const behavior = localStorage.getItem("kkcoder_setting_close_behavior") || "exit";
          log(`onCloseRequested event captured. Current behavior: ${behavior}`);
          if (behavior === "exit") {
            appWindow.destroy().catch((error) => log(`Failed to destroy window: ${error}`));
          } else if (behavior === "minimize") {
            appWindow.hide().catch((error) => log(`Failed to hide window: ${error}`));
          } else {
            setShowCloseConfirmModal(true);
          }
        });
        log("Window close requested listener registered successfully.");
      } catch (error) {
        log(`Failed to register onCloseRequested: ${error}`);
      }
    };
    setupCloseListener();
    return () => {
      if (unlisten) unlisten();
    };
  }, [appWindow]);

  useEffect(() => {
    const handleGlobalContextMenu = (event: MouseEvent) => {
      event.preventDefault();
    };
    window.addEventListener("contextmenu", handleGlobalContextMenu);
    return () => window.removeEventListener("contextmenu", handleGlobalContextMenu);
  }, []);

  const handleMinimize = () => {
    appWindow.minimize().catch((error) => log(`Failed to minimize: ${error}`));
  };
  const handleMaximize = () => {
    appWindow.toggleMaximize().catch((error) => log(`Failed to toggle maximize: ${error}`));
  };
  const handleClose = () => {
    appWindow.close().catch((error) => log(`Failed to close window: ${error}`));
  };
  const handleTitlebarMouseDown = (event: ReactMouseEvent) => {
    if (event.button !== 0) return;
    if (event.detail === 2) {
      appWindow.toggleMaximize().catch((error) => log(`Failed to toggle maximize: ${error}`));
    } else {
      appWindow.startDragging().catch((error) => log(`Failed to start window dragging: ${error}`));
    }
  };

  return {
    appWindow,
    showCloseConfirmModal,
    setShowCloseConfirmModal,
    rememberCloseChoice,
    setRememberCloseChoice,
    handleMinimize,
    handleMaximize,
    handleClose,
    handleTitlebarMouseDown,
  };
}
