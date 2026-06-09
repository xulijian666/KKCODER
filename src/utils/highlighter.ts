import Prism from 'prismjs';

// 导入 PrismJS 核心与常用语言支持
import 'prismjs/components/prism-markup';
import 'prismjs/components/prism-css';
import 'prismjs/components/prism-clike';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-java';
import 'prismjs/components/prism-python';
import 'prismjs/components/prism-go';
import 'prismjs/components/prism-rust';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-properties';
import 'prismjs/components/prism-sql';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-batch';
import 'prismjs/components/prism-yaml';
import 'prismjs/components/prism-toml';
import 'prismjs/components/prism-bash';

// 性能上限控制参数
const MAX_HIGHLIGHT_SIZE = 300 * 1024; // 300KB
const MAX_HIGHLIGHT_LINES = 3000; // 3000行

// 为 JSP 注册一个轻量级的高亮扩展（继承自 markup 并强化 <% %> 的 Java 关键字高亮）
if (!Prism.languages.jsp) {
  Prism.languages.jsp = Prism.languages.extend('markup', {
    'jsp-scriptlet': {
      pattern: /<%[\s\S]*?%>/,
      inside: {
        'jsp-tag': {
          pattern: /^<%-?|=?|%>$/,
          alias: 'punctuation'
        },
        'keyword': /\b(auto|break|case|char|const|continue|default|do|double|else|enum|extern|float|for|goto|if|int|long|register|return|short|signed|sizeof|static|struct|switch|typedef|union|unsigned|void|volatile|while|class|interface|import|package|private|protected|public|new|this|super|extends|implements|throws|throw|try|catch|finally|final|transient|volatile|synchronized|native|strictfp|instanceof|assert|boolean|byte|char|double|float|int|long|short)\b/,
        'comment': /\b\/\/.*|(?:\/\*[\s\S]*?\*\/)/
      }
    }
  });
}

export interface HighlightToken {
  type?: string;
  content: string | HighlightToken[];
}

/**
 * 将 Prism.tokenize 输出的扁平 Token 数组，拆分成以“行”为单位的 Token 嵌套结构
 */
export function splitTokensIntoLines(tokens: (string | any)[]): HighlightToken[][] {
  const lines: HighlightToken[][] = [[]];

  function process(token: string | any) {
    if (typeof token === 'string') {
      const parts = token.split('\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) {
          lines.push([]);
        }
        if (parts[i] !== '') {
          lines[lines.length - 1].push({
            content: parts[i]
          });
        }
      }
    } else {
      // 处理 Prism.Token 对象
      if (typeof token.content === 'string') {
        const parts = token.content.split('\n');
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) {
            lines.push([]);
          }
          if (parts[i] !== '') {
            lines[lines.length - 1].push({
              type: token.type,
              content: parts[i]
            });
          }
        }
      } else if (Array.isArray(token.content)) {
        // 递归处理嵌套 Token 数组
        const nestedLines = splitTokensIntoLines(token.content);
        for (let i = 0; i < nestedLines.length; i++) {
          if (i > 0) {
            lines.push([]);
          }
          if (nestedLines[i].length > 0) {
            lines[lines.length - 1].push({
              type: token.type,
              content: nestedLines[i]
            });
          }
        }
      } else {
        // 单个嵌套 Token
        const nestedLines = splitTokensIntoLines([token.content]);
        for (let i = 0; i < nestedLines.length; i++) {
          if (i > 0) {
            lines.push([]);
          }
          if (nestedLines[i].length > 0) {
            lines[lines.length - 1].push({
              type: token.type,
              content: nestedLines[i]
            });
          }
        }
      }
    }
  }

  for (const token of tokens) {
    process(token);
  }

  // 若为空文件，填充一个空行，防止无行号渲染
  if (lines.length === 0) {
    lines.push([{ content: '' }]);
  }

  return lines;
}

/**
 * 根据文件路径后缀获取高亮对应的语言 key
 */
export function getLanguageFromPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (!ext) return null;

  switch (ext) {
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return 'javascript';
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'java':
      return 'java';
    case 'py':
    case 'pyw':
      return 'python';
    case 'go':
      return 'go';
    case 'rs':
      return 'rust';
    case 'xml':
    case 'html':
    case 'xhtml':
    case 'svg':
      return 'markup';
    case 'jsp':
      return 'jsp';
    case 'properties':
    case 'propreties': // 兼容拼写错误
      return 'properties';
    case 'sql':
      return 'sql';
    case 'json':
      return 'json';
    case 'bat':
    case 'cmd':
      return 'batch';
    case 'css':
      return 'css';
    case 'scss':
      return 'scss';
    case 'less':
      return 'less';
    case 'yaml':
    case 'yml':
      return 'yaml';
    case 'toml':
      return 'toml';
    case 'sh':
    case 'bash':
      return 'bash';
    default:
      return null;
  }
}

/**
 * 主要导出入口：根据文件内容和路径，返回分行的高亮 Token 数组。
 * 如超限或无匹配语言，则返回分行的纯文本 Token 数组。
 */
export function getHighlightedLines(content: string, filePath: string): { tokens: HighlightToken[][]; isPlain: boolean } {
  // 1. 检查文件体积上限
  if (content.length > MAX_HIGHLIGHT_SIZE) {
    return {
      tokens: content.split('\n').map(line => [{ content: line }]),
      isPlain: true
    };
  }

  // 2. 检查行数上限
  const rawLines = content.split('\n');
  if (rawLines.length > MAX_HIGHLIGHT_LINES) {
    return {
      tokens: rawLines.map(line => [{ content: line }]),
      isPlain: true
    };
  }

  // 3. 匹配语言
  const lang = getLanguageFromPath(filePath);
  if (!lang) {
    return {
      tokens: rawLines.map(line => [{ content: line }]),
      isPlain: true
    };
  }

  const grammar = Prism.languages[lang];
  if (!grammar) {
    return {
      tokens: rawLines.map(line => [{ content: line }]),
      isPlain: true
    };
  }

  try {
    const tokens = Prism.tokenize(content, grammar);
    return {
      tokens: splitTokensIntoLines(tokens),
      isPlain: false
    };
  } catch (err) {
    console.error('Failed to tokenize content:', err);
    return {
      tokens: rawLines.map(line => [{ content: line }]),
      isPlain: true
    };
  }
}
