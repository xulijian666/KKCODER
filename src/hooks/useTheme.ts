import { useCallback, useEffect, useState } from "react";
import {
  applyTheme,
  persistTheme,
  readStoredTheme,
  THEME_STORAGE_KEY,
} from "../utils/theme";

const THEME_CHANGE_EVENT = "kkcoder-theme-change";

export function useTheme() {
  const [currentTheme, setCurrentTheme] = useState<string>(() => readStoredTheme());
  const [showThemeDropdown, setShowThemeDropdown] = useState(false);

  useEffect(() => {
    applyTheme(currentTheme);
  }, [currentTheme]);

  useEffect(() => {
    const handleThemeEvent = (event: Event) => {
      const customEvent = event as CustomEvent<string>;
      setCurrentTheme(customEvent.detail);
    };
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeEvent);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, handleThemeEvent);
  }, []);

  useEffect(() => {
    const closeThemeMenu = () => setShowThemeDropdown(false);
    window.addEventListener("mousedown", closeThemeMenu);
    return () => window.removeEventListener("mousedown", closeThemeMenu);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowThemeDropdown(false);
      }
    };
    if (showThemeDropdown) {
      window.addEventListener("keydown", handleKeyDown, true);
    }
    return () => {
      window.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [showThemeDropdown]);

  const selectTheme = useCallback((nextTheme: string) => {
    setCurrentTheme(nextTheme);
    persistTheme(nextTheme);
    applyTheme(nextTheme);
    window.dispatchEvent(new CustomEvent(THEME_CHANGE_EVENT, { detail: nextTheme }));
  }, []);

  return {
    currentTheme,
    showThemeDropdown,
    setShowThemeDropdown,
    selectTheme,
    themeStorageKey: THEME_STORAGE_KEY,
  };
}
