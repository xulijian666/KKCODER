// Vendored from upstream src/lib/skills-api.ts; transport adapted for the
// desktop app:
//   - Tauri runtime → built-in Rust backend (`skills_hub_query` /
//     `skills_hub_mutate` commands in src-tauri/src/skills_hub.rs) — the
//     skills module is fully self-contained, no tokentracker-cli needed.
//   - Browser dev preview (non-Tauri) → same `/tt-dev` proxy fallback as
//     tt-transport, talking to a locally running `tokentracker serve`.
// Response/error shapes stay 1:1 with the upstream HTTP endpoint.
import { invoke } from "@tauri-apps/api/core";

import { getLocalApiAuthHeaders } from "./local-api-auth";
import { isTauriRuntime, ttGet, ttRequest } from "./tt-transport";

type AnyRecord = Record<string, any>;

const SLUG = "tokentracker-skills";
const PATH = `/functions/${SLUG}`;

function toQueryString(params?: AnyRecord): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== "") search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(typeof error === "string" ? error : String((error as any)?.message ?? error));
}

async function fetchSkillsJson(params?: AnyRecord) {
  if (isTauriRuntime()) {
    const { mode = "installed", ...rest } = params ?? {};
    // upstream HTTP 语义里 force 是字符串 "1"；invoke 直接传 JSON，这里显式
    // 字符串化，offset/limit 保持 number。
    const queryParams: AnyRecord = { ...rest };
    if (queryParams.force != null && queryParams.force !== "") {
      queryParams.force = String(queryParams.force);
    }
    try {
      return await invoke("skills_hub_query", { mode: String(mode), params: queryParams });
    } catch (error) {
      throw toError(error);
    }
  }
  return ttGet(`${PATH}${toQueryString(params)}`);
}

async function mutateSkillsJson(body: AnyRecord) {
  if (isTauriRuntime()) {
    const { action, ...payload } = body;
    let result: any;
    try {
      result = await invoke("skills_hub_mutate", { action: String(action), payload });
    } catch (error) {
      throw toError(error);
    }
    if (result?.ok === false) {
      throw new Error(result?.error || "Request failed");
    }
    return result;
  }
  const authHeaders = await getLocalApiAuthHeaders();
  const payload = await ttRequest("POST", PATH, authHeaders, body);
  if (payload?.ok === false) {
    throw new Error(payload?.error || "Request failed");
  }
  return payload;
}

export function getInstalledSkills() {
  return fetchSkillsJson({ mode: "installed" });
}

export function discoverSkills(options: { force?: boolean } = {}) {
  return fetchSkillsJson({ mode: "discover", ...(options.force ? { force: 1 } : {}) });
}

export function searchSkills(query: string, offset = 0, limit = 20) {
  return fetchSkillsJson({ mode: "search", q: query, offset, limit });
}

export function getSkillRepos() {
  return fetchSkillsJson({ mode: "repos" });
}

export function installSkill(skill: AnyRecord, targets: string[]) {
  return mutateSkillsJson({ action: "install", skill, targets });
}

export function uninstallSkill(id: string) {
  return mutateSkillsJson({ action: "uninstall", id });
}

export function restoreSkill(id: string) {
  return mutateSkillsJson({ action: "restore", id });
}

export function setSkillTargets(id: string, targets: string[]) {
  return mutateSkillsJson({ action: "set_targets", id, targets });
}

export function importLocalSkill(directory: string, targets: string[]) {
  return mutateSkillsJson({ action: "import_local", directory, targets });
}

export function deleteLocalSkill(directory: string, targets?: string[]) {
  return mutateSkillsJson({ action: "delete_local", directory, targets: targets || [] });
}

export function addSkillRepo(repo: AnyRecord) {
  return mutateSkillsJson({ action: "add_repo", repo });
}

export function removeSkillRepo(owner: string, name: string) {
  return mutateSkillsJson({ action: "remove_repo", owner, name });
}

export function getPopularSkills(options: { force?: boolean } = {}) {
  return fetchSkillsJson({ mode: "popular", ...(options.force ? { force: 1 } : {}) });
}

export function checkSkillUpdates(options: { force?: boolean } = {}) {
  return fetchSkillsJson({ mode: "updates", ...(options.force ? { force: 1 } : {}) });
}

export function getSkillActivity(limit = 50) {
  return fetchSkillsJson({ mode: "activity", limit });
}

export function getSkillUsage(options: { force?: boolean } = {}) {
  return fetchSkillsJson({ mode: "skill_usage", ...(options.force ? { force: 1 } : {}) });
}
