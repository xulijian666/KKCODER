/**
 * Monaco 语言映射与主题辅助纯函数。
 * monaco-editor 的 editor.main 默认注册了 basic-languages 全家桶，
 * 这里只做「文件扩展名 → Monaco language id」的映射，未注册语言回退 plaintext。
 */

const MONACO_LANGUAGE_BY_EXTENSION: Record<string, string> = {
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  json: "json",
  jsonc: "json",
  css: "css",
  scss: "scss",
  less: "less",
  sass: "css",
  html: "html",
  htm: "html",
  xhtml: "html",
  xml: "xml",
  xsl: "xml",
  xslt: "xml",
  svg: "xml",
  vue: "html",
  svelte: "html",
  astro: "html",
  yml: "yaml",
  yaml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  properties: "ini",
  editorconfig: "ini",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  psd1: "powershell",
  psm1: "powershell",
  bat: "bat",
  cmd: "bat",
  rs: "rust",
  go: "go",
  py: "python",
  pyw: "python",
  rb: "ruby",
  php: "php",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "cpp",
  h: "cpp",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hh: "cpp",
  hpp: "cpp",
  cs: "csharp",
  swift: "swift",
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  lua: "lua",
  dart: "dart",
  clj: "clojure",
  cljs: "clojure",
  cljc: "clojure",
  ex: "elixir",
  exs: "elixir",
  r: "r",
  scala: "scala",
  sc: "scala",
  pl: "perl",
  pm: "perl",
  proto: "protobuf",
  md: "markdown",
  markdown: "markdown",
  mdx: "mdx",
  rst: "restructuredtext",
  tex: "plaintext",
  bib: "plaintext",
  tf: "hcl",
  hcl: "hcl",
  dockerfile: "dockerfile",
  makefile: "plaintext",
  cmake: "plaintext",
  gradle: "plaintext",
  zig: "plaintext",
  nim: "plaintext",
  nix: "plaintext",
  elm: "plaintext",
  erl: "plaintext",
  hs: "plaintext",
  vb: "vb",
  fs: "fsharp",
  fsx: "fsharp",
  coffee: "coffee",
  pug: "pug",
  jade: "pug",
  liquid: "liquid",
  twig: "twig",
  handlebars: "handlebars",
  hbs: "handlebars",
  sol: "solidity",
  pas: "pascal",
  dpr: "pascal",
  jl: "julia",
  abap: "abap",
  apex: "apex",
  cls: "apex",
  cypher: "cypher",
  cql: "cypher",
  bicep: "bicep",
};

const MONACO_LANGUAGE_BY_FILENAME: Record<string, string> = {
  dockerfile: "dockerfile",
  makefile: "plaintext",
  cmakelists: "plaintext",
  gemfile: "ruby",
  rakefile: "ruby",
  procfile: "plaintext",
};

export function monacoLanguageForPath(relativePath: string): string {
  const name = relativePath.split(/[/\\]/).pop() || relativePath;
  const lowerName = name.toLowerCase();

  const filenameLanguage = MONACO_LANGUAGE_BY_FILENAME[lowerName];
  if (filenameLanguage) return filenameLanguage;

  const dot = lowerName.lastIndexOf(".");
  if (dot > 0 && dot < lowerName.length - 1) {
    const extension = lowerName.slice(dot + 1);
    const language = MONACO_LANGUAGE_BY_EXTENSION[extension];
    if (language) return language;
  }

  return "plaintext";
}

/** 应用主题名（data-theme）是否属于深色系，Monaco 据此选 vs / vs-dark 基底 */
export function isDarkAppTheme(themeName?: string): boolean {
  const theme = themeName || document.documentElement.getAttribute("data-theme") || "";
  return theme.startsWith("dark-");
}
