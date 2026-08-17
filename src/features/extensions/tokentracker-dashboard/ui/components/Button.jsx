import React from "react";

/**
 * Button - OpenAI 风格的按钮组件
 *
 * @param {Object} props
 * @param {React.ReactNode} props.children - 按钮内容
 * @param {'primary'|'secondary'|'ghost'} [props.variant='primary'] - 按钮变体
 * @param {'sm'|'md'|'lg'} [props.size='md'] - 按钮尺寸
 * @param {function} [props.onClick] - 点击事件处理函数
 * @param {boolean} [props.disabled=false] - 是否禁用
 * @param {string} [props.className] - 额外的 CSS 类名
 * @param {React.ElementType} [props.as] - 渲染的元素类型
 */
export function Button({
  children,
  variant = "primary",
  size = "md",
  onClick,
  disabled = false,
  className = "",
  as: Component = "button",
  ...props
}) {
  const baseStyles =
    "inline-flex items-center justify-center font-mono transition-all duration-150 rounded-lg focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--color-primary)] active:scale-[0.98] select-none";

  const variantStyles = {
    primary:
      "bg-[var(--color-primary)] text-white border border-[var(--color-primary)] hover:brightness-110 active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none shadow-[0_2px_8px_color-mix(in_srgb,var(--color-primary)_35%,transparent)] font-semibold",
    secondary:
      "bg-[var(--bg-active-item)] text-[var(--text-secondary)] border border-[var(--border-color)] hover:bg-[var(--bg-hover-item)] hover:text-[var(--text-primary)] hover:border-[color-mix(in_srgb,var(--color-primary)_35%,var(--border-color))] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none font-medium",
    ghost:
      "bg-transparent text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover-item)] active:scale-[0.98] disabled:opacity-40 disabled:pointer-events-none font-medium",
  };

  const sizeStyles = {
    sm: "h-7.5 px-3 text-xs",
    md: "h-9 px-4 text-xs font-medium",
    lg: "h-10 px-5 text-sm font-medium",
  };

  const disabledStyles = disabled
    ? "cursor-not-allowed opacity-50"
    : "cursor-pointer";

  const mergedClassName = `${baseStyles} ${variantStyles[variant]} ${sizeStyles[size]} ${disabledStyles} ${className}`;

  return (
    <Component
      className={mergedClassName}
      onClick={onClick}
      disabled={disabled}
      {...props}
    >
      {children}
    </Component>
  );
}
