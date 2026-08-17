import React from "react";
import { Select as BaseSelect } from "@base-ui/react/select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/cn";

// Shared rounded dropdown built on @base-ui/react Select. Replaces native
// HTML <select> elements so the open list matches the app's design (rounded
// corners, shadow, hover states) on every platform — a native select popup is
// OS-rendered and can't be styled. The popup uses base-ui's default portal,
// which renders it above the page so it escapes ancestor `overflow` clipping.

const TRIGGER_BASE =
  "relative inline-flex items-center justify-between gap-2 rounded-lg border " +
  "border-[var(--border-color)] bg-[var(--bg-active-item)] text-[var(--text-primary)] transition-colors " +
  "hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] focus:outline-none focus-visible:ring-1 " +
  "focus-visible:ring-[var(--color-primary)]";

/**
 * @param {object} props
 * @param {*} props.value - currently selected value
 * @param {(value:*) => void} props.onValueChange
 * @param {Array<{value:*, label:React.ReactNode, disabled?:boolean}>} props.options
 * @param {string} [props.ariaLabel]
 * @param {string} [props.id] - id for the trigger button (lets a `<label htmlFor>` associate)
 * @param {boolean} [props.disabled]
 * @param {React.ReactNode} [props.leadingIcon] - icon rendered before the value
 * @param {string} [props.className] - extra classes for the trigger button
 * @param {string} [props.popupClassName] - extra classes for the popup
 * @param {"start"|"center"|"end"} [props.align]
 * @param {boolean} [props.matchTriggerWidth] - size the popup to the trigger
 */
export function Select({
  value,
  onValueChange,
  options = [],
  ariaLabel,
  id,
  disabled = false,
  leadingIcon = null,
  className = "",
  popupClassName = "",
  align = "start",
  matchTriggerWidth = false,
}) {
  const items = options.map((opt) => ({ value: opt.value, label: opt.label }));

  return (
    <BaseSelect.Root
      value={value}
      items={items}
      disabled={disabled}
      onValueChange={(next) => {
        if (!disabled && next != null) onValueChange?.(next);
      }}
    >
      <BaseSelect.Trigger
        id={id}
        aria-label={ariaLabel}
        className={cn(
          TRIGGER_BASE,
          disabled &&
            "cursor-not-allowed opacity-50 hover:border-[var(--border-color)]",
          className,
        )}
      >
        <span className="flex min-w-0 items-center gap-2 font-mono">
          {leadingIcon}
          <BaseSelect.Value className="truncate" />
        </span>
        <ChevronDown
          className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)] opacity-70"
          aria-hidden
        />
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner
          align={align}
          side="bottom"
          sideOffset={4}
          className="z-50"
        >
          <BaseSelect.Popup
            className={cn(
              "max-h-[min(18rem,var(--available-height))] origin-[var(--transform-origin)] overflow-y-auto",
              "rounded-xl border border-[var(--border-color)] bg-[var(--bg-sidebar)] p-1 shadow-2xl ring-1 ring-black/20",
              "transition-[opacity,transform] duration-150 ease-out",
              "data-[starting-style]:scale-95 data-[starting-style]:opacity-0",
              "data-[ending-style]:scale-95 data-[ending-style]:opacity-0",
              matchTriggerWidth && "min-w-[var(--anchor-width)]",
              popupClassName,
            )}
          >
            <BaseSelect.List role="listbox" aria-label={ariaLabel}>
              {options.map((opt) => (
                <BaseSelect.Item
                  key={String(opt.value)}
                  value={opt.value}
                  disabled={opt.disabled}
                  className={({ selected, disabled: itemDisabled }) =>
                    cn(
                      "flex w-full cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg py-1.5 pl-1.5 pr-6 font-mono",
                      "text-left text-xs outline-none transition-colors",
                      selected
                        ? "bg-[color-mix(in_srgb,var(--color-primary)_18%,var(--bg-sidebar))] text-[var(--color-primary)] font-semibold"
                        : "text-[var(--text-secondary)] hover:bg-[var(--bg-hover-item)] hover:text-[var(--text-primary)]",
                      itemDisabled &&
                        "cursor-not-allowed opacity-40 hover:bg-transparent",
                    )
                  }
                >
                  <span className="flex w-3.5 shrink-0 items-center justify-center text-[var(--color-primary)]">
                    <BaseSelect.ItemIndicator>
                      <Check className="h-3 w-3" aria-hidden />
                    </BaseSelect.ItemIndicator>
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <BaseSelect.ItemText>{opt.label}</BaseSelect.ItemText>
                  </span>
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
