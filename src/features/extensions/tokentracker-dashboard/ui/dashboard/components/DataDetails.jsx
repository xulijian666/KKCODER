import React, { useState } from "react";
import { Card, Select } from "../../components";
import { toFiniteNumber } from "../../../lib/format";
import { useTokenFormat } from "../../../hooks/useTokenFormat.js";
import { ProviderIcon } from "./ProviderIcon";
import { ProjectDetailModal } from "./ProjectDetailModal.jsx";
import {
  ProjectAvatar,
  githubOwnerFor,
  splitProjectKey,
} from "./project-usage-utils.jsx";

const PROJECT_SOURCE_ICON_LIMIT = 5;

function ProjectRow({ entry, maxTokens, copy, formatTokens, formatTokensTooltip, onSelect }) {
  const projectKey = typeof entry?.project_key === "string" ? entry.project_key : "";
  const projectRef = typeof entry?.project_ref === "string" ? entry.project_ref : "";
  const { owner, repo } = splitProjectKey(projectKey);
  const githubOwner = githubOwnerFor(projectRef, owner);
  const tokensRaw = toFiniteNumber(entry?.billable_total_tokens ?? entry?.total_tokens) ?? 0;
  const widthPct = maxTokens > 0 ? Math.min(100, Math.max(2, (tokensRaw / maxTokens) * 100)) : 0;
  const sources = Array.isArray(entry?.sources) ? entry.sources : [];
  const visibleSources = sources.slice(0, PROJECT_SOURCE_ICON_LIMIT);
  const overflowCount = sources.length - visibleSources.length;

  return (
    <button
      type="button"
      onClick={() => onSelect?.(entry)}
      className="tt-project-row group"
    >
      <ProjectAvatar
        githubOwner={githubOwner}
        letter={(repo?.[0] || projectKey?.[0] || "?").toUpperCase()}
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline min-w-0 gap-1">
          {owner ? (
            <span className="text-xs font-mono text-[var(--text-secondary)] truncate flex-shrink-[2]">
              {owner}/
            </span>
          ) : null}
          <span className="text-[13px] font-semibold font-mono text-[var(--text-primary)] truncate group-hover:text-[var(--color-primary)] transition-colors">
            {repo || projectKey || "—"}
          </span>
        </div>
        {visibleSources.length > 0 && (
          <div className="mt-1 flex items-center gap-1.5">
            {visibleSources.map((s) => (
              <ProviderIcon
                key={s.source}
                provider={s.source}
                size={12}
                className="text-[var(--text-secondary)] group-hover:text-[var(--text-primary)] transition-colors"
              />
            ))}
            {overflowCount > 0 && (
              <span className="text-[10px] font-mono text-[var(--text-secondary)] bg-white/5 px-1 rounded border border-white/10">
                {copy("dashboard.projects.sources_more", { n: overflowCount })}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="flex w-24 sm:w-28 flex-shrink-0 flex-col items-end gap-1.5">
        <span
          className="text-xs font-bold font-mono text-[var(--text-primary)] tabular-nums"
          title={formatTokensTooltip(tokensRaw)}
        >
          {formatTokens(tokensRaw)}
        </span>
        <div className="tt-project-progress-track">
          <div
            className="tt-project-progress-bar"
            style={{ width: `${widthPct}%`, minWidth: tokensRaw > 0 ? "4px" : 0 }}
          />
        </div>
      </div>
    </button>
  );
}

export function DataDetails({
  // Project props
  projectEntries = [],
  projectLimit = 3,
  onProjectLimitChange,
  // { from, to, timeZone, tzOffsetMinutes } — forwarded to the per-project
  // drill-down modal so it queries the same range the panel shows.
  projectDetailQuery = {},
  // Daily breakdown props
  copy,
  hasDetailsActual,
  dailyEmptyPrefix,
  installSyncCmd,
  dailyEmptySuffix,
  detailsColumns,
  ariaSortFor,
  toggleSort,
  sortIconFor,
  pagedDetails,
  dailyBreakdownRows = [],
  dailyBreakdownColumns = [],
  dailyBreakdownAriaSortFor,
  dailyBreakdownSortIconFor,
  dailyBreakdownDateKey = "day",
  detailsDateKey,
  renderDetailDate,
  renderDailyBreakdownDate,
  renderDetailCell,
  DETAILS_PAGED_PERIODS,
  period,
  detailsPageCount,
  detailsPage,
  setDetailsPage,
}) {
  const [activeTab, setActiveTab] = useState("projects");
  const [detailEntry, setDetailEntry] = useState(null);
  const { formatTokens, formatTokensTooltip } = useTokenFormat();

  return (
    <Card>
      {/* Tab Switcher + Controls */}
      <div className="flex items-center justify-between gap-3 mb-4">
        <div role="tablist" aria-label="Data view" className="flex items-center p-1 rounded-xl border border-[var(--border-color)] bg-[var(--bg-active-item)] text-xs font-mono select-none">
          <button
            role="tab"
            aria-selected={activeTab === "daily"}
            type="button"
            onClick={() => setActiveTab("daily")}
            className={`px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer select-none ${
              activeTab === "daily"
                ? "bg-[color-mix(in_srgb,var(--color-primary)_18%,var(--bg-sidebar))] text-[var(--color-primary)] border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] shadow-[0_0_8px_color-mix(in_srgb,var(--color-primary)_15%,transparent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 border border-transparent"
            }`}
          >
            {copy("dashboard.daily.title")}
          </button>
          <button
            role="tab"
            aria-selected={activeTab === "projects"}
            type="button"
            onClick={() => setActiveTab("projects")}
            className={`px-3 py-1.5 rounded-lg transition-all font-semibold cursor-pointer select-none ${
              activeTab === "projects"
                ? "bg-[color-mix(in_srgb,var(--color-primary)_18%,var(--bg-sidebar))] text-[var(--color-primary)] border border-[color-mix(in_srgb,var(--color-primary)_40%,transparent)] shadow-[0_0_8px_color-mix(in_srgb,var(--color-primary)_15%,transparent)]"
                : "text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-white/5 border border-transparent"
            }`}
          >
            {copy("dashboard.projects.title")}
          </button>
        </div>
        {activeTab === "projects" && (
          <Select
            ariaLabel={copy("dashboard.projects.limit_aria")}
            value={projectLimit}
            onValueChange={(value) => onProjectLimitChange?.(Number(value))}
            options={[
              { value: 3, label: copy("dashboard.projects.limit_top_3") },
              { value: 6, label: copy("dashboard.projects.limit_top_6") },
              { value: 10, label: copy("dashboard.projects.limit_top_10") },
            ]}
            align="end"
            className="h-8 px-3 text-xs font-mono font-medium rounded-lg border border-[var(--border-color)] bg-[var(--bg-active-item)] text-[var(--text-primary)] hover:border-[var(--color-primary)] hover:text-[var(--color-primary)] transition-colors duration-200"
          />
        )}
      </div>

      {/* Projects Tab */}
      {activeTab === "projects" && (() => {
        const visibleEntries = projectEntries.slice(0, projectLimit);
        if (visibleEntries.length === 0) {
          return (
            <div className="text-xs font-mono text-[var(--text-secondary)] py-6 text-center">
              {copy("dashboard.projects.empty")}
            </div>
          );
        }
        const maxTokens = visibleEntries.reduce((max, entry) => {
          const n = toFiniteNumber(entry?.billable_total_tokens ?? entry?.total_tokens) ?? 0;
          return n > max ? n : max;
        }, 0);
        return (
          <div className="space-y-2">
            {visibleEntries.map((entry, idx) => (
              <ProjectRow
                key={entry?.project_key || entry?.project_ref || `entry-${idx}`}
                entry={entry}
                maxTokens={maxTokens}
                copy={copy}
                formatTokens={formatTokens}
                formatTokensTooltip={formatTokensTooltip}
                onSelect={setDetailEntry}
              />
            ))}
          </div>
        );
      })()}

      {detailEntry && (
        <ProjectDetailModal
          entry={detailEntry}
          query={projectDetailQuery}
          onClose={() => setDetailEntry(null)}
        />
      )}

      {/* Daily Tab */}
      {activeTab === "daily" && (
        <div>
          {dailyBreakdownRows?.length === 0 ? (
            <div className="text-xs font-mono text-[var(--text-secondary)] py-4 mb-2">
              {dailyEmptyPrefix}
              <code className="mx-1 rounded border border-[var(--border-color)] bg-white/5 px-1.5 py-0.5 font-mono text-xs text-[var(--color-primary)]">
                {installSyncCmd}
              </code>
              {dailyEmptySuffix}
            </div>
          ) : (
          <div className="overflow-auto max-h-[384px] -mx-4 oai-scrollbar">
            <table className="w-full border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--bg-sidebar)]">
                <tr className="border-b border-[var(--border-color)]">
                  {dailyBreakdownColumns.map((column) => (
                    <th
                      key={column.key}
                      aria-sort={dailyBreakdownAriaSortFor?.(column.key) || "none"}
                      className="text-left p-0 bg-[var(--bg-sidebar)]"
                    >
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="flex w-full items-center justify-start px-3 py-2 text-left text-xs font-mono font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
                      >
                        <span className="inline-flex items-center gap-1">
                          <span>{column.label}</span>
                          <span className="text-[var(--text-secondary)]">
                            {dailyBreakdownSortIconFor?.(column.key) || ""}
                          </span>
                        </span>
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {dailyBreakdownRows.map((row) => (
                  <tr
                    key={String(
                      row?.[dailyBreakdownDateKey] || row?.day || row?.hour || row?.month || "",
                    )}
                    className={`border-b border-[var(--border-color)]/30 last:border-b-0 hover:bg-[var(--bg-hover-item)] transition-colors ${
                      row.missing ? "text-[var(--text-secondary)] opacity-60" : row.future ? "text-[var(--text-secondary)] opacity-40" : "text-[var(--text-primary)]"
                    }`}
                  >
                    <td className="px-3 py-2.5 text-xs font-mono text-[var(--text-secondary)] whitespace-nowrap">
                      {renderDailyBreakdownDate ? renderDailyBreakdownDate(row) : renderDetailDate(row)}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono font-bold text-[var(--text-primary)] tabular-nums">
                      {renderDetailCell(row, "total_tokens")}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                      {renderDetailCell(row, "input_tokens")}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                      {renderDetailCell(row, "output_tokens")}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                      {renderDetailCell(row, "cached_input_tokens")}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                      {renderDetailCell(row, "reasoning_output_tokens")}
                    </td>
                    <td className="px-3 py-2.5 text-xs font-mono text-[var(--text-secondary)] tabular-nums">
                      {renderDetailCell(row, "conversation_count")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          )}

          {/* Pagination - 使用 design system typography，Daily Breakdown 不需要分页 */}
          {activeTab !== "daily" && DETAILS_PAGED_PERIODS?.has?.(period) && detailsPageCount > 1 ? (
            <div className="mt-3 flex items-center justify-between text-xs font-mono">
              <button
                type="button"
                onClick={() => setDetailsPage((prev) => Math.max(0, prev - 1))}
                disabled={detailsPage === 0}
                className="px-3 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover-item)] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {copy("details.pagination.prev")}
              </button>
              <span className="text-[var(--text-secondary)]">
                {detailsPage + 1} / {detailsPageCount}
              </span>
              <button
                type="button"
                onClick={() => setDetailsPage((prev) => Math.min(detailsPageCount - 1, prev + 1))}
                disabled={detailsPage + 1 >= detailsPageCount}
                className="px-3 py-1.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-hover-item)] rounded-lg disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
              >
                {copy("details.pagination.next")}
              </button>
            </div>
          ) : null}
        </div>
      )}
    </Card>
  );
}
