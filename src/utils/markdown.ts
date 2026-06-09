/**
 * 极简高质感 Markdown 渲染器
 * 支持代码块、行内代码、多级标题、无序列表、段落排版和表格渲染
 */

function renderTableHtml(headers: string[], alignments: ('left' | 'center' | 'right' | null)[], rows: string[][]): string {
  const getStyle = (align: string | null) => align 
    ? `style="text-align: ${align}; padding: 8px 12px; border: 1px solid var(--border-color);"` 
    : `style="padding: 8px 12px; border: 1px solid var(--border-color);"`;

  const headerHtml = headers.map((h, idx) => {
    const align = alignments[idx] || null;
    return `<th ${getStyle(align)}>${h}</th>`;
  }).join('');

  const rowsHtml = rows.map(row => {
    const cellsHtml = row.map((cell, idx) => {
      const align = alignments[idx] || null;
      return `<td ${getStyle(align)}>${cell || ''}</td>`;
    }).join('');
    return `<tr>${cellsHtml}</tr>`;
  }).join('');

  // 移除所有换行符，避免被后续段落换行正则 \n\n 拆解成多个 <p> 标签
  return `<div style="overflow-x: auto; margin: 16px 0;"><table style="border-collapse: collapse; width: 100%; border: 1px solid var(--border-color); font-size: 13px; color: var(--text-primary);"><thead style="background-color: var(--bg-sidebar); font-weight: 600;"><tr>${headerHtml}</tr></thead><tbody>${rowsHtml}</tbody></table></div>`.replace(/\n/g, '');
}

function parseTables(text: string): string {
  const lines = text.split('\n');
  const result: string[] = [];
  let inTable = false;
  let tableHeader: string[] = [];
  let tableAlignments: ('left' | 'center' | 'right' | null)[] = [];
  let tableRows: string[][] = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    // 表格线通常包含 "|"，且不以代码块 "```" 或标题 "#" 开头
    const isTableLine = line.includes('|') && !line.startsWith('```') && !line.startsWith('#');

    if (isTableLine) {
      const rawCells = line.split('|').map(c => c.trim());
      if (line.startsWith('|')) rawCells.shift();
      if (line.endsWith('|')) rawCells.pop();

      if (!inTable) {
        // 探测下一行是否为对齐分隔线（如 |---| 或 |:---| 等）
        const nextLine = lines[i + 1]?.trim() || '';
        const isSeparator = /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/.test(nextLine);

        if (isSeparator) {
          inTable = true;
          tableHeader = rawCells;

          const separatorCells = nextLine.split('|').map(c => c.trim());
          if (nextLine.startsWith('|')) separatorCells.shift();
          if (nextLine.endsWith('|')) separatorCells.pop();

          tableAlignments = separatorCells.map(cell => {
            const left = cell.startsWith(':');
            const right = cell.endsWith(':');
            if (left && right) return 'center';
            if (right) return 'right';
            if (left) return 'left';
            return null;
          });

          tableRows = [];
          i++; // 跳过对齐线
        } else {
          result.push(lines[i]);
        }
      } else {
        tableRows.push(rawCells);
      }
    } else {
      if (inTable) {
        result.push(renderTableHtml(tableHeader, tableAlignments, tableRows));
        inTable = false;
      }
      result.push(lines[i]);
    }
  }

  if (inTable) {
    result.push(renderTableHtml(tableHeader, tableAlignments, tableRows));
  }

  return result.join('\n');
}

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

  // 2. 表格解析
  escaped = parseTables(escaped);

  // 3. 单行行内代码 `code` 替换
  escaped = escaped.replace(/`([^`]+)`/g, '<code style="background: rgba(0,0,0,0.15); padding: 2px 5px; border-radius: 4px; font-family: monospace; font-size: 12.5px; color: var(--color-orange);">$1</code>');

  // 4. 标题 (#, ##, ###)
  escaped = escaped.replace(/^### (.*$)/gim, '<h3 style="font-size: 15px; font-weight: 700; margin: 16px 0 8px 0; color: var(--text-primary); border-left: 3px solid var(--color-primary); padding-left: 8px;">$1</h3>');
  escaped = escaped.replace(/^## (.*$)/gim, '<h2 style="font-size: 17px; font-weight: 700; margin: 20px 0 10px 0; color: var(--text-primary); border-bottom: 1px solid var(--border-color); padding-bottom: 4px;">$1</h2>');
  escaped = escaped.replace(/^# (.*$)/gim, '<h1 style="font-size: 20px; font-weight: 800; margin: 24px 0 12px 0; color: var(--text-primary); border-bottom: 2px solid var(--border-color); padding-bottom: 6px;">$1</h1>');

  // 5. 无序列表 (- or *)
  escaped = escaped.replace(/^\s*[-*]\s+(.*$)/gim, '<li style="margin: 6px 0; padding-left: 4px; color: var(--text-primary); list-style-type: disc; margin-left: 20px;">$1</li>');

  // 6. 段落（空白行分隔）
  escaped = escaped.replace(/\n\n/g, "</p><p>");
  escaped = `<p style="line-height: 1.6; font-size: 13.5px; color: var(--text-primary);">${escaped}</p>`;

  return escaped;
}
