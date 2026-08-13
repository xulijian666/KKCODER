/**
 * Markdown → HTML（marked + Prism）
 * - GFM：表格 / 任务列表 / 删除线 / 自动链接
 * - 代码块走项目已有 Prism，语言别名可扩展
 * - 输出带 class，样式集中在 CSS，便于主题定制
 */

import { Marked, type Tokens } from "marked";
import Prism from "prismjs";
import { MAX_MARKDOWN_SIZE, MAX_MARKDOWN_LINES, slugify } from "./markdownToc.ts";
import { log } from "./log.ts";

export { buildMarkdownToc, type MarkdownTocEntry } from "./markdownToc.ts";

// 与 highlighter.ts 对齐的常用语言（Prism 需先注册）
import "prismjs/components/prism-markup.js";
import "prismjs/components/prism-css.js";
import "prismjs/components/prism-clike.js";
import "prismjs/components/prism-javascript.js";
import "prismjs/components/prism-typescript.js";
import "prismjs/components/prism-java.js";
import "prismjs/components/prism-python.js";
import "prismjs/components/prism-go.js";
import "prismjs/components/prism-rust.js";
import "prismjs/components/prism-json.js";
import "prismjs/components/prism-yaml.js";
import "prismjs/components/prism-toml.js";
import "prismjs/components/prism-bash.js";
import "prismjs/components/prism-sql.js";
import "prismjs/components/prism-markdown.js";
import "prismjs/components/prism-diff.js";

// HTML 代码块「预览/源码」切换：仅当体积可控时启用 iframe 预览
const MAX_HTML_PREVIEW_SIZE = 50 * 1024;
const MAX_HTML_PREVIEW_LINES = 1000;
// radio id 完全确定性：key = 渲染输入的内容 hash，序号 = 该次渲染内代码块序号。
// 相同消息无论渲染多少次都生成相同的 id/name，DOM 不会因 id 变化被 React 重新注入，
// 「源码/预览」切换状态得以保留（即使 LRU 缓存被清空也稳定）。
let currentRenderKey = "";
let htmlBlockSeqInRender = 0;

function hashString(text: string): string {
  let hash = 5381;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash << 5) + hash + text.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

const LANG_ALIASES: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  py: "python",
  rs: "rust",
  sh: "bash",
  shell: "bash",
  zsh: "bash",
  yml: "yaml",
  html: "markup",
  xml: "markup",
  svg: "markup",
  md: "markdown",
  plaintext: "plain",
  text: "plain",
  txt: "plain",
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeChatUrl(rawUrl: string): string | null {
  const value = rawUrl.trim();
  if (/^(https?:|mailto:)/i.test(value) || value.startsWith("#")) {
    return value;
  }
  return null;
}

function resolveLang(raw?: string): string {
  if (!raw) return "plain";
  const key = raw.trim().toLowerCase().split(/[\s,:{]/)[0] || "plain";
  return LANG_ALIASES[key] || key;
}

function highlightCode(code: string, lang: string): string {
  const language = resolveLang(lang);
  try {
    if (language !== "plain" && Prism.languages[language]) {
      return Prism.highlight(code, Prism.languages[language], language);
    }
  } catch {
    // fall through
  }
  return escapeHtml(code);
}

function createMarked(): Marked {
  const marked = new Marked();

  marked.setOptions({
    gfm: true,
    breaks: false,
    pedantic: false,
  });

  marked.use({
    renderer: {
      code({ text, lang, escaped }: Tokens.Code): string {
        const language = resolveLang(lang);
        // marked 在 escaped=true 时已 HTML 转义，高亮前需还原
        const raw = escaped
          ? text
              .replace(/&lt;/g, "<")
              .replace(/&gt;/g, ">")
              .replace(/&quot;/g, '"')
              .replace(/&#39;/g, "'")
              .replace(/&amp;/g, "&")
          : text;
        const highlighted = highlightCode(raw, language);
        const langClass = language !== "plain" ? ` language-${language}` : "";
        const label =
          language !== "plain"
            ? `<span class="md-code-lang">${escapeHtml(language)}</span>`
            : "";
        // HTML 代码块（html/xml/svg 等 markup 语言）：支持「预览/源码」右上角切换。
        // 用 radio + label 纯 CSS 切换（点击 label 即切换 radio，无 JS 依赖）
        if (
          language === "markup" &&
          raw.length <= MAX_HTML_PREVIEW_SIZE &&
          raw.split("\n").length <= MAX_HTML_PREVIEW_LINES
        ) {
          const srcdoc = escapeHtml(raw);
          const uid = `hpv-${currentRenderKey}-${++htmlBlockSeqInRender}`;
          return (
            `<div class="md-html-preview">` +
            `<input type="radio" class="md-html-preview-radio md-html-preview-radio-pv" name="${uid}" id="${uid}-pv" checked />` +
            `<input type="radio" class="md-html-preview-radio md-html-preview-radio-src" name="${uid}" id="${uid}-src" />` +
            `<div class="md-html-preview-bar">` +
            label +
            `<span class="md-html-preview-tabs">` +
            `<label class="md-html-preview-tab md-html-preview-tab-pv" for="${uid}-pv">预览</label>` +
            `<label class="md-html-preview-tab md-html-preview-tab-src" for="${uid}-src">源码</label>` +
            `</span>` +
            `<button type="button" class="md-code-copy" title="复制代码">复制</button>` +
            `</div>` +
            `<iframe class="md-html-preview-frame" sandbox="" srcdoc="${srcdoc}" title="HTML 预览"></iframe>` +
            `<pre class="md-pre md-html-preview-source"><code class="md-code${langClass}">${highlighted}</code></pre>` +
            `</div>`
          );
        }
        return (
          `<div class="md-code-block">` +
          `<div class="md-code-head">` +
          label +
          `<button type="button" class="md-code-copy" title="复制代码">复制</button>` +
          `</div>` +
          `<pre class="md-pre"><code class="md-code${langClass}">${highlighted}</code></pre>` +
          `</div>`
        );
      },

      codespan({ text }: Tokens.Codespan): string {
        return `<code class="md-inline-code">${escapeHtml(text)}</code>`;
      },

      heading({ tokens, depth }: Tokens.Heading): string {
        // 用 parser 处理行内 token，避免标题里的加粗/代码丢失
        const inner = this.parser.parseInline(tokens);
        const id = slugify(
          tokens
            .map((t) => ("text" in t ? String((t as { text?: string }).text ?? "") : ""))
            .join("")
        );
        return `<h${depth} id="${id}" class="md-h md-h${depth}">${inner}</h${depth}>\n`;
      },

      paragraph({ tokens }: Tokens.Paragraph): string {
        return `<p class="md-p">${this.parser.parseInline(tokens)}</p>\n`;
      },

      blockquote({ tokens }: Tokens.Blockquote): string {
        return `<blockquote class="md-blockquote">${this.parser.parse(tokens)}</blockquote>\n`;
      },

      list(token: Tokens.List): string {
        const tag = token.ordered ? "ol" : "ul";
        const start =
          token.ordered && token.start !== 1 ? ` start="${token.start}"` : "";
        const body = token.items.map((item) => this.listitem(item)).join("");
        const taskClass = token.items.some((i) => i.task) ? " md-task-list" : "";
        return `<${tag} class="md-list${taskClass}"${start}>${body}</${tag}>\n`;
      },

      listitem(item: Tokens.ListItem): string {
        const body = this.parser.parse(item.tokens);
        const cls = item.task ? "md-li md-task" : "md-li";
        return `<li class="${cls}">${body}</li>\n`;
      },

      checkbox({ checked }: Tokens.Checkbox): string {
        return (
          `<input class="md-checkbox" type="checkbox" disabled` +
          `${checked ? " checked" : ""} />`
        );
      },

      table(token: Tokens.Table): string {
        let header = "";
        for (const cell of token.header) {
          header += this.tablecell(cell);
        }
        let body = "";
        for (const row of token.rows) {
          let rowHtml = "";
          for (const cell of row) {
            rowHtml += this.tablecell(cell);
          }
          body += `<tr>${rowHtml}</tr>`;
        }
        return (
          `<div class="md-table-wrap">` +
          `<table class="md-table"><thead><tr>${header}</tr></thead>` +
          `<tbody>${body}</tbody></table></div>\n`
        );
      },

      tablecell(cell: Tokens.TableCell): string {
        const tag = cell.header ? "th" : "td";
        const align = cell.align;
        const style = align ? ` style="text-align:${align}"` : "";
        const inner = this.parser.parseInline(cell.tokens);
        return `<${tag}${style}>${inner}</${tag}>`;
      },

      link({ href, title, tokens }: Tokens.Link): string {
        const text = this.parser.parseInline(tokens);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        const safeHref = escapeHtml(href || "");
        // 外链新窗口；相对路径/锚点保持默认
        const isExternal = /^https?:\/\//i.test(href || "");
        const rel = isExternal ? ` target="_blank" rel="noopener noreferrer"` : "";
        return `<a class="md-link" href="${safeHref}"${titleAttr}${rel}>${text}</a>`;
      },

      image({ href, title, text }: Tokens.Image): string {
        const safeHref = escapeHtml(href || "");
        const alt = escapeHtml(text || "");
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<img class="md-img" src="${safeHref}" alt="${alt}"${titleAttr} loading="lazy" />`;
      },

      hr(): string {
        return `<hr class="md-hr" />\n`;
      },

      strong({ tokens }: Tokens.Strong): string {
        return `<strong class="md-strong">${this.parser.parseInline(tokens)}</strong>`;
      },

      em({ tokens }: Tokens.Em): string {
        return `<em class="md-em">${this.parser.parseInline(tokens)}</em>`;
      },

      del({ tokens }: Tokens.Del): string {
        return `<del class="md-del">${this.parser.parseInline(tokens)}</del>`;
      },
    },
  });

  return marked;
}

const markedInstance = createMarked();

/**
 * 渲染结果 LRU 缓存：相同输入返回完全相同的 HTML 字符串。
 * 目的：HTML 预览块的 radio id 依赖模块级计数器，若每次渲染都重新生成，
 * React 会因 __html 字符串变化而重新注入 DOM，导致「源码/预览」切换状态丢失、
 * iframe 重新加载闪烁。缓存保证同一消息在重渲染时输出稳定。
 */
const markdownRenderCache = new Map<string, string>();
const MARKDOWN_CACHE_MAX = 80;
/** 已记录过 miss 的输入（去重，避免打字时日志刷屏） */
const loggedMissKeys = new Set<string>();
const LOGGED_MISS_MAX = 200;

function cachedRender(mdText: string, render: () => string): string {
  const hit = markdownRenderCache.get(mdText);
  if (hit !== undefined) {
    // LRU：命中即移到末尾
    markdownRenderCache.delete(mdText);
    markdownRenderCache.set(mdText, hit);
    return hit;
  }
  if (!loggedMissKeys.has(mdText)) {
    loggedMissKeys.add(mdText);
    if (loggedMissKeys.size > LOGGED_MISS_MAX) loggedMissKeys.clear();
    log(`[markdown] cache miss len=${mdText.length} head=${mdText.slice(0, 40).replace(/\n/g, "\\n")}`);
  }
  const html = render();
  markdownRenderCache.set(mdText, html);
  if (markdownRenderCache.size > MARKDOWN_CACHE_MAX) {
    const oldest = markdownRenderCache.keys().next().value;
    if (oldest !== undefined) markdownRenderCache.delete(oldest);
  }
  return html;
}

/** 扩展语言别名（渲染前可调用） */
export function registerMarkdownLangAlias(alias: string, prismLang: string): void {
  LANG_ALIASES[alias.toLowerCase()] = prismLang;
}

/**
 * 将 Markdown 渲染为可注入的 HTML 字符串。
 * 样式依赖 `.markdown-body` / `.preview-markdown-content` 下的 CSS。
 */
export function renderMarkdownToHtml(mdText: string): string {
  return cachedRender(mdText, () => {
    if (!mdText.trim()) {
      return `<p class="md-empty">文件内容为空</p>`;
    }

    // 超限时降级为纯文本预览（与 highlighter.ts 同策略），防止解析/高亮卡死主线程
    if (
      mdText.length > MAX_MARKDOWN_SIZE ||
      mdText.split("\n").length > MAX_MARKDOWN_LINES
    ) {
      return (
        `<pre class="md-pre md-fallback"><code class="md-code">` +
        escapeHtml(mdText) +
        `</code></pre>`
      );
    }

    // 确定性 id：当前渲染输入的内容 hash + 块序号（同输入永远同 id）
    currentRenderKey = hashString(mdText);
    htmlBlockSeqInRender = 0;
    try {
      const html = markedInstance.parse(mdText, { async: false }) as string;
      return html;
    } catch (err) {
      console.error("Markdown 渲染失败:", err);
      return (
        `<pre class="md-pre md-fallback"><code class="md-code">` +
        escapeHtml(mdText) +
        `</code></pre>`
      );
    } finally {
      currentRenderKey = "";
    }
  });
}

/**
 * 聊天场景专用渲染：把 Markdown 中的**原始 HTML** 转义为纯文本，
 * 防止 LLM 输出（可能含 prompt injection）注入可执行脚本。
 * 相比 renderMarkdownToHtml，唯一差异是 renderer.html 被覆盖为转义输出。
 */
const chatMarkedInstance = (() => {
  const marked = createMarked();
  marked.use({
    renderer: {
      html(token: Tokens.HTML | Tokens.Tag): string {
        const text = "text" in token ? String(token.text ?? "") : "";
        return `<p class="md-p">${escapeHtml(text)}</p>\n`;
      },
      link({ href, title, tokens }: Tokens.Link): string {
        const text = this.parser.parseInline(tokens);
        const safeUrl = sanitizeChatUrl(href || "");
        if (!safeUrl) return text;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : "";
        return `<a class="md-link" href="${escapeHtml(safeUrl)}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
      },
      image({ href, text }: Tokens.Image): string {
        const safeUrl = sanitizeChatUrl(href || "");
        if (!safeUrl || !/^https?:/i.test(safeUrl)) {
          return escapeHtml(text || "");
        }
        return `<img class="md-img" src="${escapeHtml(safeUrl)}" alt="${escapeHtml(text || "")}" loading="lazy" />`;
      },
    },
  });
  return marked;
})();

export function renderChatMarkdownToHtml(mdText: string): string {
  return cachedRender(mdText, () => {
    if (!mdText.trim()) {
      return "";
    }
    if (
      mdText.length > MAX_MARKDOWN_SIZE ||
      mdText.split("\n").length > MAX_MARKDOWN_LINES
    ) {
      return (
        `<pre class="md-pre md-fallback"><code class="md-code">` +
        escapeHtml(mdText) +
        `</code></pre>`
      );
    }
    // 确定性 id：当前渲染输入的内容 hash + 块序号（同输入永远同 id）
    currentRenderKey = hashString(mdText);
    htmlBlockSeqInRender = 0;
    try {
      return chatMarkedInstance.parse(mdText, { async: false }) as string;
    } catch (err) {
      console.error("Chat Markdown 渲染失败:", err);
      return (
        `<pre class="md-pre md-fallback"><code class="md-code">` +
        escapeHtml(mdText) +
        `</code></pre>`
      );
    } finally {
      currentRenderKey = "";
    }
  });
}
