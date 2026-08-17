import React, { useState } from "react";

export function splitProjectKey(value) {
  if (typeof value !== "string" || !value) return { owner: "", repo: "" };
  const idx = value.indexOf("/");
  if (idx < 0) return { owner: "", repo: value };
  return { owner: value.slice(0, idx), repo: value.slice(idx + 1) };
}

export function projectRefHost(projectRef) {
  try {
    return new URL(projectRef).hostname.toLowerCase();
  } catch {
    return "";
  }
}

// Single host→forge classifier so the avatar and the host icon can never
// disagree about what counts as GitHub. The hostname alone can't prove a
// self-hosted forge, but git.<company>.com is conventionally GitLab.
export function forgeKindFromHost(host) {
  if (!host) return "";
  if (host === "github.com" || host.endsWith(".github.com")) return "github";
  if (host.includes("gitlab") || host.startsWith("git.")) return "gitlab";
  return "generic";
}

// Only GitHub refs get an owner avatar — github.com/{owner}.png is a
// static image URL (no API quota). Non-GitHub hosts (self-hosted GitLab
// etc.) must NOT be mapped onto a same-named GitHub user's avatar.
export function githubOwnerFor(projectRef, owner) {
  if (!owner) return "";
  return forgeKindFromHost(projectRefHost(projectRef)) === "github" ? owner : "";
}

export function ProjectAvatar({ githubOwner, letter, size = "w-9 h-9" }) {
  const [imageFailed, setImageFailed] = useState(false);
  if (githubOwner && !imageFailed) {
    return (
      <img
        src={`https://github.com/${githubOwner}.png?size=80`}
        alt=""
        loading="lazy"
        onError={() => setImageFailed(true)}
        className={`${size} tt-project-avatar rounded-xl object-cover bg-white/5 border border-[var(--border-color)] flex-shrink-0`}
      />
    );
  }
  return (
    <div
      className={`${size} tt-project-avatar-fallback rounded-xl flex items-center justify-center font-mono font-bold text-xs flex-shrink-0`}
    >
      {letter}
    </div>
  );
}
