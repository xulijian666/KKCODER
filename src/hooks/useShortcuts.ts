import { useEffect, useState } from "react";

export interface ShortcutItem {
  title: string;
  content: string;
}

const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  { title: "继续", content: "继续完成" },
  { title: "", content: "" },
  { title: "", content: "" },
];

function readShortcutsList(): ShortcutItem[] {
  const listValue = localStorage.getItem("kkcoder_shortcuts_list");
  if (!listValue) return DEFAULT_SHORTCUTS;
  try {
    const parsed = JSON.parse(listValue);
    if (!Array.isArray(parsed)) return DEFAULT_SHORTCUTS;
    const list = [...parsed];
    while (list.length < 3) list.push({ title: "", content: "" });
    return list.slice(0, 3);
  } catch {
    return DEFAULT_SHORTCUTS;
  }
}

export function useShortcuts() {
  const [shortcutsEnabled, setShortcutsEnabled] = useState<boolean>(() => {
    const value = localStorage.getItem("kkcoder_shortcuts_enabled");
    return value === null ? false : value === "true";
  });
  const [shortcutsList, setShortcutsList] = useState<ShortcutItem[]>(() => readShortcutsList());

  useEffect(() => {
    const handleShortcutsChange = () => {
      const enabledValue = localStorage.getItem("kkcoder_shortcuts_enabled");
      setShortcutsEnabled(enabledValue === null ? false : enabledValue === "true");
      setShortcutsList(readShortcutsList());
    };
    window.addEventListener("kkcoder-shortcuts-change", handleShortcutsChange);
    return () => window.removeEventListener("kkcoder-shortcuts-change", handleShortcutsChange);
  }, []);

  return {
    shortcutsEnabled,
    shortcutsList,
  };
}
