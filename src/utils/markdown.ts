/**
 * Markdown → HTML（marked + Prism）
 * - GFM：表格 / 任务列表 / 删除线 / 自动链接
 * - 代码块走项目已有 Prism，语言别名可扩展
 * - 输出带 class，样式集中在 CSS，便于主题定制
 */

import { Marked, type Tokens } from "marked";
import Prism from "prismjs";

// 与 highlighter.ts 对齐的常用语言（Prism 需先注册）
import "prismjs/components/prism-markup";
import "prismjs/components/prism-css";
import "prismjs/components/prism-clike";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-java";
import "prismjs/components/prism-python";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-diff";

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
        return (
          `<div class="md-code-block">` +
          label +
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

function slugify(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\w一-鿿\s-]/g, "")
    .replace(/\s+/g, "-")
    .slice(0, 80);
}

const markedInstance = createMarked();

/** 扩展语言别名（渲染前可调用） */
export function registerMarkdownLangAlias(alias: string, prismLang: string): void {
  LANG_ALIASES[alias.toLowerCase()] = prismLang;
}

/**
 * 将 Markdown 渲染为可注入的 HTML 字符串。
 * 样式依赖 `.markdown-body` / `.preview-markdown-content` 下的 CSS。
 */
export function renderMarkdownToHtml(mdText: string): string {
  if (!mdText.trim()) {
    return `<p class="md-empty">文件内容为空</p>`;
  }

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
  }
}
