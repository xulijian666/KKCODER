import React from "react";
import { copy } from "../../../lib/copy";
import { formatCompactNumber } from "../../../lib/format";
import { useTokenFormat } from "../../../hooks/useTokenFormat.js";
import { Card, Badge } from "../../components";

function normalizeBadgePart(value) {
  if (typeof value !== "string") return "";
  return value.trim();
}

function toTitleWords(value) {
  const normalized = normalizeBadgePart(value);
  if (!normalized) return "";
  return normalized
    .split(/[_\-\s]+/)
    .filter(Boolean)
    .map((token) => token.slice(0, 1).toUpperCase() + token.slice(1).toLowerCase())
    .join(" ");
}

function buildSubscriptionItems(subscriptions) {
  if (!Array.isArray(subscriptions)) return [];
  const deduped = new Map();
  for (const entry of subscriptions) {
    if (!entry || typeof entry !== "object") continue;
    const toolRaw = normalizeBadgePart(entry.tool);
    const planRaw = normalizeBadgePart(entry.planType) || normalizeBadgePart(entry.plan_type);
    if (!toolRaw || !planRaw) continue;
    const tool = toTitleWords(toolRaw) || toolRaw;
    const plan = toTitleWords(planRaw) || planRaw;
    deduped.set(`${toolRaw.toLowerCase()}::${planRaw.toLowerCase()}`, { tool, plan });
  }
  return Array.from(deduped.values());
}

export function StatsPanel({
  startDate,
  streakDays,
  subscriptions = [],
  periodConversations,
  rolling,
  topModels = [],
  className = "",
}) {
  const { formatTokensTooltip } = useTokenFormat();
  const placeholder = copy("shared.placeholder.short");
  const percentSymbol = copy("shared.unit.percent");

  const startDateValue = startDate ?? copy("identity_card.rank_placeholder");
  const streakDaysNum = Number.isFinite(Number(streakDays)) ? Number(streakDays) : 0;
  const streakValue = streakDaysNum
    ? copy("identity_card.streak_value", { days: streakDaysNum })
    : copy("identity_card.rank_placeholder");
  const subscriptionItems = buildSubscriptionItems(subscriptions);

  const compactConfig = {
    thousandSuffix: copy("shared.unit.thousand_abbrev"),
    millionSuffix: copy("shared.unit.million_abbrev"),
    billionSuffix: copy("shared.unit.billion_abbrev"),
  };
  const formatCountValue = (value) => {
    if (value == null) return placeholder;
    const formatted = formatCompactNumber(value, compactConfig);
    return formatted === "-" ? placeholder : formatted;
  };
  const rollingLabels = {
    last7d: copy("stats.period.last_7d"),
    last30d: copy("stats.period.last_30d"),
    avg: copy("stats.period.avg"),
    convs: copy("stats.period.convs"),
  };

  const displayModels = topModels.slice(0, 3);

  return (
    <Card className={`h-full ${className}`}>
        {/* Rolling Stats */}
        <div className="tt-stats-rolling-grid grid grid-cols-2 lg:grid-cols-2 xl:grid-cols-4 gap-2.5 mb-5">
          <div className="min-w-0 flex flex-col items-center justify-center p-3 bg-white/5 border border-white/5 hover:border-[var(--border-color)] rounded-xl transition-all">
            <span
              title={formatTokensTooltip(rolling?.last_7d?.totals?.billable_total_tokens)}
              className="w-full min-w-0 truncate text-center text-base font-bold font-mono text-[var(--text-primary)] tabular-nums"
            >
              {formatCountValue(rolling?.last_7d?.totals?.billable_total_tokens)}
            </span>
            <span className="w-full min-w-0 truncate text-center text-[11px] font-medium text-[var(--text-secondary)] mt-1 whitespace-nowrap">{rollingLabels.last7d}</span>
          </div>
          <div className="min-w-0 flex flex-col items-center justify-center p-3 bg-white/5 border border-white/5 hover:border-[var(--border-color)] rounded-xl transition-all">
            <span
              title={formatTokensTooltip(rolling?.last_30d?.totals?.billable_total_tokens)}
              className="w-full min-w-0 truncate text-center text-base font-bold font-mono text-[var(--text-primary)] tabular-nums"
            >
              {formatCountValue(rolling?.last_30d?.totals?.billable_total_tokens)}
            </span>
            <span className="w-full min-w-0 truncate text-center text-[11px] font-medium text-[var(--text-secondary)] mt-1 whitespace-nowrap">{rollingLabels.last30d}</span>
          </div>
          <div className="min-w-0 flex flex-col items-center justify-center p-3 bg-white/5 border border-white/5 hover:border-[var(--border-color)] rounded-xl transition-all">
            <span
              title={formatTokensTooltip(rolling?.last_30d?.avg_per_active_day)}
              className="w-full min-w-0 truncate text-center text-base font-bold font-mono text-[var(--text-primary)] tabular-nums"
            >
              {formatCountValue(rolling?.last_30d?.avg_per_active_day)}
            </span>
            <span className="w-full min-w-0 truncate text-center text-[11px] font-medium text-[var(--text-secondary)] mt-1 whitespace-nowrap">{rollingLabels.avg}</span>
          </div>
          <div className="min-w-0 flex flex-col items-center justify-center p-3 bg-white/5 border border-white/5 hover:border-[var(--border-color)] rounded-xl transition-all">
            <span className="w-full min-w-0 truncate text-center text-base font-bold font-mono text-[var(--text-primary)] tabular-nums">
              {formatCountValue(periodConversations)}
            </span>
            <span className="w-full min-w-0 truncate text-center text-[11px] font-medium text-[var(--text-secondary)] mt-1 whitespace-nowrap">{rollingLabels.convs}</span>
          </div>
        </div>

        {/* Top Models */}
        {displayModels.length > 0 && (
          <div className="mt-5 pt-4 border-t border-[var(--border-color)] flex flex-col gap-1">
            {displayModels.map((row, index) => {
              const name = row?.name ? String(row.name) : placeholder;
              const percent = row?.percent ? String(row.percent) : "";
              const isLast = index === displayModels.length - 1;
              const rankNum = index + 1;

              return (
                <div
                  key={row.id || name}
                  className={`flex items-center py-2.5 px-1 ${!isLast ? "border-b border-white/5" : ""}`}
                >
                  <span
                    className={`w-5 h-5 flex items-center justify-center rounded-md text-[11px] font-bold font-mono flex-shrink-0 ${
                      rankNum === 1
                        ? "bg-[color-mix(in_srgb,var(--color-primary)_18%,var(--bg-main))] text-[var(--color-primary)] border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] shadow-[0_0_8px_color-mix(in_srgb,var(--color-primary)_20%,transparent)]"
                        : rankNum === 2
                        ? "bg-white/10 text-[var(--text-primary)] border border-white/15"
                        : "bg-white/5 text-[var(--text-secondary)] border border-white/10"
                    }`}
                  >
                    {rankNum}
                  </span>
                  <span
                    className="flex-1 text-[13px] font-semibold font-mono text-[var(--text-primary)] truncate px-3 tracking-tight"
                    title={name}
                  >
                    {name}
                  </span>
                  <span className="text-[13px] font-bold font-mono text-[var(--text-primary)] tabular-nums flex-shrink-0">
                    {percent}{percentSymbol}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Subscriptions */}
        {subscriptionItems.length > 0 && (
          <div className="mt-4 pt-3.5 border-t border-[var(--border-color)] flex flex-wrap gap-1.5">
            {subscriptionItems.map((entry, index) => (
              <Badge
                key={`${entry.tool}:${entry.plan}:${index}`}
                variant="secondary"
                size="sm"
              >
                {entry.tool} {entry.plan}
              </Badge>
            ))}
          </div>
        )}

        {/* Footer */}
        <div className="mt-5 pt-4 border-t border-[var(--border-color)] flex items-center justify-between text-xs text-[var(--text-secondary)] font-mono">
          <div className="flex items-center gap-1.5">
            <span>{copy("identity_card.rank_label")}</span>
            <span className="text-[var(--text-primary)] font-semibold tabular-nums">{startDateValue}</span>
          </div>
          <div className="flex items-center gap-1">
            <span>{copy("identity_card.streak_label")}</span>
            <span className="text-[var(--color-primary)] font-bold tabular-nums">{streakValue}</span>
          </div>
        </div>
      </Card>
  );
}
