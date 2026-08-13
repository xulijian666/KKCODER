/**
 * 助手启用状态。
 * Pi / Codex 集成已移除，当前唯一助手为 Claude Code，恒启用。
 * 保留本模块的导出契约（localStorage key / 事件 / 函数名），兼容旧存储数据与调用方。
 */
export type AgentType = "claude";

export const ENABLED_AGENTS_KEY = "kkcoder_setting_enabled_agents";
export const ENABLED_AGENTS_CHANGE_EVENT = "kkcoder-enabled-agents-change";

export type EnabledAgents = {
  claude: true;
};

export const DEFAULT_ENABLED_AGENTS: EnabledAgents = { claude: true };

export function resolveEnabledAgents(_raw: string | null): EnabledAgents {
  return { claude: true };
}

export function loadEnabledAgents(): EnabledAgents {
  return { claude: true };
}

export function saveEnabledAgents(_value: EnabledAgents): void {
  localStorage.setItem(ENABLED_AGENTS_KEY, JSON.stringify({ claude: true }));
  window.dispatchEvent(
    new CustomEvent(ENABLED_AGENTS_CHANGE_EVENT, { detail: { claude: true } }),
  );
}

export function getVisibleAgents(_enabled: EnabledAgents): AgentType[] {
  return ["claude"];
}

export function isAgentEnabled(agent: AgentType, _enabled: EnabledAgents): boolean {
  return agent === "claude";
}
