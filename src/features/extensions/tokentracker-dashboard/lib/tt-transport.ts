// Vendored addition (not from upstream): Tauri transport for the embedded
// TokenTracker dashboard. Upstream `lib/api.ts` fetched same-origin
// `/functions/<slug>` from the CLI's embedded HTTP server; that server sends
// no CORS headers, so inside the desktop app all dashboard traffic goes
// through the Rust proxy command instead.
//
// Rust command contract (implemented in src-tauri/src/tokentracker.rs):
//   invoke("tt_proxy", { method, path, headers, body })
//   - `path` (query string included) must start with
//     "/functions/tokentracker-" or equal "/api/local-auth" (allowlisted).
//   - `body` is a JSON *string* (or null) — serialize before invoking.
//   - On HTTP 2xx the command resolves with the parsed JSON response body
//     directly (no envelope). On non-2xx it rejects with a string message
//     containing "HTTP <status>", which we re-throw as an Error with a
//     numeric `.status` so hooks keep working unchanged (they only ever
//     inspect err.status / err.message).
//
// Browser dev preview fallback: when not running inside Tauri
// ("__TAURI_INTERNALS__" not on window) requests go to `/tt-dev<path>` via
// plain fetch — a vite dev proxy (configured separately) forwards them to a
// locally running `tokentracker` server.

import { invoke } from "@tauri-apps/api/core";

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function httpError(status: number): Error & { status?: number } {
  const err: any = new Error(`Request failed with HTTP ${status}`);
  err.status = status;
  return err;
}

async function ttRequestViaTauri(
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<any> {
  try {
    return await invoke("tt_proxy", {
      method,
      path,
      headers: headers ?? null,
      body: body != null ? JSON.stringify(body) : null,
    });
  } catch (error) {
    const message = typeof error === "string" ? error : String((error as any)?.message ?? error);
    const match = message.match(/HTTP (\d{3})/);
    if (match) {
      throw httpError(Number(match[1]));
    }
    throw error;
  }
}

async function ttRequestViaDevFetch(
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<any> {
  const response = await fetch(`/tt-dev${path}`, {
    method,
    headers: { Accept: "application/json", ...headers },
    body: body != null ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!response.ok) {
    throw httpError(response.status);
  }
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_e) {
    return text;
  }
}

export async function ttRequest(
  method: string,
  path: string,
  headers?: Record<string, string>,
  body?: unknown,
): Promise<any> {
  if (isTauriRuntime()) {
    return ttRequestViaTauri(method, path, headers, body);
  }
  return ttRequestViaDevFetch(method, path, headers, body);
}

export async function ttGet(path: string): Promise<any> {
  return ttRequest("GET", path, { Accept: "application/json" });
}
