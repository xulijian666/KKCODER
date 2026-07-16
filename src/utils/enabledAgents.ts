export type AgentType = "claude" | "pi" | "codex";

export const ENABLED_AGENTS_KEY = "kkcoder_setting_enabled_agents";
export const ENABLED_AGENTS_CHANGE_EVENT = "kkcoder-enabled-agents-change";

export type EnabledAgents = {
  claude: true;
  pi: boolean;
  codex: boolean;
};

export const DEFAULT_ENABLED_AGENTS: EnabledAgents = {
  claude: true,
  pi: false,
  codex: false,
};

export function resolveEnabledAgents(raw: string | null): EnabledAgents {
  if (!raw) return { ...DEFAULT_ENABLED_AGENTS };
  try {
    const parsed = JSON.parse(raw) as Partial<Record<AgentType, unknown>>;
    return {
      claude: true,
      pi: parsed.pi === true,
      codex: parsed.codex === true,
    };
  } catch {
    return { ...DEFAULT_ENABLED_AGENTS };
  }
}

export function loadEnabledAgents(): EnabledAgents {
  try {
    return resolveEnabledAgents(localStorage.getItem(ENABLED_AGENTS_KEY));
  } catch {
    return { ...DEFAULT_ENABLED_AGENTS };
  }
}

export function saveEnabledAgents(value: EnabledAgents): void {
  const normalized: EnabledAgents = {
    claude: true,
    pi: value.pi === true,
    codex: value.codex === true,
  };
  localStorage.setItem(ENABLED_AGENTS_KEY, JSON.stringify(normalized));
  window.dispatchEvent(
    new CustomEvent(ENABLED_AGENTS_CHANGE_EVENT, { detail: normalized }),
  );
}

export function getVisibleAgents(enabled: EnabledAgents): AgentType[] {
  const agents: AgentType[] = ["claude"];
  if (enabled.pi) agents.push("pi");
  if (enabled.codex) agents.push("codex");
  return agents;
}

export function isAgentEnabled(agent: AgentType, enabled: EnabledAgents): boolean {
  if (agent === "claude") return true;
  if (agent === "pi") return enabled.pi === true;
  if (agent === "codex") return enabled.codex === true;
  return false;
}
