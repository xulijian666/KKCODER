/**
 * HTML 预览资源内联：把本地相对引用（CSS / JS / 图片 / CSS url() / @import）
 * 通过 Tauri 读取后内联进单一 srcdoc，让 iframe 预览在无法访问 file:// 的沙箱里
 * 也能渲染常规静态页。外部 http(s) 与 data:/blob: 引用原样保留。
 */
import { invoke } from "@tauri-apps/api/core";

const MAX_INLINE_RESOURCES = 40;
const MAX_CSS_BYTES = 1024 * 1024;
const MAX_SCRIPT_BYTES = 1024 * 1024;
const MAX_CSS_IMPORT_DEPTH = 3;

export interface InlineHtmlPreviewResult {
  html: string;
  unresolvedCount: number;
  blockedScriptCount: number;
}

interface InlineCounters {
  unresolved: number;
  blockedScriptCount: number;
}

const ASSET_MIME_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  jpe: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  avif: "image/avif",
  svg: "image/svg+xml",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  eot: "application/vnd.ms-fontobject",
};

function extensionOf(relativePath: string): string {
  const name = relativePath.split(/[/\\]/).pop() || relativePath;
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

function isExternalReference(value: string): boolean {
  return (
    !value ||
    value.startsWith("//") ||
    /^(?:https?|data|blob|mailto|javascript):/i.test(value)
  );
}

/** 把相对 URL 解析成项目内相对路径；以 / 开头视为项目根目录。无法安全解析返回 null */
function resolveProjectPath(baseFilePath: string, reference: string): string | null {
  const clean = reference.trim().split(/[?#]/, 1)[0].trim();
  if (!clean || isExternalReference(clean)) return null;

  if (clean.startsWith("/")) {
    return clean.replace(/^\/+/, "");
  }

  const segments = baseFilePath.replace(/\\/g, "/").split("/");
  segments.pop(); // 当前文件目录
  for (const segment of clean.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) return null;
      segments.pop();
    } else {
      segments.push(segment);
    }
  }
  return segments.join("/");
}

async function readText(projectPath: string, relativePath: string): Promise<string | null> {
  try {
    return await invoke<string>("read_project_file_content", { projectPath, relativePath });
  } catch {
    return null;
  }
}

async function readDataUrl(projectPath: string, relativePath: string): Promise<string | null> {
  try {
    const base64 = await invoke<string>("read_project_file_base64", {
      projectPath,
      relativePath,
    });
    const mime = ASSET_MIME_BY_EXTENSION[extensionOf(relativePath)];
    if (!mime) return null;
    return `data:${mime};base64,${base64}`;
  } catch {
    return null;
  }
}

async function inlineCssUrlReferences(
  css: string,
  projectPath: string,
  cssPath: string,
  counters: InlineCounters,
): Promise<string> {
  const pattern = /url\(\s*(['"]?)([^'")]+)\1\s*\)/g;
  const replacements: Array<{ index: number; length: number; value: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(css))) {
    const [full, , rawUrl] = match;
    const resolved = resolveProjectPath(cssPath, rawUrl);
    if (!resolved) continue;
    const dataUrl = await readDataUrl(projectPath, resolved);
    if (dataUrl) {
      replacements.push({
        index: match.index,
        length: full.length,
        value: `url("${dataUrl}")`,
      });
    } else {
      counters.unresolved += 1;
    }
  }

  let result = css;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i];
    result =
      result.slice(0, replacement.index) +
      replacement.value +
      result.slice(replacement.index + replacement.length);
  }
  return result;
}

async function inlineCssImports(
  css: string,
  projectPath: string,
  cssPath: string,
  counters: InlineCounters,
  depth: number,
): Promise<string> {
  if (depth >= MAX_CSS_IMPORT_DEPTH) return css;
  const pattern = /@import\s+(?:url\(\s*)?['"]?([^'")]+)['"]?\s*\)?\s*[^;]*;/g;
  const replacements: Array<{ index: number; length: number; value: string }> = [];
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(css))) {
    const [full, rawUrl] = match;
    const resolved = resolveProjectPath(cssPath, rawUrl);
    if (!resolved) continue;
    const importedCss = await readText(projectPath, resolved);
    if (!importedCss || new TextEncoder().encode(importedCss).length > MAX_CSS_BYTES) {
      counters.unresolved += 1;
      continue;
    }
    const nested = await inlineCssImports(
      importedCss,
      projectPath,
      resolved,
      counters,
      depth + 1,
    );
    const withUrls = await inlineCssUrlReferences(nested, projectPath, resolved, counters);
    replacements.push({ index: match.index, length: full.length, value: withUrls });
  }

  let result = css;
  for (let i = replacements.length - 1; i >= 0; i--) {
    const replacement = replacements[i];
    result =
      result.slice(0, replacement.index) +
      replacement.value +
      result.slice(replacement.index + replacement.length);
  }
  return result;
}

async function readAndInlineStylesheet(
  projectPath: string,
  resolvedPath: string,
  counters: InlineCounters,
): Promise<string | null> {
  const css = await readText(projectPath, resolvedPath);
  if (!css || new TextEncoder().encode(css).length > MAX_CSS_BYTES) return null;
  const withImports = await inlineCssImports(css, projectPath, resolvedPath, counters, 0);
  return inlineCssUrlReferences(withImports, projectPath, resolvedPath, counters);
}

/**
 * 构建可用于 iframe srcdoc 的 HTML 文档。
 * allowScripts=false 时本地 <script src> 保持原样但被 sandbox 拦截（VS Code untrusted 预览语义）。
 */
export async function buildInlineHtmlPreview(
  html: string,
  projectPath: string,
  filePath: string,
  allowScripts: boolean,
): Promise<InlineHtmlPreviewResult> {
  const counters: InlineCounters = { unresolved: 0, blockedScriptCount: 0 };
  const doc = new DOMParser().parseFromString(html, "text/html");
  let inlineCount = 0;

  const stylesheets = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"][href]'),
  );
  for (const link of stylesheets) {
    if (inlineCount >= MAX_INLINE_RESOURCES) {
      counters.unresolved += 1;
      continue;
    }
    const resolved = resolveProjectPath(filePath, link.getAttribute("href") || "");
    if (!resolved) continue;
    const inlined = await readAndInlineStylesheet(projectPath, resolved, counters);
    if (!inlined) {
      counters.unresolved += 1;
      continue;
    }
    const style = doc.createElement("style");
    style.setAttribute("data-kkcoder-inline", "css");
    const media = link.getAttribute("media");
    if (media) style.setAttribute("media", media);
    style.textContent = inlined;
    link.replaceWith(style);
    inlineCount += 1;
  }

  const scripts = Array.from(doc.querySelectorAll<HTMLScriptElement>("script[src]"));
  for (const script of scripts) {
    const src = script.getAttribute("src") || "";
    if (isExternalReference(src)) {
      if (!allowScripts) counters.blockedScriptCount += 1;
      continue;
    }
    if (!allowScripts) {
      counters.blockedScriptCount += 1;
      continue;
    }
    if (inlineCount >= MAX_INLINE_RESOURCES) {
      counters.unresolved += 1;
      continue;
    }
    const resolved = resolveProjectPath(filePath, src);
    if (!resolved) {
      counters.unresolved += 1;
      continue;
    }
    const code = await readText(projectPath, resolved);
    if (!code || new TextEncoder().encode(code).length > MAX_SCRIPT_BYTES) {
      counters.unresolved += 1;
      continue;
    }
    const inlineScript = doc.createElement("script");
    const type = script.getAttribute("type");
    if (type) inlineScript.setAttribute("type", type);
    inlineScript.textContent = code;
    script.replaceWith(inlineScript);
    inlineCount += 1;
  }

  const images = Array.from(doc.querySelectorAll<HTMLElement>("img[src], source[src]"));
  for (const image of images) {
    const src = image.getAttribute("src") || "";
    if (isExternalReference(src)) continue;
    if (inlineCount >= MAX_INLINE_RESOURCES) {
      counters.unresolved += 1;
      continue;
    }
    const resolved = resolveProjectPath(filePath, src);
    if (!resolved) continue;
    const dataUrl = await readDataUrl(projectPath, resolved);
    if (!dataUrl) {
      counters.unresolved += 1;
      continue;
    }
    image.setAttribute("src", dataUrl);
    inlineCount += 1;
  }

  const doctype = doc.doctype ? `<!DOCTYPE ${doc.doctype.name}>\n` : "";
  return {
    html: `${doctype}${doc.documentElement.outerHTML}`,
    unresolvedCount: counters.unresolved,
    blockedScriptCount: counters.blockedScriptCount,
  };
}
