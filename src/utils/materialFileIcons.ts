/** Material Icon Theme 文件/文件夹图标解析（精简映射） */

const iconUrls = import.meta.glob("../assets/material-icons/*.svg", {
  eager: true,
  query: "?url",
  import: "default",
}) as Record<string, string>;

const urlByName = new Map<string, string>();
for (const [path, url] of Object.entries(iconUrls)) {
  const name = path.split("/").pop()?.replace(/\.svg$/i, "");
  if (name) urlByName.set(name, url);
}

function iconUrl(name: string): string | undefined {
  return urlByName.get(name);
}

/** 完整文件名优先匹配（小写） */
const FILE_NAME_ICONS: Record<string, string> = {
  "package.json": "nodejs",
  "package-lock.json": "nodejs",
  "pnpm-lock.yaml": "pnpm",
  "yarn.lock": "yarn",
  "bun.lock": "bun",
  "bun.lockb": "bun",
  "cargo.toml": "rust",
  "cargo.lock": "rust",
  "tsconfig.json": "tsconfig",
  "tsconfig.app.json": "tsconfig",
  "tsconfig.node.json": "tsconfig",
  "jsconfig.json": "javascript",
  "dockerfile": "docker",
  "docker-compose.yml": "docker",
  "docker-compose.yaml": "docker",
  "compose.yml": "docker",
  "compose.yaml": "docker",
  ".dockerignore": "docker",
  ".gitignore": "git",
  ".gitattributes": "git",
  ".gitmodules": "git",
  ".gitkeep": "git",
  ".env": "tune",
  ".env.local": "tune",
  ".env.development": "tune",
  ".env.production": "tune",
  ".env.example": "tune",
  ".envrc": "tune",
  ".npmrc": "npm",
  ".npmignore": "npm",
  ".eslintrc": "eslint",
  ".eslintrc.js": "eslint",
  ".eslintrc.cjs": "eslint",
  ".eslintrc.json": "eslint",
  "eslint.config.js": "eslint",
  "eslint.config.mjs": "eslint",
  "eslint.config.ts": "eslint",
  ".prettierrc": "prettier",
  ".prettierrc.js": "prettier",
  ".prettierrc.json": "prettier",
  ".prettierrc.yaml": "prettier",
  "prettier.config.js": "prettier",
  "vite.config.js": "vite",
  "vite.config.ts": "vite",
  "vite.config.mjs": "vite",
  "vitest.config.js": "vitest",
  "vitest.config.ts": "vitest",
  "playwright.config.ts": "playwright",
  "playwright.config.js": "playwright",
  "cypress.config.ts": "cypress",
  "cypress.config.js": "cypress",
  "tailwind.config.js": "css",
  "tailwind.config.ts": "css",
  "postcss.config.js": "css",
  "webpack.config.js": "javascript",
  "rollup.config.js": "rollup",
  "babel.config.js": "babel",
  ".babelrc": "babel",
  "makefile": "makefile",
  "cmakelists.txt": "cmake",
  "readme": "readme",
  "readme.md": "readme",
  "license": "license",
  "license.md": "license",
  "licence": "license",
  "copying": "license",
  ".editorconfig": "editorconfig",
  "tauri.conf.json": "tauri",
  "next.config.js": "next",
  "next.config.ts": "next",
  "next.config.mjs": "next",
  "nuxt.config.js": "nuxt",
  "nuxt.config.ts": "nuxt",
  "astro.config.mjs": "astro",
  "astro.config.ts": "astro",
  "prisma.schema": "prisma",
  "schema.prisma": "prisma",
  "go.mod": "go",
  "go.sum": "go",
  "gemfile": "ruby",
  "rakefile": "ruby",
  "podfile": "ruby",
};

/** 扩展名 → 图标名 */
const EXT_ICONS: Record<string, string> = {
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "react_ts",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "react",
  json: "json",
  jsonc: "json",
  json5: "json",
  md: "markdown",
  mdx: "mdx",
  markdown: "markdown",
  css: "css",
  scss: "sass",
  sass: "sass",
  less: "less",
  html: "html",
  htm: "html",
  py: "python",
  pyw: "python",
  pyi: "python",
  rs: "rust",
  toml: "toml",
  yml: "yaml",
  yaml: "yaml",
  xml: "xml",
  svg: "svg",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  ico: "image",
  bmp: "image",
  avif: "image",
  go: "go",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "h",
  hpp: "hpp",
  hh: "hpp",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  cs: "csharp",
  php: "php",
  rb: "ruby",
  swift: "swift",
  dart: "dart",
  vue: "vue",
  svelte: "svelte",
  astro: "astro",
  sh: "console",
  bash: "console",
  zsh: "console",
  fish: "console",
  bat: "console",
  cmd: "console",
  ps1: "powershell",
  psm1: "powershell",
  sql: "database",
  db: "database",
  sqlite: "database",
  prisma: "prisma",
  graphql: "graphql",
  gql: "graphql",
  proto: "proto",
  tf: "terraform",
  hcl: "terraform",
  zig: "zig",
  lua: "lua",
  r: "r",
  scala: "scala",
  sc: "scala",
  ipynb: "jupyter",
  pdf: "pdf",
  zip: "zip",
  rar: "zip",
  "7z": "zip",
  tar: "zip",
  gz: "zip",
  tgz: "zip",
  bz2: "zip",
  xz: "zip",
  wasm: "settings",
  dll: "dll",
  so: "settings",
  dylib: "settings",
  exe: "exe",
  bin: "exe",
  pem: "key",
  crt: "certificate",
  cer: "certificate",
  p12: "key",
  pfx: "key",
  key: "key",
  log: "log",
  txt: "document",
  text: "document",
  ini: "settings",
  conf: "settings",
  config: "settings",
  cfg: "settings",
  properties: "settings",
  env: "tune",
  lock: "lock",
  csv: "table",
  tsv: "table",
  xls: "table",
  xlsx: "table",
  mp3: "audio",
  wav: "audio",
  ogg: "audio",
  flac: "audio",
  mp4: "video",
  webm: "video",
  mkv: "video",
  mov: "video",
  avi: "video",
  woff: "font",
  woff2: "font",
  ttf: "font",
  otf: "font",
  eot: "font",
  map: "javascript-map",
  gradlew: "gradle",
};

/** 文件夹名 → 图标名（不含 folder- 前缀，函数内拼接） */
const FOLDER_NAME_ICONS: Record<string, string> = {
  src: "folder-src",
  source: "folder-src",
  sources: "folder-src",
  dist: "folder-dist",
  build: "folder-dist",
  out: "folder-dist",
  output: "folder-dist",
  release: "folder-dist",
  bin: "folder-dist",
  node_modules: "folder-node",
  ".git": "folder-git",
  git: "folder-git",
  components: "folder-components",
  component: "folder-components",
  widgets: "folder-components",
  images: "folder-images",
  img: "folder-images",
  icons: "folder-images",
  assets: "folder-images",
  public: "folder-public",
  static: "folder-public",
  www: "folder-public",
  test: "folder-test",
  tests: "folder-test",
  __tests__: "folder-test",
  spec: "folder-test",
  specs: "folder-test",
  e2e: "folder-test",
  config: "folder-config",
  configs: "folder-config",
  configuration: "folder-config",
  settings: "folder-config",
  ".vscode": "folder-vscode",
  ".github": "folder-github",
  docs: "folder-docs",
  doc: "folder-docs",
  documentation: "folder-docs",
  api: "folder-api",
  apis: "folder-api",
  styles: "folder-utils",
  style: "folder-utils",
  css: "folder-utils",
  scss: "folder-utils",
  utils: "folder-utils",
  util: "folder-utils",
  utilities: "folder-utils",
  helpers: "folder-utils",
  hooks: "folder-utils",
  lib: "folder-lib",
  libs: "folder-lib",
  library: "folder-lib",
  libraries: "folder-lib",
  packages: "folder-packages",
  package: "folder-packages",
  pkg: "folder-packages",
  modules: "folder-packages",
  app: "folder-app",
  apps: "folder-app",
  application: "folder-app",
  applications: "folder-app",
};

function resolveIconName(fileName: string, isDir: boolean): string {
  const lower = fileName.toLowerCase();

  if (isDir) {
    return FOLDER_NAME_ICONS[lower] ?? "folder";
  }

  const byName = FILE_NAME_ICONS[lower];
  if (byName) return byName;

  // 复合扩展名：.d.ts / .test.ts / .module.css 等
  if (lower.endsWith(".d.ts") || lower.endsWith(".d.mts") || lower.endsWith(".d.cts")) {
    return "typescript-def";
  }
  if (/\.(test|spec)\.(ts|tsx|js|jsx|mjs|cjs)$/.test(lower)) {
    if (lower.endsWith("tsx") || lower.endsWith("jsx")) return "react_ts";
    if (lower.endsWith("ts") || lower.endsWith("mts") || lower.endsWith("cts")) return "typescript";
    return "javascript";
  }
  if (lower.endsWith(".module.css")) return "css";
  if (lower.endsWith(".module.scss") || lower.endsWith(".module.sass")) return "sass";
  if (lower.endsWith(".css.map")) return "css-map";
  if (lower.endsWith(".js.map") || lower.endsWith(".mjs.map")) return "javascript-map";

  const lastDot = lower.lastIndexOf(".");
  if (lastDot > 0 && lastDot < lower.length - 1) {
    const ext = lower.slice(lastDot + 1);
    const byExt = EXT_ICONS[ext];
    if (byExt) return byExt;
  }

  // 无扩展名的常见文件
  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return "docker";
  if (lower === "makefile" || lower === "gnumakefile") return "makefile";

  return "file";
}

/**
 * 根据文件/文件夹名解析 Material 图标 URL。
 * 文件夹展开时用通用 open 图标（保持 chevron 表示状态更清晰）。
 */
export function resolveMaterialIconUrl(
  fileName: string,
  isDir: boolean,
  isOpen = false
): string {
  if (isDir && isOpen) {
    // 有专属 closed 图标时仍用 closed + chevron；open 仅默认文件夹
    const name = resolveIconName(fileName, true);
    if (name === "folder") {
      return iconUrl("folder-open") ?? iconUrl("folder") ?? "";
    }
    return iconUrl(name) ?? iconUrl("folder") ?? "";
  }

  const name = resolveIconName(fileName, isDir);
  return iconUrl(name) ?? iconUrl(isDir ? "folder" : "file") ?? "";
}

export function hasMaterialIcon(name: string): boolean {
  return urlByName.has(name);
}
