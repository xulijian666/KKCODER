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
    "inline-flex items-center justify-center font-medium transition-all duration-200 rounded-md focus:outline-none focus:ring-2 focus:ring-oai-blue/30 active:scale-[0.98] active:duration-100";

  const variantStyles = {
    primary:
      "bg-[var(--color-primary)] text-white border border-[var(--color-primary)] hover:opacity-90 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all font-semibold",
    secondary:
      "bg-[var(--bg-active-item)] text-[var(--text-primary)] border border-[var(--border-color)] hover:bg-[var(--bg-hover-item)] hover:border-[color-mix(in_srgb,var(--color-primary)_35%,var(--border-color))] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all",
    ghost:
      "bg-transparent text-[var(--text-secondary)] border border-transparent hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover-item)] active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none transition-all",
  };

  const sizeStyles = {
    sm: "h-8 px-3 text-sm",
    md: "h-10 px-4 text-sm",
    lg: "h-12 px-6 text-base",
  };

  const disabledStyles = disabled
    ? "cursor-not-allowed opacity-60"
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
