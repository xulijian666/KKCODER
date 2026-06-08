/**
 * 极简高质感 Markdown 渲染器
 * 支持代码块、行内代码、多级标题、无序列表和段落排版
 */
export function renderMarkdownToHtml(mdText: string): string {
  if (!mdText.trim()) {
    return `<p style="color: var(--text-secondary); font-style: italic; font-size: 13px;">文件内容为空</p>`;
  }

  // 简单高效的安全 HTML 转义防止 XSS
  let escaped = mdText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // 1. 代码块 ``` 替换
  escaped = escaped.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre style="background: rgba(0,0,0,0.25); padding: 10px; border-radius: 6px; border: 1px solid var(--border-color); font-family: monospace; font-size: 12.5px; overflow-x: auto; margin: 12px 0; color: var(--text-primary);"><code style="white-space: pre-wrap;">${code.trim()}</code></pre>`;
  });

  // 2. 单行行内代码 `code` 替换
  escaped = escaped.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.15); padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 12.5px; color: var(--color-orange);">$1</code>');

  // 3. 标题 (#, ##, ###)
  escaped = escaped.replace(/^### (.*$)/gim, '<h3 style="font-size: 15px; font-weight: 700; margin: 16px 0 8px 0; color: var(--text-primary); border-left: 3px solid var(--color-primary); padding-left: 8px;">$1</h3>');
  escaped = escaped.replace(/^## (.*$)/gim, '<h2 style="font-size: 17px; font-weight: 700; margin: 20px 0 10px 0; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">$1</h2>');
  escaped = escaped.replace(/^# (.*$)/gim, '<h1 style="font-size: 20px; font-weight: 800; margin: 24px 0 12px 0; color: var(--text-primary); border-bottom: 2px solid var(--border-color); padding-bottom: 6px;">$1</h1>');

  // 4. 无序列表 (- or *)
  escaped = escaped.replace(/^\s*[-*]\s+(.*$)/gim, '<li style="margin: 6px 0; padding-left: 4px; color: var(--text-primary); list-style-type: disc; margin-left: 20px;">$1</li>');

  // 5. 段落（空白行分隔）
  escaped = escaped.replace(/\n\n/g, "</p><p>");
  escaped = `<p style="line-height: 1.6; font-size: 13.5px; color: var(--text-primary);">${escaped}</p>`;

  return escaped;
}
