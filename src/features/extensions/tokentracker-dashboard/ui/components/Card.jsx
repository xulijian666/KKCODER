import React from "react";
import { cn } from "../../lib/cn";

/**
 * Card - 简化版卡片组件
 */
export function Card({
  children,
  title,
  subtitle,
  className = "",
  bodyClassName = "",
}) {
  return (
    <div className={cn("rounded-2xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] transition-all duration-200 shadow-sm", className)}>
      {(title || subtitle) && (
        <div className="px-6 py-4.5 border-b border-[var(--border-color)] transition-colors duration-200">
          {title && (
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] uppercase tracking-wide transition-colors duration-200">{title}</h3>
          )}
          {subtitle && (
            <p className="text-xs text-[var(--text-secondary)] mt-1 transition-colors duration-200">{subtitle}</p>
          )}
        </div>
      )}
      <div className={`p-6 ${bodyClassName}`}>{children}</div>
    </div>
  );
}
