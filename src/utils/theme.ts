export const THEME_STORAGE_KEY = "kkcoder_setting_theme";
export const DEFAULT_THEME = "light-premium";

export type ThemeName =
  | "auto"
  | "dark-blue"
  | "dark-purple"
  | "dark-zinc"
  | "light-blue"
  | "light-orange"
  | "light-premium";

type ThemeCssVariables = Record<string, string>;

const THEME_VARIABLES: Record<Exclude<ThemeName, "auto">, ThemeCssVariables> = {
  "dark-blue": {
    "--bg-main": "#090d16",
    "--bg-sidebar": "#121620",
    "--bg-terminal": "#000000",
    "--border-color": "#1e293b",
    "--text-primary": "#f8fafc",
    "--text-secondary": "#94a3b8",
    "--color-primary": "#3b82f6",
    "--color-primary-hover": "#2563eb",
    "--color-orange": "#f97316",
    "--color-orange-light": "rgba(249, 115, 22, 0.15)",
    "--bg-active-item": "#1e293b",
    "--text-active-item": "#ffffff",
    "--bg-hover-item": "rgba(59, 130, 246, 0.15)",
    "--bg-agent-selector": "rgba(0, 0, 0, 0.25)",
    "--bg-agent-slider": "#1e293b",
    "--shadow-agent-slider": "0 2px 5px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  },
  "dark-purple": {
    "--bg-main": "#0c0a12",
    "--bg-sidebar": "#171424",
    "--bg-terminal": "#000000",
    "--border-color": "#2e2540",
    "--text-primary": "#f5f3ff",
    "--text-secondary": "#b7a8d6",
    "--color-primary": "#8b5cf6",
    "--color-primary-hover": "#7c3aed",
    "--color-orange": "#f97316",
    "--color-orange-light": "rgba(249, 115, 22, 0.15)",
    "--bg-active-item": "#2f2647",
    "--text-active-item": "#ffffff",
    "--bg-hover-item": "rgba(139, 92, 246, 0.15)",
    "--bg-agent-selector": "rgba(0, 0, 0, 0.25)",
    "--bg-agent-slider": "#2f2647",
    "--shadow-agent-slider": "0 2px 5px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  },
  "dark-zinc": {
    "--bg-main": "#0c0b0a",
    "--bg-sidebar": "#1d1b18",
    "--bg-terminal": "#000000",
    "--border-color": "#332f29",
    "--text-primary": "#fafaf9",
    "--text-secondary": "#cbd5e1",
    "--color-primary": "#d97706",
    "--color-primary-hover": "#b55c04",
    "--color-orange": "#d97706",
    "--color-orange-light": "rgba(217, 119, 6, 0.15)",
    "--bg-active-item": "#383227",
    "--text-active-item": "#ffffff",
    "--bg-hover-item": "rgba(245, 158, 11, 0.15)",
    "--bg-agent-selector": "rgba(0, 0, 0, 0.25)",
    "--bg-agent-slider": "#383227",
    "--shadow-agent-slider": "0 2px 5px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.08)",
  },
  "light-blue": {
    "--bg-main": "#ffffff",
    "--bg-sidebar": "#f0f7ff",
    "--bg-terminal": "#f8fafc",
    "--border-color": "#bae6fd",
    "--text-primary": "#0369a1",
    "--text-secondary": "#0284c7",
    "--color-primary": "#0284c7",
    "--color-primary-hover": "#0369a1",
    "--color-orange": "#f97316",
    "--color-orange-light": "#fff7ed",
    "--bg-active-item": "#e0f2fe",
    "--text-active-item": "#0369a1",
    "--bg-hover-item": "rgba(2, 132, 199, 0.08)",
    "--bg-agent-selector": "rgba(2, 132, 199, 0.06)",
    "--bg-agent-slider": "#ffffff",
    "--shadow-agent-slider": "0 2px 4px rgba(2, 132, 199, 0.1), 0 1px 2px rgba(2, 132, 199, 0.05)",
  },
  "light-orange": {
    "--bg-main": "#ffffff",
    "--bg-sidebar": "#fffcf5",
    "--bg-terminal": "#fffdfa",
    "--border-color": "#fed7aa",
    "--text-primary": "#7c2d12",
    "--text-secondary": "#ea580c",
    "--color-primary": "#c2410c",
    "--color-primary-hover": "#9a3412",
    "--color-orange": "#ea580c",
    "--color-orange-light": "#fff7ed",
    "--bg-active-item": "#ffedd5",
    "--text-active-item": "#7c2d12",
    "--bg-hover-item": "rgba(234, 88, 12, 0.08)",
    "--bg-agent-selector": "rgba(234, 88, 12, 0.05)",
    "--bg-agent-slider": "#ffffff",
    "--shadow-agent-slider": "0 2px 4px rgba(234, 88, 12, 0.08), 0 1px 2px rgba(234, 88, 12, 0.04)",
  },
  "light-premium": {
    "--bg-main": "#ffffff",
    "--bg-sidebar": "#f8fafc",
    "--bg-terminal": "#f8fafc",
    "--border-color": "#e2e8f0",
    "--text-primary": "#1e293b",
    "--text-secondary": "#64748b",
    "--color-primary": "#2563eb",
    "--color-primary-hover": "#1d4ed8",
    "--color-orange": "#f97316",
    "--color-orange-light": "#fff7ed",
    "--bg-active-item": "#dbeafe",
    "--text-active-item": "#1e40af",
    "--bg-hover-item": "rgba(59, 130, 246, 0.08)",
    "--bg-agent-selector": "rgba(15, 23, 42, 0.05)",
    "--bg-agent-slider": "#ffffff",
    "--shadow-agent-slider": "0 2px 4px rgba(0, 0, 0, 0.08), 0 1px 2px rgba(0, 0, 0, 0.04)",
  },
};

export function resolveThemeTarget(themeName: string): Exclude<ThemeName, "auto"> {
  if (themeName === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark-zinc" : "light-premium";
  }
  if (themeName in THEME_VARIABLES) {
    return themeName as Exclude<ThemeName, "auto">;
  }
  return DEFAULT_THEME;
}

/** Apply theme CSS variables to document root. */
export function applyTheme(themeName: string): void {
  const root = document.documentElement;
  const target = resolveThemeTarget(themeName);
  root.setAttribute("data-theme", target);

  const variables = THEME_VARIABLES[target];
  for (const [cssVariable, value] of Object.entries(variables)) {
    root.style.setProperty(cssVariable, value);
  }
}

export function readStoredTheme(): string {
  return localStorage.getItem(THEME_STORAGE_KEY) || DEFAULT_THEME;
}

export function persistTheme(themeName: string): void {
  localStorage.setItem(THEME_STORAGE_KEY, themeName);
}
