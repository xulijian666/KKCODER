import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowUpCircle,
  Ban,
  Check,
  Download,
  ExternalLink,
  Flame,
  FolderSearch,
  Languages,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Undo2,
  X,
} from "lucide-react";
import { ConfirmModal } from "../../components/ConfirmModal";
import { formatFeedbackError, notifyError, notifyInfo, notifySuccess } from "../../utils/appFeedback";
import {
  addSkillRepo,
  checkSkillUpdates,
  deleteDiscoverySkill,
  deleteLocalSkill,
  discoverSkills,
  getInstalledSkills,
  getPopularSkills,
  getSkillDiscoveries,
  getSkillRepos,
  getSkillUsage,
  importSkillFromPath,
  installSkill,
  removeSkillRepo,
  searchSkills,
  setSkillEnabled,
  uninstallSkill,
} from "./tokentracker-dashboard/lib/skills-api";
import "./SkillsCenter.css";

/**
 * 技能中心（KKCoder 原生 UI，替代 vendored SkillsPage）。
 * 简洁模型：我的技能 = 已启用列表（一行一开关）；浏览 = 仓库/热门/skills.sh/
 * 本地发现（未启用来源 + 停用区）；详情抽屉（使用统计/启用开关/移除/屏蔽）。
 * 安全底线：KKCoder 只创建/删除自己的副本，源技能文件永不删除。
 */

interface SkillTarget {
  id: string;
  label: string;
  path: string;
}

interface Skill {
  id?: string;
  key?: string;
  name?: string;
  directory: string;
  sourceDirectory?: string;
  description?: string;
  /** SKILL.md 正文（完整介绍），详情页展示与全文汉化用 */
  fullDescription?: string;
  repoOwner?: string;
  repoName?: string;
  repoBranch?: string;
  readmeUrl?: string;
  managed?: boolean;
  /** 原生技能：直接放在 agent 目录里的用户源技能 */
  native?: boolean;
  /** 已停用（本地发现列表用）：停用区恢复项 / 已停用托管技能 */
  disabled?: boolean;
  /** 停用区条目名（恢复时移回原目录） */
  disabledDest?: string;
  /** 发现来源标签（本地发现列表用） */
  sourceLabel?: string;
  targets?: string[];
  targetStates?: Record<string, "synced" | "off" | "orphan">;
  /** 未托管技能：命中该状态的代理目录实际路径（如 ~/.claude/skills/xxx） */
  targetPaths?: Record<string, string>;
  installs?: number;
}

interface SkillUsageEntry {
  skill?: string;
  directory?: string;
  installed?: boolean;
  invocations?: number;
  lastUsedAt?: string;
  cost?: number;
}

/** 技能汉化状态：directory → 翻译（stale=true 表示无翻译或技能已更新，汉化失效） */
interface SkillTranslationStatus {
  directory: string;
  descriptionZh: string;
  stale: boolean;
  /** 完整介绍（SKILL.md 正文）汉化 */
  descriptionFullZh: string;
  staleFull: boolean;
}

/** 黑名单记录：屏蔽的技能（不再被扫描引用，源文件保留） */
interface SkillBlacklistEntry {
  directory: string;
  sourcePath: string;
  createdAt: number;
}

/** 提取第一句：中文句号/问号/叹号直接结束；其次换行；英文句点须后跟空格或结尾（避免 e.g. 误截） */
function firstSentence(text: string): string {
  const trimmed = (text || "").trim();
  if (!trimmed) return trimmed;
  // 中文句子结束符：句号后直接接下一句，无空格要求
  const zhMatch = trimmed.match(/^.*?[。！？]/);
  if (zhMatch) return zhMatch[0].trim();
  // 换行
  const newlineIdx = trimmed.search(/\n/);
  if (newlineIdx > 0) return trimmed.slice(0, newlineIdx).trim();
  // 英文句点：后跟空格或结尾才视为句子结束
  const dotIdx = trimmed.search(/\.(?=\s|$)/);
  if (dotIdx > 0) return trimmed.slice(0, dotIdx + 1).trim();
  // 英文 ! ? 直接结束
  const enEndIdx = trimmed.search(/[!?]/);
  if (enEndIdx > 0) return trimmed.slice(0, enEndIdx + 1).trim();
  return trimmed;
}

const SHOW_ZH_STORAGE_KEY = "kkcoder_skill_show_zh";

/** 扫描来源：内置代理目录（可勾选）+ 自定义目录（可增删） */
interface SkillScanSource {
  id: string;
  name: string;
  path: string;
  kind: "builtin" | "custom";
  enabled?: boolean;
}

/** 默认安装目标：KKCoder 面向 Claude Code，仅同步到 Claude。 */
const DEFAULT_TARGETS = ["claude"];
/**
 * 当前启用的同步代理（前端过滤，配合后端 targetList）。
 * 后续需要支持其它代理（codex/grok/gemini 等）时，把 id 加进数组即可。
 */
const ENABLED_TARGETS = ["claude"];
const SOURCE_ALL = "all";
const SOURCE_POPULAR = "popular";
const SOURCE_SKILLSSH = "skillssh";

const AGENT_DOT_TONE: Record<string, string> = {
  claude: "var(--color-orange)",
  codex: "#10b981",
  grok: "#a1a1aa",
  antigravity: "#8b5cf6",
  gemini: "#38bdf8",
  opencode: "#f59e0b",
  hermes: "#818cf8",
  agents: "#34d399",
};

function getSkillKey(skill: Skill): string {
  return `${skill.repoOwner || "local"}/${skill.repoName || "local"}:${skill.directory}`;
}

function installBusyKey(skill: Skill): string {
  return `install:${getSkillKey(skill)}`;
}

function removeBusyKey(skill: Skill): string {
  return `remove:${skill.id || skill.directory}`;
}

function blacklistBusyKey(skill: Skill): string {
  return `blacklist:${skill.id || skill.directory}`;
}

function directoryLeaf(value: string | undefined): string {
  const directory = String(value || "").replace(/\\/g, "/").trim().toLowerCase();
  return directory.split("/").filter(Boolean).pop() || "";
}

function browseDirectoryFallbackKey(skill: Skill): string {
  const leaf = directoryLeaf(skill.directory);
  return leaf ? `dir:${leaf}` : "";
}

function installedSkillKeys(skill: Skill): Set<string> {
  const keys = new Set<string>([getSkillKey(skill).toLowerCase()]);
  if (skill.repoOwner && skill.repoName) {
    keys.add(
      `${skill.repoOwner}/${skill.repoName}:${skill.sourceDirectory || skill.directory}`.toLowerCase(),
    );
  }
  if (skill.directory && !skill.directory.includes("/")) {
    keys.add(`dir:${skill.directory.toLowerCase()}`);
  }
  return keys;
}

/* ============================ 我的技能（一行一开关，纯列表） ============================ */

function MySkillsView({
  items,
  selectedId,
  onSelect,
  onToggleEnabled,
  busyKey,
  updates,
  anyFilter,
  onBrowse,
  getSummary,
}: {
  items: Skill[];
  selectedId: string | null;
  onSelect: (skill: Skill) => void;
  /** 开关：启用 = 同步到 Claude；停用 = 只移除副本（源技能保留） */
  onToggleEnabled: (skill: Skill, enabled: boolean) => void;
  busyKey: string;
  updates: Record<string, boolean>;
  anyFilter: boolean;
  onBrowse: () => void;
  /** 列表一句话简介（汉化/原版第一句） */
  getSummary: (skill: Skill) => string;
}) {
  return (
    <div className="skc-my">
      {items.length === 0 ? (
        <div className="skc-empty">
          <p>{anyFilter ? "没有匹配的技能" : "还没有启用任何技能"}</p>
          {!anyFilter && (
            <button type="button" className="skc-btn skc-btn-primary" onClick={onBrowse}>
              去浏览技能
            </button>
          )}
        </div>
      ) : (
        <div className="skc-list">
          {items.map((skill) => {
            const selected = selectedId === (skill.id || skill.directory);
            const hasUpdate = Boolean(skill.id && updates[skill.id]);
            const sourceLabel =
              skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : null;
            const enabled = skill.targetStates?.claude === "synced";
            const orphan = skill.targetStates?.claude === "orphan";
            const busy = busyKey === `enable:${skill.id || skill.directory}`;
            return (
              <div
                key={skill.id || skill.key || skill.directory}
                role="button"
                tabIndex={0}
                className={`skc-skill-row${selected ? " is-selected" : ""}`}
                onClick={() => onSelect(skill)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(skill);
                  }
                }}
                title={
                  `${skill.name || skill.directory}${sourceLabel ? ` · ${sourceLabel}` : ""}` +
                  (skill.description ? `\n\n${skill.description}` : "")
                }
              >
                <div className="skc-row-main">
                  <div className="skc-row-title">
                    <span className="skc-row-name">{skill.name || skill.directory}</span>
                    {hasUpdate && (
                      <span className="skc-badge-update">
                        <ArrowUpCircle size={10} />
                        可更新
                      </span>
                    )}
                    {orphan && <span className="skc-badge-orphan">副本丢失</span>}
                  </div>
                  {skill.description ? (
                    <div className="skc-row-desc">{getSummary(skill)}</div>
                  ) : (
                    <div className="skc-row-desc skc-row-dir">{skill.directory}</div>
                  )}
                </div>
                <button
                  type="button"
                  className={`skc-enabled-switch${enabled ? " is-on" : ""}`}
                  disabled={busy}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggleEnabled(skill, !enabled);
                  }}
                  title={
                    orphan
                      ? "副本丢失：点击重新同步"
                      : enabled
                        ? "已启用（Claude 可用）· 点击停用（源文件保留）"
                        : "未启用 · 点击启用并同步到 Claude"
                  }
                >
                  {busy ? <Loader2 size={12} className="skc-spin" /> : enabled ? "已启用" : "未启用"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================ 浏览 ============================ */

function BrowseCard({
  skill,
  installed,
  installing,
  allTargets,
  onInstall,
  onManage,
  getSummary,
}: {
  skill: Skill & { installed?: boolean };
  installed: boolean;
  installing: boolean;
  allTargets: SkillTarget[];
  onInstall: (skill: Skill, targets: string[]) => void;
  onManage: (skill: Skill) => void;
  /** 一句话简介（汉化/原版第一句） */
  getSummary: (skill: Skill) => string;
}) {
  const [selectedTargets, setSelectedTargets] = useState<string[]>(() =>
    DEFAULT_TARGETS.filter((id) => allTargets.some((t) => t.id === id)),
  );
  const sourceLabel = skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : null;
  const sourceHref = sourceLabel ? `https://github.com/${skill.repoOwner}/${skill.repoName}` : null;
  const installsLabel =
    skill.installs != null
      ? `${Number(skill.installs || 0).toLocaleString()} 次安装`
      : null;

  return (
    <div className="skc-card">
      <div className="skc-card-head">
        <div className="skc-card-title" title={skill.name || skill.directory}>
          {skill.name || skill.directory}
        </div>
        {sourceHref ? (
          <a
            className="skc-card-source"
            href={sourceHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            {sourceLabel}
            <ExternalLink size={10} />
          </a>
        ) : null}
        {installsLabel && <span className="skc-card-installs">{installsLabel}</span>}
      </div>
      {skill.description && <p className="skc-card-desc">{getSummary(skill)}</p>}
      <div className="skc-card-foot">
        {installed ? (
          <button type="button" className="skc-btn skc-btn-outline skc-card-btn" onClick={() => onManage(skill)}>
            <Check size={12} />
            已安装 · 管理
          </button>
        ) : (
          <>
            <div className="skc-card-targets">
              <span className="skc-card-targets-label">同步到</span>
              <div className="skc-card-target-chips">
                {allTargets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`skc-chip${selectedTargets.includes(t.id) ? " is-active" : ""}`}
                    title={t.label}
                    onClick={() =>
                      setSelectedTargets((prev) =>
                        prev.includes(t.id) ? prev.filter((x) => x !== t.id) : [...prev, t.id],
                      )
                    }
                  >
                    <span
                      className="skc-chip-dot is-synced"
                      style={{ backgroundColor: AGENT_DOT_TONE[t.id] || "var(--color-primary)" }}
                    />
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
            <button
              type="button"
              className="skc-btn skc-btn-primary skc-card-btn"
              disabled={installing || selectedTargets.length === 0}
              onClick={() => onInstall(skill, selectedTargets)}
            >
              {installing ? <Loader2 size={12} className="skc-spin" /> : <Download size={12} />}
              安装
            </button>
          </>
        )}
      </div>
    </div>
  );
}

/* ============================ 本地发现（表格行格式） ============================ */

function LocalSkillsView({
  items,
  busyKey,
  onEnable,
  onDelete,
  anyFilter,
  getSummary,
}: {
  items: Skill[];
  busyKey: string;
  onEnable: (skill: Skill) => void;
  onDelete: (skill: Skill) => void;
  anyFilter: boolean;
  /** 一句话简介（汉化/原版第一句） */
  getSummary: (skill: Skill) => string;
}) {
  return (
    <div className="skc-my">
      {items.length === 0 ? (
        <div className="skc-empty">
          <p>{anyFilter ? "没有匹配的技能" : "本地没有发现未启用的技能"}</p>
          {!anyFilter && (
            <p className="skc-empty-sub">
              其他 agent 目录 / 自定义扫描目录中的技能、以及停用区中的技能会出现在这里
            </p>
          )}
        </div>
      ) : (
        <div className="skc-list">
          {items.map((skill) => {
            const sourcePath = skill.targetPaths ? Object.values(skill.targetPaths)[0] : null;
            const enableBusy = busyKey === `enable:${skill.id || skill.directory}`;
            const delBusy =
              busyKey === `del-discovery:${skill.directory}:${skill.disabledDest || ""}`;
            const busy = enableBusy || delBusy;
            return (
              <div key={skill.id || skill.key || `${skill.directory}:${skill.disabledDest || "d"}`} className="skc-skill-row">
                <div className="skc-row-main">
                  <div className="skc-row-title">
                    <span className="skc-row-name">{skill.name || skill.directory}</span>
                    {skill.disabled && <span className="skc-card-disabled-tag">已停用</span>}
                    {skill.sourceLabel && (
                      <span className="skc-local-source" title={sourcePath || skill.directory}>
                        {skill.sourceLabel}
                      </span>
                    )}
                  </div>
                  {skill.description ? (
                    <div className="skc-row-desc" title={sourcePath || skill.directory}>
                      {getSummary(skill)}
                    </div>
                  ) : (
                    <div className="skc-row-desc skc-row-dir" title={sourcePath || skill.directory}>
                      {sourcePath || skill.directory}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  className="skc-btn skc-btn-danger-soft"
                  disabled={busy}
                  onClick={() => onDelete(skill)}
                  title="永久删除该技能的本地文件（不可恢复）"
                >
                  {delBusy ? <Loader2 size={12} className="skc-spin" /> : <Trash2 size={12} />}
                  删除
                </button>
                <button
                  type="button"
                  className={`skc-enabled-switch${skill.disabled ? "" : " is-on"}`}
                  disabled={busy}
                  onClick={() => onEnable(skill)}
                  title={
                    skill.disabledDest
                      ? "恢复：将停用区中的源技能移回 Claude 技能目录"
                      : "启用：复制进 KKCODER 技能库并同步到 Claude（源文件不动）"
                  }
                >
                  {enableBusy ? <Loader2 size={12} className="skc-spin" /> : skill.disabledDest ? "恢复" : "启用"}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RepoManager({
  repos,
  repoInput,
  onRepoInput,
  busyKey,
  onAdd,
  onRemove,
}: {
  repos: Array<{ owner: string; name: string; branch: string }>;
  repoInput: string;
  onRepoInput: (v: string) => void;
  busyKey: string;
  onAdd: () => void;
  onRemove: (repo: { owner: string; name: string; branch: string }) => void;
}) {
  return (
    <div className="skc-repo-manager">
      <div className="skc-repo-add">
        <input
          type="text"
          className="skc-repo-input"
          placeholder="owner/repo（GitHub 仓库）"
          value={repoInput}
          onChange={(e) => onRepoInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") onAdd();
          }}
        />
        <button
          type="button"
          className="skc-btn skc-btn-outline"
          disabled={busyKey === "repo:add"}
          onClick={onAdd}
        >
          {busyKey === "repo:add" ? <Loader2 size={12} className="skc-spin" /> : <Plus size={12} />}
          添加
        </button>
      </div>
      {repos.length > 0 && (
        <div className="skc-repo-list">
          {repos.map((repo) => {
            const removing = busyKey === `repo:${repo.owner}/${repo.name}`;
            return (
              <div key={`${repo.owner}/${repo.name}`} className="skc-repo-row">
                <div className="skc-repo-name">
                  {repo.owner}/{repo.name}
                  <span className="skc-repo-branch">{repo.branch}</span>
                </div>
                <button
                  type="button"
                  className="skc-btn skc-btn-ghost"
                  disabled={removing}
                  onClick={() => onRemove(repo)}
                  title="移除仓库"
                >
                  {removing ? <Loader2 size={12} className="skc-spin" /> : <Trash2 size={12} />}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ============================ 主组件 ============================ */

export const SkillsCenter: React.FC = () => {
  const [tab, setTab] = useState<"my" | "local" | "browse">("my");
  const [installedData, setInstalledData] = useState<{ skills: Skill[]; targets: SkillTarget[] }>({
    skills: [],
    targets: [],
  });
  const [discoverData, setDiscoverData] = useState<Skill[]>([]);
  const [discoveries, setDiscoveries] = useState<Skill[]>([]);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [searchData, setSearchData] = useState<Skill[]>([]);
  const [popularData, setPopularData] = useState<Skill[]>([]);
  const [repos, setRepos] = useState<Array<{ owner: string; name: string; branch: string }>>([]);
  const [source, setSource] = useState<string>(SOURCE_ALL);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [myQuery, setMyQuery] = useState("");
  const [myDebouncedQuery, setMyDebouncedQuery] = useState("");
  const [repoInput, setRepoInput] = useState("");
  const [manageOpen, setManageOpen] = useState(false);
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [popularLoading, setPopularLoading] = useState(false);
  const [error, setError] = useState("");
  const [pendingRemove, setPendingRemove] = useState<Skill | null>(null);
  const [updates, setUpdates] = useState<Record<string, boolean>>({});
  const [usageBySkill, setUsageBySkill] = useState<Record<string, SkillUsageEntry>>({});
  // 技能汉化
  const [translations, setTranslations] = useState<Record<string, SkillTranslationStatus>>({});
  const [showZh, setShowZh] = useState<boolean>(
    () => localStorage.getItem(SHOW_ZH_STORAGE_KEY) === "1",
  );
  const [translating, setTranslating] = useState(false);
  const [pendingTranslateList, setPendingTranslateList] = useState<Skill[] | null>(null);
  // 扫描来源配置
  const [scanSources, setScanSources] = useState<SkillScanSource[]>([]);
  const [scanSourcesOpen, setScanSourcesOpen] = useState(false);
  const [scanSourceInput, setScanSourceInput] = useState("");
  // 黑名单（屏蔽）
  const [blacklist, setBlacklist] = useState<SkillBlacklistEntry[]>([]);
  const [blacklistOpen, setBlacklistOpen] = useState(false);
  const [pendingBlacklist, setPendingBlacklist] = useState<Skill | null>(null);
  // 本地发现：删除本地文件确认
  const [pendingDiscoveryDelete, setPendingDiscoveryDelete] = useState<Skill | null>(null);
  // 导入安装本地技能
  const [importOpen, setImportOpen] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState("");

  const installedKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const skill of installedData.skills) {
      for (const key of installedSkillKeys(skill)) keys.add(key);
    }
    return keys;
  }, [installedData.skills]);

  const loadInstalled = useCallback(async (): Promise<Skill[]> => {
    const data = await getInstalledSkills();
    const skills = (data.skills || []) as Skill[];
    setInstalledData({ skills, targets: data.targets || [] });
    return skills;
  }, []);

  /** 拉取本地发现（未启用的来源技能 + 停用区 + 已停用托管技能） */
  const loadDiscoveries = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const data = await getSkillDiscoveries();
      setDiscoveries((data.skills || []) as Skill[]);
    } catch {
      setDiscoveries([]);
    } finally {
      setDiscoverLoading(false);
    }
  }, []);

  /** 拉取扫描来源配置 */
  const loadScanSources = useCallback(async () => {
    const data = await invoke<{ builtins: SkillScanSource[]; custom: SkillScanSource[] }>(
      "get_skill_scan_sources",
    );
    setScanSources([...(data.builtins || []), ...(data.custom || [])]);
  }, []);

  /** 拉取黑名单记录（屏蔽的技能，按时间倒序） */
  const loadBlacklist = useCallback(async () => {
    try {
      const data = await invoke<{ entries: SkillBlacklistEntry[] }>("get_skill_blacklist");
      setBlacklist(data?.entries || []);
    } catch {
      setBlacklist([]);
    }
  }, []);

  /** 勾选内置来源：立即生效并刷新技能列表 */
  const handleToggleScanSource = async (source: SkillScanSource, enabled: boolean) => {
    try {
      await invoke("set_skill_scan_source_enabled", { id: source.id, enabled });
      setScanSources((prev) =>
        prev.map((s) => (s.id === source.id ? { ...s, enabled } : s)),
      );
      const skills = await loadInstalled();
      await loadTranslations(skills);
    } catch (err) {
      notifyError(`更新扫描来源失败：${formatFeedbackError(err)}`);
    }
  };

  /** 新增自定义扫描目录 */
  const handleAddScanSource = async () => {
    const path = scanSourceInput.trim();
    if (!path) return;
    try {
      await invoke("add_skill_scan_source", { path });
      setScanSourceInput("");
      await loadScanSources();
      const skills = await loadInstalled();
      await loadTranslations(skills);
      notifySuccess(`已添加扫描来源：${path}`);
    } catch (err) {
      notifyError(`添加失败：${formatFeedbackError(err)}`);
    }
  };

  /** 移除自定义扫描目录 */
  const handleRemoveScanSource = async (source: SkillScanSource) => {
    try {
      await invoke("remove_skill_scan_source", { id: source.id });
      setScanSources((prev) => prev.filter((s) => s.id !== source.id));
      const skills = await loadInstalled();
      await loadTranslations(skills);
      notifySuccess(`已移除扫描来源：${source.name}`);
    } catch (err) {
      notifyError(`移除失败：${formatFeedbackError(err)}`);
    }
  };

  /** 拉取汉化状态（后端按当前描述/正文哈希比对，技能更新后 stale=true 失效） */
  const loadTranslations = useCallback(async (skills: Skill[]) => {
    const items = skills
      .filter((s) => (s.description || "").trim())
      .map((s) => ({
        directory: s.directory,
        description: s.description || "",
        fullDescription: s.fullDescription || "",
      }));
    const list = await invoke<SkillTranslationStatus[]>("get_skill_translations", {
      skills: items,
    });
    const map: Record<string, SkillTranslationStatus> = {};
    for (const t of list) map[t.directory] = t;
    setTranslations(map);
  }, []);

  const loadRepos = useCallback(async () => {
    const data = await getSkillRepos();
    setRepos(data.repos || []);
  }, []);

  const loadDiscover = useCallback(async (opts: { force?: boolean } = {}) => {
    setBrowseLoading(true);
    try {
      const data = await discoverSkills(opts);
      setDiscoverData(data.skills || []);
    } finally {
      setBrowseLoading(false);
    }
  }, []);

  const loadPopular = useCallback(async (opts: { force?: boolean } = {}) => {
    setPopularLoading(true);
    try {
      const data = await getPopularSkills(opts);
      setPopularData(data.skills || []);
    } finally {
      setPopularLoading(false);
    }
  }, []);

  const loadUpdates = useCallback(async () => {
    try {
      const data = await checkSkillUpdates();
      setUpdates(data?.updates || {});
    } catch {
      setUpdates({});
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      const data = await getSkillUsage();
      const map: Record<string, SkillUsageEntry> = {};
      for (const entry of data?.skills || []) {
        if (entry.installed) {
          if (entry.directory) map[String(entry.directory).toLowerCase()] = entry;
          map[String(entry.skill).toLowerCase()] = entry;
        }
      }
      setUsageBySkill(map);
    } catch {
      setUsageBySkill({});
    }
  }, []);

  const loadInitial = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const skills = await loadInstalled();
      await Promise.all([loadRepos(), loadTranslations(skills), loadScanSources(), loadBlacklist()]);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadInstalled, loadRepos, loadTranslations, loadScanSources, loadBlacklist]);

  const handleRefresh = useCallback(async () => {
    await loadInitial();
    const fail = (err: unknown) =>
      setError(err instanceof Error ? err.message : String(err));
    if (tab === "my") {
      loadUpdates();
      loadUsage();
    } else if (tab === "local") {
      loadDiscoveries();
    } else if (source === SOURCE_POPULAR) {
      loadPopular({ force: true }).catch(fail);
    } else if (source !== SOURCE_SKILLSSH) {
      loadDiscover({ force: true }).catch(fail);
    }
  }, [loadDiscover, loadDiscoveries, loadInitial, loadPopular, loadUpdates, loadUsage, source, tab]);

  useEffect(() => {
    loadInitial();
  }, [loadInitial]);

  // 各浏览来源只自动加载一次（空结果也不重复拉取，避免无限刷新闪烁）
  const localLoadedRef = useRef(false);
  const repoLoadedRef = useRef(false);
  const popularLoadedRef = useRef(false);

  useEffect(() => {
    if (tab !== "local") return;
    if (!localLoadedRef.current) {
      localLoadedRef.current = true;
      loadDiscoveries();
    }
  }, [tab, loadDiscoveries]);

  useEffect(() => {
    if (tab !== "browse") return;
    if (source === SOURCE_SKILLSSH || source === SOURCE_POPULAR) return;
    if (!repoLoadedRef.current) {
      repoLoadedRef.current = true;
      loadDiscover().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [source, tab, loadDiscover]);

  useEffect(() => {
    if (tab !== "browse" || source !== SOURCE_POPULAR) return;
    if (!popularLoadedRef.current) {
      popularLoadedRef.current = true;
      loadPopular().catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [source, tab, loadPopular]);

  const hasUpdatesLoaded = Object.keys(updates).length > 0;
  const hasUsageLoaded = Object.keys(usageBySkill).length > 0;
  useEffect(() => {
    if (tab !== "my") return;
    if (!hasUpdatesLoaded) loadUpdates();
    if (!hasUsageLoaded) loadUsage();
  }, [tab, hasUpdatesLoaded, hasUsageLoaded, loadUpdates, loadUsage]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const timer = setTimeout(() => setMyDebouncedQuery(myQuery), 120);
    return () => clearTimeout(timer);
  }, [myQuery]);

  /** 同步开关处理锁：一次切换完成前忽略重复点击（防快速连点语义反转） */
  const toggleBusyRef = useRef(false);

  const runMutation = useCallback(
    async (key: string, task: () => Promise<void>): Promise<boolean> => {
      setBusyKey(key);
      setError("");
      try {
        await task();
        await loadInstalled();
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        return false;
      } finally {
        setBusyKey("");
      }
    },
    [loadInstalled],
  );

  const targetLabelFor = (targetId: string) =>
    installedData.targets.find((t) => t.id === targetId)?.label || targetId;

  const handleInstall = (skill: Skill, targets: string[]) => {
    const finalTargets = (targets && targets.length ? targets : DEFAULT_TARGETS).filter((id) =>
      installedData.targets.some((t) => t.id === id),
    );
    runMutation(installBusyKey(skill), async () => {
      await installSkill(skill, finalTargets);
      notifySuccess(
        `已安装「${skill.name || skill.directory}」→ ${finalTargets.map(targetLabelFor).join(", ") || "无"}`,
      );
    });
  };

  const confirmRemove = () => {
    const skill = pendingRemove;
    if (!skill) return;
    setPendingRemove(null);
    runMutation(removeBusyKey(skill), async () => {
      let result: { trashed?: boolean } | null = null;
      if (skill.managed) {
        result = await uninstallSkill(skill.id as string);
      } else {
        await deleteLocalSkill(skill.directory, skill.targets || []);
      }
      const canUndo = Boolean(result?.trashed && skill.managed && skill.id);
      notifySuccess(
        canUndo
          ? `已卸载「${skill.name || skill.directory}」（已移入回收站，5 分钟内可恢复）`
          : `已移除「${skill.name || skill.directory}」`,
      );
    });
  };

  /** 屏蔽：从 KKCODER 移除 + 记录黑名单（扫描不再引用，源文件保留） */
  const confirmBlacklist = () => {
    const skill = pendingBlacklist;
    if (!skill) return;
    setPendingBlacklist(null);
    runMutation(blacklistBusyKey(skill), async () => {
      const paths = skill.targetPaths ? Object.values(skill.targetPaths) : [];
      const sourcePath = typeof paths[0] === "string" ? paths[0] : "";
      await invoke("blacklist_skill", {
        directory: skill.directory,
        sourcePath,
        targets: skill.targets || [],
      });
      await loadBlacklist();
      notifySuccess(
        `已屏蔽「${skill.name || skill.directory}」（源文件保留，扫描不再引用）`,
      );
    });
  };

  /** 解除屏蔽：删除黑名单记录，源文件仍在时技能将重新出现在列表 */
  const handleUnblacklist = async (entry: SkillBlacklistEntry) => {
    try {
      await invoke("remove_skill_blacklist", { directory: entry.directory });
      await loadBlacklist();
      await loadInstalled().then((skills) => loadTranslations(skills));
      notifySuccess(`已解除屏蔽「${entry.directory}」`);
    } catch (err) {
      notifyError(`解除屏蔽失败：${formatFeedbackError(err)}`);
    }
  };

  /** 本地发现「删除本地文件」：用户确认后永久删除发现的技能目录 */
  const confirmDiscoveryDelete = async () => {
    const skill = pendingDiscoveryDelete;
    if (!skill) return;
    setPendingDiscoveryDelete(null);
    const sourceTarget =
      Object.keys(skill.targetPaths || {}).find((k) => k !== "custom") ||
      (skill.targetPaths?.custom ? "custom" : "");
    setBusyKey(`del-discovery:${skill.directory}:${skill.disabledDest || ""}`);
    try {
      if (skill.managed) {
        await uninstallSkill(skill.id as string);
      } else {
        await deleteDiscoverySkill({
          directory: skill.directory,
          disabledDest: skill.disabledDest,
          sourceTarget,
        });
      }
      notifySuccess(`已删除「${skill.name || skill.directory}」的本地文件`);
      await Promise.all([loadDiscoveries(), loadInstalled()]);
    } catch (err) {
      notifyError(`删除失败：${formatFeedbackError(err)}`);
    } finally {
      setBusyKey("");
    }
  };

  /** 导入安装：从本地路径复制技能进库并同步到 Claude */
  const confirmImport = async () => {
    const path = importPath.trim();
    if (!path || importing) return;
    setImporting(true);
    setImportError("");
    try {
      await importSkillFromPath(path);
      notifySuccess("已导入技能并同步到 Claude");
      setImportOpen(false);
      setImportPath("");
      await Promise.all([loadInstalled(), loadDiscoveries()]);
    } catch (err) {
      setImportError(formatFeedbackError(err));
    } finally {
      setImporting(false);
    }
  };

  /**
   * 启用/停用开关：
   * - 启用：同步到 Claude（托管副本 / 本地发现导入 / 停用区恢复），源技能不动；
   * - 停用：只移除 KKCoder 副本；原生源技能移入停用区保留，绝不删除源文件。
   * 处理锁防止连点；busyKey 用 enable: 前缀，列表开关与详情抽屉共用。
   */
  const handleToggleEnabled = (skill: Skill, enabled: boolean) => {
    if (toggleBusyRef.current) return;
    toggleBusyRef.current = true;
    const busyKeyId = `enable:${skill.id || skill.directory}`;
    runMutation(busyKeyId, async () => {
      await setSkillEnabled(skill, enabled);
      if (enabled) {
        notifySuccess(`已启用「${skill.name || skill.directory}」（Claude 可用）`);
      } else {
        notifySuccess(
          skill.native
            ? `已停用「${skill.name || skill.directory}」（源文件已移入停用区，可随时恢复）`
            : `已停用「${skill.name || skill.directory}」（源文件保留）`,
        );
      }
      await loadDiscoveries();
    }).then(() => {
      toggleBusyRef.current = false;
    });
  };

  const handleUpdate = (skill: Skill) => {
    if (!skill?.repoOwner || !skill?.repoName) return;
    runMutation(installBusyKey(skill), async () => {
      await installSkill(
        {
          key: skill.key,
          name: skill.name,
          description: skill.description,
          directory: skill.sourceDirectory || skill.directory,
          repoOwner: skill.repoOwner,
          repoName: skill.repoName,
          repoBranch: skill.repoBranch,
          readmeUrl: skill.readmeUrl,
        },
        skill.targets && skill.targets.length ? skill.targets : DEFAULT_TARGETS,
      );
      await loadUpdates();
      notifySuccess(`已更新「${skill.name || skill.directory}」`);
    });
  };

  // ===== 技能汉化 =====

  /** 列表一句话简介：汉化开关打开且有有效翻译 → LLM 输出的中文简介（≤100 字，不裁剪）；否则原版第一句 */
  const summarizeFor = useCallback(
    (skill: Skill): string => {
      if (showZh) {
        const t = translations[skill.directory];
        if (t && !t.stale && t.descriptionZh) return t.descriptionZh;
      }
      return firstSentence(skill.description || "");
    },
    [showZh, translations],
  );

  /** 完整介绍（详细介绍）显示：汉化开关打开且有有效翻译 → 大模型撰写的介绍；否则原版正文 */
  const describeFullFor = useCallback(
    (skill: Skill): string => {
      const full = skill.fullDescription || "";
      if (!full || !showZh) return full;
      const t = translations[skill.directory];
      if (t && !t.staleFull && t.descriptionFullZh) return t.descriptionFullZh;
      return full;
    },
    [showZh, translations],
  );

  const handleTranslate = () => {
    if (pendingZhSkills.length === 0) {
      notifyInfo("所有技能描述均已汉化，无需再次汉化");
      return;
    }
    setPendingTranslateList(pendingZhSkills);
  };

  const confirmTranslate = async () => {
    const list = pendingTranslateList;
    if (!list || list.length === 0) return;
    setPendingTranslateList(null);
    setTranslating(true);
    try {
      const apiKey = localStorage.getItem("kkcoder_setting_llm_api_key") || "";
      if (!apiKey) {
        notifyError("未配置 LLM API Key，请在设置中心「自动改名」处配置后重试");
        return;
      }
      const apiUrl =
        localStorage.getItem("kkcoder_setting_llm_api_url") || "https://api.deepseek.com";
      const model = localStorage.getItem("kkcoder_setting_llm_model") || "deepseek-v4-flash";
      const items = list.map((s) => ({
        directory: s.directory,
        description: s.description || "",
        fullDescription: s.fullDescription || "",
      }));
      const result = await invoke<
        Array<{
          directory: string;
          descriptionHash: string;
          descriptionZh: string;
          descriptionFullZh: string;
        }>
      >("translate_skills", { skills: items, apiUrl, apiKey, model });
      const map: Record<string, SkillTranslationStatus> = { ...translations };
      for (const t of result) {
        map[t.directory] = {
          directory: t.directory,
          descriptionZh: t.descriptionZh,
          stale: false,
          descriptionFullZh: t.descriptionFullZh,
          staleFull: false,
        };
      }
      setTranslations(map);
      notifySuccess(`已汉化 ${result.length} 个技能描述${result.length < list.length ? `（${list.length - result.length} 个未返回）` : ""}`);
    } catch (err) {
      notifyError(`汉化失败：${formatFeedbackError(err)}`);
    } finally {
      setTranslating(false);
    }
  };

  const handleSearch = async () => {
    const trimmed = query.trim();
    if (trimmed.length < 2) return;
    setBusyKey("search");
    setError("");
    try {
      const data = await searchSkills(trimmed);
      setSearchData(data.skills || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKey("");
    }
  };

  const handleAddRepo = async () => {
    const raw = repoInput.trim().replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "");
    const [owner, name] = raw.split("/");
    if (!owner || !name) {
      setError("仓库格式应为 owner/repo");
      return;
    }
    await runMutation("repo:add", async () => {
      await addSkillRepo({ owner, name, branch: "main", enabled: true });
      setRepoInput("");
      await loadRepos();
      await loadDiscover();
    });
  };

  const handleRemoveRepo = async (repo: { owner: string; name: string; branch: string }) => {
    await runMutation(`repo:${repo.owner}/${repo.name}`, async () => {
      await removeSkillRepo(repo.owner, repo.name);
      await loadRepos();
      await loadDiscover();
    });
  };

  const targets = installedData.targets.filter((t) => ENABLED_TARGETS.includes(t.id));
  const mySkills = installedData.skills;

  /** 待汉化清单：无翻译记录或记录已过期（技能更新导致哈希不匹配） */
  const pendingZhSkills = useMemo(() => {
    return mySkills.filter((s) => {
      if (!(s.description || "").trim()) return false;
      const t = translations[s.directory];
      return !t || t.stale || !t.descriptionZh;
    });
  }, [mySkills, translations]);

  /**
   * 排序：按调用次数降序 → 名称兜底（列表 = 已启用技能，开关不重排）。
   */
  const sortedMySkills = useMemo(() => {
    const usageOf = (s: Skill): number =>
      usageBySkill[String(s.directory || "").toLowerCase()]?.invocations ||
      usageBySkill[String(s.name || "").toLowerCase()]?.invocations ||
      0;
    return [...mySkills].sort((a, b) => {
      const diff = usageOf(b) - usageOf(a);
      if (diff !== 0) return diff;
      return (a.name || a.directory).localeCompare(b.name || b.directory);
    });
  }, [mySkills, usageBySkill]);

  const filteredMySkills = useMemo(() => {
    const q = myDebouncedQuery.trim().toLowerCase();
    if (!q) return sortedMySkills;
    return sortedMySkills.filter(
      (skill) =>
        (skill.name || "").toLowerCase().includes(q) ||
        (skill.directory || "").toLowerCase().includes(q) ||
        (skill.description || "").toLowerCase().includes(q),
    );
  }, [sortedMySkills, myDebouncedQuery]);

  const selectedSkill = useMemo(() => {
    if (!selectedSkillId) return null;
    return mySkills.find((s) => (s.id || s.directory) === selectedSkillId) || null;
  }, [mySkills, selectedSkillId]);

  useEffect(() => {
    if (selectedSkillId && !selectedSkill) setSelectedSkillId(null);
  }, [selectedSkill, selectedSkillId]);

  // 详情抽屉打开时：Esc 只关闭抽屉（回到技能列表），不退出整个拓展面板。
  // 面板层的 Esc 会通过 .skc-drawer 存在性检查让位给本处理。
  useEffect(() => {
    if (!selectedSkillId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setSelectedSkillId(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [selectedSkillId]);

  const handleSelectSkill = useCallback((skill: Skill) => {
    setSelectedSkillId((prev) => {
      const next = skill?.id || skill?.directory || null;
      return prev === next ? null : next;
    });
  }, []);

  const handleManage = useCallback(
    (browseSkill: Skill) => {
      const fullKey = getSkillKey(browseSkill).toLowerCase();
      const fallbackKey = browseDirectoryFallbackKey(browseSkill);
      const match = installedData.skills.find((skill) => {
        const keys = installedSkillKeys(skill);
        return keys.has(fullKey) || (fallbackKey && keys.has(fallbackKey));
      });
      if (match) setSelectedSkillId(match.id || match.directory);
    },
    [installedData.skills],
  );

  const browseItems = useMemo(() => {
    const pool =
      source === SOURCE_SKILLSSH ? searchData : source === SOURCE_POPULAR ? popularData : discoverData;
    const serverRanked = source === SOURCE_SKILLSSH || source === SOURCE_POPULAR;
    const filtered =
      serverRanked || source === SOURCE_ALL
        ? pool
        : pool.filter((skill) => `${skill.repoOwner}/${skill.repoName}` === source);
    const q = debouncedQuery.trim().toLowerCase();
    const matched =
      source === SOURCE_SKILLSSH || !q
        ? filtered
        : filtered.filter(
            (skill) =>
              (skill.name || "").toLowerCase().includes(q) ||
              (skill.directory || "").toLowerCase().includes(q) ||
              (skill.description || "").toLowerCase().includes(q),
          );
    return matched.map((skill) => {
      const fullKey = getSkillKey(skill).toLowerCase();
      const dirKey = browseDirectoryFallbackKey(skill);
      return {
        ...skill,
        installed: installedKeys.has(fullKey) || (dirKey ? installedKeys.has(dirKey) : false),
      };
    });
  }, [debouncedQuery, discoverData, installedKeys, popularData, searchData, source]);

  /** 本地发现列表：搜索过滤（名称/目录/描述） */
  const filteredDiscoveries = useMemo(() => {
    const q = myDebouncedQuery.trim().toLowerCase();
    if (!q) return discoveries;
    return discoveries.filter(
      (skill) =>
        (skill.name || "").toLowerCase().includes(q) ||
        (skill.directory || "").toLowerCase().includes(q) ||
        (skill.description || "").toLowerCase().includes(q),
    );
  }, [discoveries, myDebouncedQuery]);

  const usageFor = (skill: Skill): SkillUsageEntry | null =>
    usageBySkill[String(skill.directory || "").toLowerCase()] ||
    usageBySkill[String(skill.name || "").toLowerCase()] ||
    null;

  const formatRelativeTime = (iso?: string): string => {
    if (!iso) return "未知";
    const diff = Date.now() - new Date(iso).getTime();
    if (diff < 0) return "刚刚";
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "刚刚";
    if (mins < 60) return `${mins} 分钟前`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours} 小时前`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} 天前`;
    return `${Math.floor(days / 30)} 个月前`;
  };

  return (
    <div className="skc">
      {/* 页头 */}
      <div className="skc-head">
        <h2 className="skc-title">技能中心</h2>
        <button
          type="button"
          className="skc-btn skc-btn-outline"
          onClick={handleRefresh}
          disabled={loading || browseLoading || popularLoading}
          title="刷新"
        >
          <RefreshCw size={12} className={(loading || browseLoading || popularLoading) ? "skc-spin" : ""} />
          刷新
        </button>
      </div>

      {/* Tab */}
      <div className="skc-tabs">
        {(
          [
            ["my", "我的技能"],
            ["local", "本地发现"],
            ["browse", "浏览"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className={`skc-tab${tab === value ? " is-active" : ""}`}
            onClick={() => setTab(value)}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <div className="skc-error">
          {error}
          <button type="button" className="skc-error-close" onClick={() => setError("")} title="关闭">
            <X size={11} />
          </button>
        </div>
      )}

      {/* 固定工具栏：我的技能（搜索 + 计数 + 汉化 + 黑名单） */}
      {tab === "my" && !loading && (
        <div className="skc-toolbar">
          <div className="skc-search">
            <Search size={13} className="skc-search-icon" />
            <input
              type="text"
              className="skc-search-input"
              placeholder="搜索技能（名称 / 目录 / 描述）"
              value={myQuery}
              onChange={(e) => setMyQuery(e.target.value)}
            />
            {myQuery && (
              <button
                type="button"
                className="skc-search-clear"
                onClick={() => setMyQuery("")}
                title="清空"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <span className="skc-count">已启用 {mySkills.length}</span>
          {myQuery.trim() !== "" && (
            <button
              type="button"
              className="skc-btn skc-btn-ghost"
              onClick={() => setMyQuery("")}
            >
              <X size={11} />
              清除筛选
            </button>
          )}
          <span className="skc-toolbar-spacer" />
          <button
            type="button"
            className="skc-btn skc-btn-outline"
            onClick={() => {
              setImportError("");
              setImportOpen(true);
            }}
            title="从本地文件夹导入技能（复制进技能库并同步到 Claude，源文件夹不动）"
          >
            <Download size={12} />
            导入技能
          </button>
          <button
            type="button"
            className={`skc-btn skc-btn-outline skc-zh-toggle${showZh ? " is-on" : ""}`}
            onClick={() => {
              const next = !showZh;
              setShowZh(next);
              localStorage.setItem(SHOW_ZH_STORAGE_KEY, next ? "1" : "0");
            }}
            title={
              showZh
                ? "当前显示汉化描述（点击切回原版）"
                : "当前显示原版描述（点击切换汉化）"
            }
          >
            <Languages size={12} />
            {showZh ? "汉化：开" : "汉化：关"}
          </button>
          <button
            type="button"
            className="skc-btn skc-btn-outline"
            disabled={translating || pendingZhSkills.length === 0}
            onClick={handleTranslate}
            title={
              pendingZhSkills.length === 0
                ? "所有技能描述均已汉化"
                : `一键汉化 ${pendingZhSkills.length} 个技能描述（LLM 批量翻译）`
            }
          >
            {translating ? <Loader2 size={12} className="skc-spin" /> : <Languages size={12} />}
            {translating ? "汉化中..." : "一键汉化"}
            {!translating && pendingZhSkills.length > 0 && (
              <span className="skc-count-badge">{pendingZhSkills.length}</span>
            )}
          </button>
          <button
            type="button"
            className="skc-btn skc-btn-outline"
            onClick={() => setBlacklistOpen(true)}
            title="查看屏蔽记录：已屏蔽的技能不再被扫描引用（源文件保留），可在此恢复"
          >
            <Ban size={12} />
            黑名单
            {blacklist.length > 0 && <span className="skc-count-badge">{blacklist.length}</span>}
          </button>
        </div>
      )}

      {/* 固定工具栏：本地发现（搜索 + 计数 + 扫描来源） */}
      {tab === "local" && (
        <div className="skc-toolbar">
          <div className="skc-search">
            <Search size={13} className="skc-search-icon" />
            <input
              type="text"
              className="skc-search-input"
              placeholder="搜索本地发现（名称 / 目录 / 描述）"
              value={myQuery}
              onChange={(e) => setMyQuery(e.target.value)}
            />
            {myQuery && (
              <button
                type="button"
                className="skc-search-clear"
                onClick={() => setMyQuery("")}
                title="清空"
              >
                <X size={11} />
              </button>
            )}
          </div>
          <span className="skc-count">发现 {discoveries.length}</span>
          {myQuery.trim() !== "" && (
            <button
              type="button"
              className="skc-btn skc-btn-ghost"
              onClick={() => setMyQuery("")}
            >
              <X size={11} />
              清除筛选
            </button>
          )}
          <span className="skc-toolbar-spacer" />
          <button
            type="button"
            className="skc-btn skc-btn-outline"
            onClick={() => setScanSourcesOpen(true)}
            title="配置扫描来源：勾选内置代理目录或新增自定义目录，决定哪些技能出现在「本地发现」"
          >
            <FolderSearch size={12} />
            扫描来源
          </button>
        </div>
      )}

      {/* 固定工具栏：浏览 */}
      {tab === "browse" && (
        <div className="skc-toolbar">
            <div className="skc-segmented" role="group" aria-label="来源">
              <button
                type="button"
                className={`skc-seg-btn${source === SOURCE_ALL ? " is-active" : ""}`}
                onClick={() => setSource(SOURCE_ALL)}
              >
                仓库
              </button>
              <button
                type="button"
                className={`skc-seg-btn${source === SOURCE_POPULAR ? " is-active" : ""}`}
                onClick={() => setSource(SOURCE_POPULAR)}
              >
                <Flame size={11} />
                热门
              </button>
              <button
                type="button"
                className={`skc-seg-btn${source === SOURCE_SKILLSSH ? " is-active" : ""}`}
                onClick={() => setSource(SOURCE_SKILLSSH)}
              >
                skills.sh
              </button>
            </div>
            {source === SOURCE_ALL && (
              <select
                className="skc-select skc-source-select"
                value={source}
                onChange={(e) => setSource(e.target.value)}
                title="筛选来源仓库"
              >
                <option value={SOURCE_ALL}>全部仓库</option>
                {repos.map((repo) => (
                  <option key={`${repo.owner}/${repo.name}`} value={`${repo.owner}/${repo.name}`}>
                    {repo.owner}/{repo.name}
                  </option>
                ))}
              </select>
            )}
            {source !== SOURCE_SKILLSSH && (
              <div className="skc-search">
                <Search size={13} className="skc-search-icon" />
                <input
                  type="text"
                  className="skc-search-input"
                  placeholder={
                    source === SOURCE_POPULAR ? "筛选热门技能…" : "筛选技能…"
                  }
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && source === SOURCE_SKILLSSH) handleSearch();
                  }}
                />
              </div>
            )}
            {source === SOURCE_SKILLSSH ? (
              <button
                type="button"
                className="skc-btn skc-btn-primary"
                disabled={query.trim().length < 2 || busyKey === "search"}
                onClick={handleSearch}
              >
                {busyKey === "search" ? <Loader2 size={12} className="skc-spin" /> : <Search size={12} />}
                搜索
              </button>
            ) : (
              <button
                type="button"
                className="skc-btn skc-btn-outline"
                onClick={() => setManageOpen((v) => !v)}
                aria-expanded={manageOpen}
              >
                <Plus size={12} />
                仓库管理
                <span className="skc-count-badge">{repos.length}</span>
              </button>
            )}
          </div>
      )}

      {/* 滚动内容区：技能列表 / 浏览结果 */}
      <div className="skc-scroll">
        {tab === "my" ? (
          loading ? (
            <div className="skc-loading">
              <Loader2 size={16} className="skc-spin" />
              正在加载…
            </div>
          ) : (
            <MySkillsView
              items={filteredMySkills}
              selectedId={selectedSkillId}
              onSelect={handleSelectSkill}
              onToggleEnabled={handleToggleEnabled}
              busyKey={busyKey}
              updates={updates}
              anyFilter={myQuery.trim() !== ""}
              onBrowse={() => setTab("browse")}
              getSummary={summarizeFor}
            />
          )
        ) : tab === "local" ? (
          discoverLoading && discoveries.length === 0 ? (
            <div className="skc-loading">
              <Loader2 size={16} className="skc-spin" />
              正在加载…
            </div>
          ) : (
            <LocalSkillsView
              items={filteredDiscoveries}
              busyKey={busyKey}
              onEnable={(s) => handleToggleEnabled(s, true)}
              onDelete={setPendingDiscoveryDelete}
              anyFilter={myQuery.trim() !== ""}
              getSummary={summarizeFor}
            />
          )
        ) : (
          <div className="skc-browse">

          {manageOpen && (
            <RepoManager
              repos={repos}
              repoInput={repoInput}
              onRepoInput={setRepoInput}
              busyKey={busyKey}
              onAdd={handleAddRepo}
              onRemove={handleRemoveRepo}
            />
          )}

          <div className="skc-browse-count">
            {browseItems.length > 0 && <span>共 {browseItems.length} 个技能</span>}
            {(debouncedQuery.trim() !== "" || source !== SOURCE_ALL) &&
              source !== SOURCE_SKILLSSH &&
              source !== SOURCE_POPULAR && (
                <button
                  type="button"
                  className="skc-btn skc-btn-ghost"
                  onClick={() => {
                    setQuery("");
                    setSource(SOURCE_ALL);
                  }}
                >
                  <X size={11} />
                  清除筛选
                </button>
              )}
          </div>

          {browseLoading || (source === SOURCE_POPULAR && popularLoading) ? (
            <div className="skc-loading">
              <Loader2 size={16} className="skc-spin" />
              正在加载…
            </div>
          ) : repos.length === 0 && source !== SOURCE_SKILLSSH && source !== SOURCE_POPULAR ? (
            <div className="skc-empty">
              <p>还没有配置技能来源仓库</p>
              <button
                type="button"
                className="skc-btn skc-btn-outline"
                onClick={() => setManageOpen(true)}
              >
                添加仓库
              </button>
            </div>
          ) : source === SOURCE_SKILLSSH && query.trim().length < 2 ? (
            <div className="skc-empty">
              <p>输入至少 2 个字符，回车在 skills.sh 上搜索技能</p>
            </div>
          ) : browseItems.length > 0 ? (
            <div className="skc-cards">
              {browseItems.map((skill) => (
                <BrowseCard
                  key={skill.id || skill.key || `${skill.repoOwner}/${skill.repoName}:${skill.directory}`}
                  skill={skill}
                  installed={Boolean(skill.installed)}
                  installing={busyKey === installBusyKey(skill)}
                  allTargets={targets}
                  onInstall={handleInstall}
                  onManage={handleManage}
                  getSummary={summarizeFor}
                />
              ))}
            </div>
          ) : (
            <div className="skc-empty">
              <p>没有匹配的技能</p>
            </div>
          )}
        </div>
          )}
      </div>

      {/* 详情抽屉 */}
      {selectedSkill && (
        <SkillDetailDrawer
          skill={selectedSkill}
          usage={usageFor(selectedSkill)}
          hasUpdate={Boolean(selectedSkill.id && updates[selectedSkill.id])}
          busyKey={busyKey}
          onClose={() => setSelectedSkillId(null)}
          onToggleEnabled={handleToggleEnabled}
          onUpdate={handleUpdate}
          onRemove={setPendingRemove}
          onBlacklist={setPendingBlacklist}
          formatRelativeTime={formatRelativeTime}
          getFullDescription={describeFullFor}
        />
      )}

      {/* 一键汉化确认弹窗：列出本次将汉化的技能 */}
      <ConfirmModal
        show={Boolean(pendingTranslateList) && !translating}
        title={`一键汉化 ${pendingTranslateList?.length || 0} 个技能描述`}
        message={
          pendingTranslateList ? (
            <div className="skc-translate-list">
              <div className="skc-translate-list-hint">
                将通过你配置的 LLM（{localStorage.getItem("kkcoder_setting_llm_model") || "deepseek-v4-flash"}）批量汉化以下技能的一句话描述，汉化结果单独保存，不会修改原技能文件：
              </div>
              <div className="skc-translate-list-items">
                {pendingTranslateList.map((s, idx) => {
                  const displayName =
                    (s.name && s.name.trim()) ||
                    (s.directory && s.directory.trim()) ||
                    (s.key && s.key.replace(/^local:/, "").trim()) ||
                    (s.id && s.id.replace(/^local:/, "").trim()) ||
                    (s.sourceDirectory && s.sourceDirectory.trim()) ||
                    `技能 #${idx + 1}`;
                  return (
                    <div key={s.directory || s.id || idx} className="skc-translate-item">
                      <div className="skc-translate-item-left">
                        <span className="skc-translate-item-idx">{idx + 1}.</span>
                        <span className="skc-translate-item-name" title={displayName}>
                          {displayName}
                        </span>
                      </div>
                      {s.description && (
                        <span className="skc-translate-item-desc" title={s.description}>
                          {s.description}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            ""
          )
        }
        confirmText="开始汉化"
        onConfirm={confirmTranslate}
        onCancel={() => setPendingTranslateList(null)}
      />

      {/* 导入本地技能弹窗 */}
      {importOpen && (
        <div className="skc-src-overlay" onClick={() => setImportOpen(false)} role="presentation">
          <div
            className="skc-src-panel"
            role="dialog"
            aria-modal="true"
            aria-label="导入本地技能"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="skc-src-head">
              <span className="skc-src-title">导入本地技能</span>
              <button
                type="button"
                className="skc-btn skc-btn-ghost"
                onClick={() => setImportOpen(false)}
                title="关闭"
              >
                <X size={13} />
              </button>
            </div>
            <div className="skc-src-body">
              <div className="skc-src-hint">
                填写技能目录的完整路径（目录内需包含 SKILL.md）。导入 = 复制进 KKCODER
                技能库并同步到 Claude 技能目录；<b>原目录文件不会被修改或移动</b>。
              </div>
              <input
                type="text"
                className="skc-repo-input"
                placeholder="例如 D:\skills\my-skill"
                value={importPath}
                onChange={(e) => setImportPath(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void confirmImport();
                }}
                disabled={importing}
                autoFocus
              />
              {importError && <div className="skc-src-error">{importError}</div>}
              <div className="skc-src-actions">
                <button
                  type="button"
                  className="skc-btn skc-btn-outline"
                  onClick={() => setImportOpen(false)}
                  disabled={importing}
                >
                  取消
                </button>
                <button
                  type="button"
                  className="skc-btn skc-btn-primary"
                  disabled={importing || !importPath.trim()}
                  onClick={() => void confirmImport()}
                >
                  {importing ? <Loader2 size={12} className="skc-spin" /> : <Download size={12} />}
                  {importing ? "导入中…" : "导入并启用"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 扫描来源配置弹窗 */}
      {scanSourcesOpen && (
        <div className="skc-src-overlay" onClick={() => setScanSourcesOpen(false)} role="presentation">
          <div
            className="skc-src-panel"
            role="dialog"
            aria-modal="true"
            aria-label="扫描来源配置"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="skc-src-head">
              <span className="skc-src-title">扫描来源</span>
              <button
                type="button"
                className="skc-btn skc-btn-ghost"
                onClick={() => setScanSourcesOpen(false)}
                title="关闭"
              >
                <X size={13} />
              </button>
            </div>
            <div className="skc-src-body">
              <div className="skc-src-hint">
                勾选启用的来源决定哪些目录的技能会扫描进「我的技能」；托管技能（KKCODER 统一管理）不受影响。
              </div>

              <div className="skc-src-section">
                <div className="skc-src-section-title">内置代理目录</div>
                <div className="skc-src-list">
                  {scanSources
                    .filter((s) => s.kind === "builtin")
                    .map((s) => (
                      <label key={s.id} className="skc-src-row">
                        <input
                          type="checkbox"
                          checked={s.enabled !== false}
                          onChange={(e) => void handleToggleScanSource(s, e.target.checked)}
                        />
                        <span className="skc-src-name">{s.name}</span>
                        <span className="skc-src-path" title={s.path}>
                          {s.path}
                        </span>
                      </label>
                    ))}
                </div>
              </div>

              <div className="skc-src-section">
                <div className="skc-src-section-title">自定义目录</div>
                <div className="skc-src-add">
                  <input
                    type="text"
                    className="skc-src-input"
                    placeholder="输入技能目录的绝对路径，回车或点添加"
                    value={scanSourceInput}
                    onChange={(e) => setScanSourceInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleAddScanSource();
                    }}
                  />
                  <button
                    type="button"
                    className="skc-btn skc-btn-outline"
                    disabled={!scanSourceInput.trim()}
                    onClick={() => void handleAddScanSource()}
                  >
                    <Plus size={12} />
                    添加
                  </button>
                </div>
                <div className="skc-src-list">
                  {scanSources.filter((s) => s.kind === "custom").length === 0 ? (
                    <div className="skc-src-empty">暂无自定义目录</div>
                  ) : (
                    scanSources
                      .filter((s) => s.kind === "custom")
                      .map((s) => (
                        <div key={s.id} className="skc-src-row">
                          <span className="skc-src-name">{s.name}</span>
                          <span className="skc-src-path" title={s.path}>
                            {s.path}
                          </span>
                          <button
                            type="button"
                            className="skc-btn skc-btn-ghost"
                            title="移除该扫描来源"
                            onClick={() => void handleRemoveScanSource(s)}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 确认弹窗 */}
      <ConfirmModal
        show={Boolean(pendingRemove)}
        title={`移除「${pendingRemove?.name || pendingRemove?.directory || ""}」`}
        message={
          pendingRemove ? (
            pendingRemove.managed ? (
              "卸载后技能将移入回收站，5 分钟内可恢复（源文件不受影响）。"
            ) : (
              <>
                将移入<b>停用区</b>保留（<b>源文件不会删除</b>），
                可随时在「浏览 → 本地发现」中重新启用。
              </>
            )
          ) : (
            ""
          )
        }
        confirmText="移除"
        isDanger
        onConfirm={confirmRemove}
        onCancel={() => setPendingRemove(null)}
      />
      {/* 屏蔽确认 */}
      <ConfirmModal
        show={Boolean(pendingBlacklist)}
        title={`屏蔽「${pendingBlacklist?.name || pendingBlacklist?.directory || ""}」`}
        message={
          pendingBlacklist ? (
            <>
              将从 KKCODER 中移除该技能，并屏蔽其来源目录：
              <br />
              <br />
              • 之后扫描（内置代理目录 / 自定义目录）<b>不再引用</b>该目录；
              <br />
              • <b>源文件不会删除</b>，可随时在黑名单中恢复；
              <br />
              • 已同步到各代理的副本将被移除。
            </>
          ) : (
            ""
          )
        }
        confirmText="确认屏蔽"
        isDanger
        onConfirm={confirmBlacklist}
        onCancel={() => setPendingBlacklist(null)}
      />

      {/* 本地发现：删除本地文件确认 */}
      <ConfirmModal
        show={Boolean(pendingDiscoveryDelete)}
        title={`删除本地文件「${pendingDiscoveryDelete?.name || pendingDiscoveryDelete?.directory || ""}」`}
        message={
          pendingDiscoveryDelete ? (
            pendingDiscoveryDelete.disabledDest ? (
              <>
                将<b>永久删除</b>停用区中的技能目录（不可恢复）。
                <br />
                <br />
                如需保留文件，请选择「恢复」而非删除。
              </>
            ) : (
              <>
                将<b>永久删除</b>以下目录中的技能文件（<b>不可恢复</b>）：
                <br />
                <br />
                <code className="skc-dialog-path">
                  {Object.values(pendingDiscoveryDelete.targetPaths || {})[0] ||
                    pendingDiscoveryDelete.directory}
                </code>
                <br />
                <br />
                {pendingDiscoveryDelete.managed
                  ? "（托管技能：删除的是 KKCoder 技能库副本，可移入回收站）"
                  : "删除后该 agent / 目录将不再包含此技能。"}
              </>
            )
          ) : (
            ""
          )
        }
        confirmText="永久删除"
        isDanger
        onConfirm={() => void confirmDiscoveryDelete()}
        onCancel={() => setPendingDiscoveryDelete(null)}
      />

      {/* 黑名单记录弹窗 */}
      {blacklistOpen && (
        <div className="skc-src-overlay" onClick={() => setBlacklistOpen(false)}>
          <div
            className="skc-src-panel"
            role="dialog"
            aria-modal="true"
            aria-label="黑名单"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="skc-src-head">
              <span className="skc-src-title">黑名单（{blacklist.length}）</span>
              <button
                type="button"
                className="skc-btn skc-btn-ghost"
                onClick={() => setBlacklistOpen(false)}
                title="关闭"
              >
                <X size={13} />
              </button>
            </div>
            <div className="skc-src-body">
              <div className="skc-src-hint">
                已屏蔽的技能：不再被任何来源扫描引用，源文件保留。解除屏蔽后，若源目录仍存在，技能将重新出现在「我的技能」。
              </div>
              <div className="skc-src-section">
                <div className="skc-src-section-title">屏蔽记录</div>
                {blacklist.length === 0 ? (
                  <div className="skc-src-empty">黑名单为空，暂无屏蔽记录</div>
                ) : (
                  <div className="skc-src-list">
                    {blacklist.map((entry) => (
                      <div key={entry.directory} className="skc-src-row">
                        <span className="skc-src-name" title={entry.directory}>
                          {entry.directory}
                        </span>
                        <span
                          className="skc-src-path"
                          title={entry.sourcePath || "来源路径未知（托管技能）"}
                        >
                          {entry.sourcePath
                            ? `${entry.sourcePath} · ${formatRelativeTime(new Date(entry.createdAt).toISOString())}`
                            : `来源未知 · ${formatRelativeTime(new Date(entry.createdAt).toISOString())}`}
                        </span>
                        <button
                          type="button"
                          className="skc-btn skc-btn-ghost"
                          title="解除屏蔽（源文件仍在时技能将重新出现）"
                          onClick={() => void handleUnblacklist(entry)}
                        >
                          <Undo2 size={12} />
                          恢复
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* ============================ 详情抽屉 ============================ */

function SkillDetailDrawer({
  skill,
  usage,
  hasUpdate,
  busyKey,
  onClose,
  onToggleEnabled,
  onUpdate,
  onRemove,
  onBlacklist,
  formatRelativeTime,
  getFullDescription,
}: {
  skill: Skill;
  usage: SkillUsageEntry | null;
  hasUpdate: boolean;
  busyKey: string;
  onClose: () => void;
  onToggleEnabled: (skill: Skill, enabled: boolean) => void;
  onUpdate: (skill: Skill) => void;
  onRemove: (skill: Skill) => void;
  onBlacklist: (skill: Skill) => void;
  formatRelativeTime: (iso?: string) => string;
  /** 详细介绍：汉化版 = LLM 撰写的介绍；原版 = SKILL.md 正文 */
  getFullDescription: (skill: Skill) => string;
}) {
  const sourceLabel =
    skill.repoOwner && skill.repoName ? `${skill.repoOwner}/${skill.repoName}` : null;
  const sourceHref = sourceLabel ? `https://github.com/${skill.repoOwner}/${skill.repoName}` : null;
  // 未托管技能：来源是某个代理目录的实际路径
  const rawPath = skill.targetPaths ? Object.values(skill.targetPaths)[0] : null;
  const hasUsage = Boolean(usage && (usage.invocations || 0) > 0);
  const updating = busyKey === installBusyKey(skill);
  const removing = busyKey === removeBusyKey(skill);
  const enabled = skill.targetStates?.claude === "synced";
  const orphan = skill.targetStates?.claude === "orphan";
  const toggleBusy = busyKey === `enable:${skill.id || skill.directory}`;

  return (
    <div className="skc-drawer">
      <div className="skc-drawer-mask" onClick={onClose} aria-hidden />
      <aside className="skc-drawer-panel" role="dialog" aria-label="技能详情">
        <div className="skc-drawer-head">
          <h3 className="skc-drawer-title">{skill.name || skill.directory}</h3>
          <button type="button" className="skc-btn skc-btn-ghost" onClick={onClose} title="关闭 (Esc)">
            <X size={13} />
          </button>
        </div>

        <div className="skc-drawer-body">
          {hasUpdate && (
            <div className="skc-drawer-update">
              <ArrowUpCircle size={12} />
              有新版本可用
              <button
                type="button"
                className="skc-btn skc-btn-primary"
                disabled={updating}
                onClick={() => onUpdate(skill)}
              >
                {updating ? <Loader2 size={12} className="skc-spin" /> : <Download size={12} />}
                更新
              </button>
            </div>
          )}

          <div className="skc-drawer-meta">
            <div className="skc-meta-row">
              <span className="skc-meta-label">目录</span>
              <span className="skc-meta-value skc-mono">{skill.directory}</span>
            </div>
            <div className="skc-meta-row">
              <span className="skc-meta-label">来源</span>
              <span className="skc-meta-value">
                {sourceHref ? (
                  <a href={sourceHref} target="_blank" rel="noopener noreferrer">
                    GitHub · {sourceLabel}
                    <ExternalLink size={10} />
                  </a>
                ) : skill.native ? (
                  "原生技能 · Claude 技能目录"
                ) : skill.managed ? (
                  "本地导入（KKCODER 管理副本）"
                ) : (
                  "本地扫描（代理技能目录）"
                )}
              </span>
            </div>
            {rawPath && (
              <div className="skc-meta-row">
                <span className="skc-meta-label">位置</span>
                <span className="skc-meta-value skc-mono" title={rawPath}>
                  {rawPath}
                </span>
              </div>
            )}
            {skill.readmeUrl && (
              <div className="skc-meta-row">
                <span className="skc-meta-label">说明</span>
                <span className="skc-meta-value">
                  <a href={skill.readmeUrl} target="_blank" rel="noopener noreferrer">
                    打开 README
                    <ExternalLink size={10} />
                  </a>
                </span>
              </div>
            )}
            <div className="skc-meta-row">
              <span className="skc-meta-label">管理</span>
              <span className="skc-meta-value">
                {skill.native
                  ? "原生技能 · 直接位于 Claude 技能目录"
                  : skill.managed === false
                    ? "本地技能 · 来自其他目录"
                    : skill.repoOwner && skill.repoName
                      ? `来自仓库 ${skill.repoOwner}/${skill.repoName}`
                      : "KKCODER 统一管理"}
              </span>
            </div>
          </div>

          {/* 详细介绍：汉化版 = 大模型撰写的介绍；原版 = SKILL.md 正文 */}
          {(skill.fullDescription || "").trim() && (
            <div className="skc-drawer-section">
              <div className="skc-drawer-section-title">详细介绍</div>
              <div className="skc-drawer-full">{getFullDescription(skill)}</div>
            </div>
          )}

          <div className="skc-drawer-section">
            <div className="skc-drawer-section-title">使用统计</div>
            <div className="skc-drawer-stats">
              <div className="skc-stat">
                <div className="skc-stat-value">{hasUsage ? (usage?.invocations || 0).toLocaleString() : "—"}</div>
                <div className="skc-stat-label">调用次数</div>
              </div>
              <div className="skc-stat">
                <div className="skc-stat-value">{hasUsage ? formatRelativeTime(usage?.lastUsedAt) : "—"}</div>
                <div className="skc-stat-label">最近使用</div>
              </div>
            </div>
            {!hasUsage && <div className="skc-drawer-hint">该技能还没有被调用过（数据来自 ~/.claude/projects 日志）</div>}
          </div>

          <div className="skc-drawer-section">
            <div className="skc-drawer-section-title">启用状态</div>
            <div className="skc-drawer-targets">
              <div className="skc-drawer-target">
                <span
                  className={`skc-chip-dot ${orphan ? "is-orphan" : enabled ? "is-synced" : "is-off"}`}
                  style={enabled || orphan ? { backgroundColor: AGENT_DOT_TONE.claude } : undefined}
                />
                <span className="skc-drawer-target-label">Claude</span>
                <span className="skc-drawer-target-state">
                  {orphan ? "副本丢失" : enabled ? "已启用" : "未启用"}
                </span>
                <button
                  type="button"
                  className={`skc-btn skc-btn-ghost skc-drawer-toggle${enabled ? " is-on" : ""}`}
                  disabled={toggleBusy}
                  onClick={() => onToggleEnabled(skill, !enabled)}
                  title={
                    orphan
                      ? "副本丢失：点击重新同步"
                      : enabled
                        ? "停用：只移除副本，源技能保留"
                        : "启用：同步到 Claude 技能目录"
                  }
                >
                  {toggleBusy ? <Loader2 size={12} className="skc-spin" /> : enabled ? "停用" : "启用"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="skc-drawer-foot">
          <button
            type="button"
            className="skc-btn skc-btn-danger skc-drawer-danger"
            disabled={removing}
            onClick={() => onRemove(skill)}
            title={
              skill.managed
                ? "卸载：移出 KKCODER 托管库并移入回收站，5 分钟内可恢复"
                : "移除：移入停用区保留（源文件不删除），可随时重新启用"
            }
          >
            <Trash2 size={12} />
            <span className="skc-drawer-danger-label">移除技能</span>
            <span className="skc-drawer-danger-note">
              {skill.managed
                ? "移入回收站 · 5 分钟可恢复"
                : "移入停用区 · 源文件保留"}
            </span>
          </button>
          <button
            type="button"
            className="skc-btn skc-btn-danger-soft skc-drawer-danger"
            disabled={removing}
            onClick={() => onBlacklist(skill)}
            title="屏蔽：移出列表且以后不再扫描引用（源文件保留），可在黑名单中随时恢复"
          >
            <Ban size={12} />
            <span className="skc-drawer-danger-label">屏蔽</span>
            <span className="skc-drawer-danger-note">文件保留 · 不再扫描 · 可恢复</span>
          </button>
        </div>
      </aside>
    </div>
  );
}
