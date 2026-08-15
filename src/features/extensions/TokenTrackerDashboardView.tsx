// Vendored TokenTracker dashboard 懒加载入口（移植自 CC-GUI）。
// 整个 vendored 树（含 motion / @base-ui 等重依赖）只经由此模块被动态
// import，保证它们全部落在异步 chunk 里；provider 顺序固定
// （TokenFormatProvider 依赖 LocaleProvider 的 resolvedLocale），不要随意调整。
import { useState } from "react";
import { DashboardPage } from "./tokentracker-dashboard/pages/DashboardPage.jsx";
import { CurrencyProvider } from "./tokentracker-dashboard/ui/foundation/CurrencyProvider.jsx";
import { LocaleProvider } from "./tokentracker-dashboard/ui/foundation/LocaleProvider.jsx";
import { ThemeProvider } from "./tokentracker-dashboard/ui/foundation/ThemeProvider.jsx";
import { TokenFormatProvider } from "./tokentracker-dashboard/ui/foundation/TokenFormatProvider.jsx";
import { THEME_DEFINITIONS, readStoredTheme } from "../../utils/theme";

/**
 * 把 KKCoder 当前主题同步给仪表盘（vendored ThemeProvider 从
 * localStorage["tokentracker-theme"] 初始化）：KKCoder 深色主题 → 仪表盘 dark。
 * 面板每次打开都会重新挂载本组件，因此每次打开都会重新同步。
 */
function syncDashboardTheme(): void {
  try {
    const stored = readStoredTheme();
    const definition = THEME_DEFINITIONS.find((d) => d.id === stored);
    if (definition && definition.group !== "system") {
      localStorage.setItem("tokentracker-theme", definition.group);
    }
  } catch {
    // localStorage 不可用时保持仪表盘默认（跟随系统）
  }
}

export default function TokenTrackerDashboardView() {
  const currentTheme = readStoredTheme();
  const isLight = currentTheme === "light-premium" || currentTheme === "light-orange";
  const isDark = !isLight;

  useState(() => {
    syncDashboardTheme();
    try {
      localStorage.setItem("tokentracker-theme", isDark ? "dark" : "light");
    } catch {}
  });

  return (
    <div className={`tt-dashboard ${isDark ? "dark" : ""}`}>
      <LocaleProvider>
        <CurrencyProvider>
          <TokenFormatProvider>
            <ThemeProvider>
              {/* baseUrl 在 Tauri 模式无意义（传输走 tt_proxy）；onMainContentVisible 为宿主通知钩子 */}
              <DashboardPage baseUrl="" onMainContentVisible={() => {}} />
            </ThemeProvider>
          </TokenFormatProvider>
        </CurrencyProvider>
      </LocaleProvider>
    </div>
  );
}
