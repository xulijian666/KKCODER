# 文件预览：Monaco 复刻 VS Code 预览体验 调研

> 目标：把 KKCoder 现有「只读预览面板」（Markdown→HTML+TOC、UTF-8 文本→Prism 高亮只读、二进制→报错；另有独立 textarea 编辑器）升级为「VS Code 式预览体验」——用 monaco-editor 做可编辑代码编辑器，并复刻右上角「打开预览」图标（Open Preview to the Side），对 HTML/SVG/图片/Markdown 在编辑器组内并排渲染。全部基于 primary source（官方仓库 / npm registry / LICENSE 原文 / 官方文档）；版本号读自 npm `latest`，license 读自仓库 LICENSE 原文，stars/最后提交未逐一核实处标注「未核实」。**本文件已订正旧调研文档中的多处事实错误（ESM 引入版本、html-preview 是否存在、image-preview 改名等），以本文为准。**

# TL;DR 推荐

在现有 React 19 + Vite 7 + Tauri v2 架构里，**自建 Monaco 编辑器 + 自建「预览到侧边」面板**是契合度与成本最优解。monaco-editor（MIT，npm latest **0.56.0**）就是 VS Code 的编辑器内核，自带 vs/vs-dark/hc-black/hc-light 主题、minimap、sticky scroll、Ctrl+F 查找、免费 Monarch 高亮与 TS/JSON/CSS/HTML 语言 worker；但「预览」相关的 Markdown/图片预览、webview、custom editor 全都在 VS Code 仓库里而非 monaco 包内——所以**不要**试图跑真正的 VS Code 预览扩展（`@codingame/monaco-vscode-api` 的 webview/customEditor service 目前是 `unsupported` stub），而是用几十行代码自己复刻：编辑器右侧一个 `<iframe srcDoc>` 渲染 HTML、`<img>` 渲染 SVG/位图、`marked`+dompurify 渲染 Markdown，把「预览到侧边」做成编辑器标题栏工具栏项。完整 VS Code（web/server/类 Theia）方案都要额外跑 Node 服务进程 + 跨域 iframe，对离线桌面应用是负资产，仅列为备选。

# 方案对比表

| 名称 | 是什么 | 许可证 | 契合度 | 打包·服务器成本 | 维护度 |
|---|---|---|---|---|---|
| **自建 monaco-editor + 自建侧边预览** | 编辑器内核 + 手写 iframe/img 预览 | MIT | 高（完全匹配现有 React/Tauri） | 仅前端打包，无服务器 | monaco 微软长期维护 |
| `@monaco-editor/react` | React 包装 monaco | MIT | 高 | 同 monaco（默认从 CDN 拉，需改写为本地打包） | 活跃（4.7.0） |
| `@codingame/monaco-vscode-api` | 把 vscode API/service 层盖到 monaco 上 | MIT | 中：编辑器服务可，webview/customEditor 被 stub 为 unsupported | ~34MB 未压缩，无服务器 | 活跃（36.0.0，绑定 vscode 版本） |
| `monaco-languageclient` | monaco ↔ LSP 桥 | MIT | 中（仅 LSP，非预览） | 轻量 | 活跃（10.7.0） |
| vscode.dev / VS Code for the Web | 完整云端 VS Code | MIT | 低（跨域 iframe，无法直接读写本地文件） | 需构建/托管，服务端 | 微软维护 |
| openvscode-server | VS Code server 打包 | MIT | 低 | 本地 Node 常驻服务 | 维护中等 |
| code-server | 同上（Coder） | MIT | 低 | 本地 Node 常驻服务 | 活跃 |
| Eclipse Theia | 可嵌入 IDE 框架 | EPL-2.0 + GPL-2.0(Classpath) 双许可 | 中低 | 需 @theia 后端进程 | 活跃 |

# 关键发现

## 1. monaco-editor（核心结论：就是 VS Code 编辑器内核，MIT，0.56.0）

- **同一个编辑器内核**：README 原话 "The Monaco Editor is the fully featured code editor from VS Code"，FAQ「直接从 VS Code 源码生成，加了在浏览器里跑所需的 service shim」[来源](https://github.com/microsoft/monaco-editor#readme)；npm 描述 "A browser based code editor" [来源](https://www.npmjs.com/package/monaco-editor)。
- **MIT**：`LICENSE.txt` 开头 "The MIT License (MIT), Copyright (c) 2016 - present Microsoft Corporation" [来源](https://raw.githubusercontent.com/microsoft/monaco-editor/main/LICENSE.txt)；npm `"license": "MIT"` 已核对。
- **最新版本 0.56.0**（npm `latest`）[来源](https://registry.npmjs.org/monaco-editor/latest)。
- **ESM 引入时间修正：0.11.0，不是 0.34.0**。CHANGELOG 0.11.0（2018-03-14）原话 "ESM distribution (compatible with e.g. webpack)"；0.34.0 条目**未**提及 ESM [来源](https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md)。0.53.0 起「AMD build deprecate，请迁移到 ESM」[来源](https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md)。当前 package.json `"module": "./esm/vs/editor/editor.main.js"`、`exports` 指向 `./esm/vs/index.js` [来源](https://registry.npmjs.org/monaco-editor/latest)。Vite 7 的 ESM 构建直接可用，无需额外配置。
- **官方 Vite 集成**（`docs/integrate-esm.md` 有专门 "Using Vite" 小节）：只需实现 `self.MonacoEnvironment.getWorker`（不是 getWorkerUrl），按 label 返回 `new Worker(new URL('.../xxx.worker.js', import.meta.url), { type: 'module' })`（等价 `?worker` 后缀）；`json/css/html/typescript` 各自 worker，默认 `editor.worker` [来源](https://raw.githubusercontent.com/microsoft/monaco-editor/main/docs/integrate-esm.md)。
- **worker 脚本路径**（官方 getWorker switch 使用）：`monaco-editor/esm/vs/editor/editor.worker`、`.../language/json/json.worker`、`css/css.worker`、`html/html.worker`、`typescript/ts.worker` [来源](https://raw.githubusercontent.com/microsoft/monaco-editor/main/docs/integrate-esm.md)。
- **monaco-editor-webpack-plugin（仅 legacy Webpack 用）**：独立仓库 README 仅剩 "This repository has been merged into … microsoft/monaco-editor"，集成文档称其为 "a community authored plugin"（非官方推荐）[来源](https://github.com/microsoft/monaco-editor-webpack-plugin)、[来源](https://raw.githubusercontent.com/microsoft/monaco-editor/main/docs/integrate-esm.md)。npm 7.1.1 无 deprecated 标记（已核对 registry）。Vite 下完全不需要。
- **React 包装 `@monaco-editor/react`**：latest **4.7.0**，MIT（repo LICENSE "Copyright (c) 2018 Suren Atoyan"）[来源](https://registry.npmjs.org/@monaco-editor%2Freact/latest)、[来源](https://raw.githubusercontent.com/suren-atoyan/monaco-react/master/LICENSE)。定位「无需 webpack/rollup/parcel 配置即可在 React 使用」；经 `@monaco-editor/loader` 初始化，**默认从 CDN 下载 monaco 文件**，可用 `loader.config({ monaco })` 改写为本地打包（离线必须这么做）[来源](https://github.com/suren-atoyan/monaco-react#readme)。
- **免费语法高亮（Monarch，主线程）+ 语言服务（worker）**：README 指向 Monarch playground；FAQ「language services 起 web worker 把重活搬出 UI 线程」[来源](https://github.com/microsoft/monaco-editor#faq)。
- **minimap**：`IEditorMinimapOptions`（默认 enabled:true）[来源](https://unpkg.com/monaco-editor@0.56.0/monaco.d.ts)。
- **breadcrumbs：monaco 没有；sticky scroll：有**。`monaco.d.ts` 含 `stickyScroll?: IEditorStickyScrollOptions`，但 0 处 `breadcrumbs`（属 VS Code workbench `parts/editor/breadcrumbs`，不在 monaco 公共 API）[来源](https://unpkg.com/monaco-editor@0.56.0/monaco.d.ts)。
- **Ctrl+F 查找 widget 内置**：`find?: IEditorFindOptions`，"Control the behavior of the find widget"，绑定 findController（`editor.action.startFind` 族）[来源](https://unpkg.com/monaco-editor@0.56.0/monaco.d.ts)。
- **Ctrl+S 保存钩子**：模型上**没有** `onDidSaveModel`（monaco.d.ts 0 匹配）；用 `ICodeEditor.addCommand(KeyMod.CtrlCmd|KeyCode.KeyS, handler)` / `addAction` 自行绑定，保存逻辑交给宿主（Tauri 命令）[来源](https://unpkg.com/monaco-editor@0.56.0/monaco.d.ts)。
- **主题**：内置 `'vs'`(默认)/`'vs-dark'`/`'hc-black'`/`'hc-light'`，`monaco.editor.defineTheme` + `setTheme`，`autoDetectHighContrast` 默认 true；0.34.0 新增 hc-light [来源](https://unpkg.com/monaco-editor@0.56.0/monaco.d.ts)、[来源](https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md)。
- **大文件**：`maxTokenizationLineLength` 默认 **20000**——「Lines above this length will not be tokenized for performance reasons」[来源](https://unpkg.com/monaco-editor@0.56.0/monaco.d.ts)。monaco 无内置「大文件自动只读」策略，需宿主按字节数/行数自定（如超阈值关 minimap/highlight 或降级纯文本）。

## 2. monaco 不含任何预览/webview/custom editor（都在 VS Code 仓库，不在 npm 包）

- monaco README FAQ 原文：**「我为 VS Code 写的扩展，能在浏览器里的 monaco 用吗？不行。」**[来源](https://github.com/microsoft/monaco-editor#faq)。
- 三个预览目录现状（`microsoft/vscode` main 分支，已逐一核实）：**`extensions/html-preview` 不存在（404）**；`extensions/image-preview` 已改名 **`extensions/media-preview`**；`extensions/markdown-language-features` 仍在 [来源](https://api.github.com/repos/microsoft/vscode/contents/extensions?ref=main)。
- **HTML 预览在现行 VS Code 里已经不存在（重要修正）**：历史「HTML Preview」从来不是 `extensions/html-preview`，而是 workbench 内建命令 `_workbench.previewHtml`（`HtmlPreviewPart`），2019 年 2 月被移除，早于 custom editor API 出现；`extensions/html-language-features` 只有 LSP 客户端/服务端、`extensions/html` 只有语法+片段，均无预览 [来源](https://raw.githubusercontent.com/microsoft/vscode/1.32.0/src/vs/workbench/contrib/html/electron-browser/htmlPreviewPart.ts)、[来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/html-language-features/package.json)。
- 支撑预览的 workbench 机制（都不在 monaco 里）：`src/vs/workbench/contrib/customEditor/browser/customEditors.ts`（CustomEditorService）、`src/vs/workbench/contrib/webview/browser/webviewElement.ts`、`src/vs/workbench/contrib/webviewPanel/browser/webviewEditor.ts` [来源](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/customEditor/browser/customEditors.ts)、[来源](https://raw.githubusercontent.com/microsoft/vscode/main/src/vs/workbench/contrib/webview/browser/webviewElement.ts)。
- **结论**：预览按钮、HTML/SVG/图片预览、Markdown 渲染全部要自建（iframe/`<img>`/marked），但体量小、纯前端、成本低。

## 3. `@codingame/monaco-vscode-api` 与 `monaco-languageclient`

- **@codingame/monaco-vscode-api**（latest **36.0.0**，MIT，"Copyright (c) 2022 CodinGame"）：把 VSCode 的 service 覆盖到 monaco（用 VSCode 完整实现替换 monaco 的 standalone 简化版），支持注册/运行 vscode-API 扩展（webworker extension host 跑在 iframe 里）、可渲染 workbench 布局 [来源](https://github.com/CodinGame/monaco-vscode-api#readme)、[来源](https://raw.githubusercontent.com/CodinGame/monaco-vscode-api/main/LICENSE)。
- **能否跑真实预览扩展（诚实评估）**：已读其 tarball 的 `missing-services.js`——base 模式下 `CustomEditorService`、`WebviewService`、`WebviewWorkbenchService`、editor groups 等全部 stub 成 `unsupported`；wiki 的 service-override 清单里**没有 webview 或 custom-editor 覆盖项**（有 views/workbench/editor/notebook/terminal 等），且 editor/views/workbench 三者互斥 [来源](https://github.com/CodinGame/monaco-vscode-api/wiki/List-of-service-overrides)。→ **它目前无法开箱即用地跑 VS Code 的 html-preview/image-preview/custom-editor 扩展**；那是 workbench UI 外壳能力，即便 views/workbench 模式官方也未声称支持 `createWebviewPanel`/`customEditors`（未核实）。这是负面结论，但正是本文需要的：别指望靠它捡现成预览扩展。
- **monaco-languageclient**（latest **10.7.0**，MIT）：只做 monaco ↔ LSP 语言服务器连接（同仓含 vscode-ws-jsonrpc、@typefox/monaco-editor-react），与预览无关；README 声明与 monaco-vscode-api 36.0.0 / vscode 1.129.1 / monaco-editor 0.56.0 对齐 [来源](https://github.com/TypeFox/monaco-languageclient#readme)。
- **vscode-wasm → 已并入 microsoft/vscode-wasi**（"A WASI implementation that uses VS Code's extension host as the implementing API"）：落地场景是 VS Code for the Web 里跑 WASI 二进制，不是把 workbench UI 塞进 monaco [来源](https://raw.githubusercontent.com/microsoft/vscode-wasm/main/package.json)、[来源](https://github.com/microsoft/vscode-docs/blob/main/blogs/2024/05/08/wasm.md)。
- **打包影响**：@codingame/monaco-vscode-api 未压缩约 34MB、5000+ 文件，需 ESM bundler + 特殊 CSS 处理 + 先 `initialize()`；源码构建仅支持 Linux/Mac [来源](https://registry.npmjs.org/@codingame%2Fmonaco-vscode-api/latest)。monaco-languageclient 轻量纯 client。

## 4. 完整浏览器版 VS Code（皆需 Node 服务 / 跨域 iframe，无法直读本地文件）

| 仓库 | 许可证（已读 LICENSE 原文） | 是否需要 Node 服务 | 运行时资源 |
|---|---|---|---|
| microsoft/vscode（vscode.dev / github.dev） | MIT（`LICENSE.txt`）[来源](https://github.com/microsoft/vscode/blob/main/LICENSE.txt) | 运行时不需要 Node，但需构建/托管；本地文件走浏览器 File System Access API（仅部分浏览器），非自由磁盘访问 | 官方未给运行时数值（未核实）[来源](https://code.visualstudio.com/docs/remote/vscode-web) |
| gitpod-io/openvscode-server | MIT（`LICENSE.txt`）[来源](https://github.com/gitpod-io/openvscode-server/blob/main/LICENSE.txt) | **是**（`./bin/openvscode-server` 常驻，默认端口 3000） | 未核实 [来源](https://raw.githubusercontent.com/gitpod-io/openvscode-server/main/README.md) |
| coder/code-server | MIT（`LICENSE`）[来源](https://raw.githubusercontent.com/coder/code-server/main/LICENSE) | **是**（Node 应用，Node 22.x） | 未核实 [来源](https://coder.com/docs/code-server/npm) |
| eclipse-theia/theia | **EPL-2.0 + GPL-2.0(Classpath exception) 双许可**（`LICENSE-EPL`）[来源](https://raw.githubusercontent.com/eclipse-theia/theia/master/LICENSE-EPL) | **是**（web 形态需 @theia 后端；engines node>=22） | 未核实 [来源](https://raw.githubusercontent.com/eclipse-theia/theia/master/package.json) |

- 共性：**在 Tauri webview 里都无法直接读写本地文件**——浏览器沙箱 + 跨域，文件系统要么在 Node 进程里、要么靠 File System Access API；VS Code 官方原话「VS Code for the Web 完全跑在浏览器沙箱里，执行环境非常受限」[来源](https://code.visualstudio.com/docs/remote/vscode-web)。
- 嵌入只有两条路：①本地 spawn Node server + iframe（openvscode-server/code-server/Theia）；②放弃完整 VS Code，用 Tauri IPC 当「agent」让轻量 Monaco UI 读写文件（正是本仓路径）。对离线桌面 + 已有终端，②明显更划算。

## 5. 复刻「open preview to the side」的小包（npm + GitHub 检索）

**头号发现（本身就是结论）：没有成熟、可嵌入、专门在 Monaco 里复刻 VS Code 侧边预览面板的库。** npm registry 搜索 `monaco html preview` / `monaco markdown preview` / `monaco preview` 与 GitHub 同名仓库搜索均无此定位的成熟包 [来源](https://registry.npmjs.org/-/v1/search?text=monaco%20html%20preview)、[来源](https://github.com/search?q=monaco+markdown+preview&type=repositories)。

| 候选 | 仓库 | 许可证 | stars/最后提交 | 一句结论 |
|---|---|---|---|---|
| `@uiw/react-markdown-preview` | github.com/uiwjs/react-markdown-preview | MIT（`LICENSE` 已读）[来源](https://github.com/uiwjs/react-markdown-preview) | ~347 / 较活跃（npm 5.2.1） | 现成 GitHub 风格 Markdown 渲染 pane，可做 Markdown 半边；**只是预览 pane，不做分栏/HTML/图片** |
| `monaco-editor-ex` | github.com/huanent/monaco-editor-ex | ⚠️ 仓库无 LICENSE 文件（license:null，npm 写 MIT 但存疑） | ~34 / 维护弱 | 给 Monaco 内 HTML 文档补 JS/CSS 补全，非实时渲染预览；缺许可证 + 低采用，不建议生产 |
| 手写 iframe srcDoc + marked | —（自建） | 自持 | — | 事实标准：HTML=`<iframe srcDoc>`、图片=`<img>`、Markdown=marked 渲染 |

注：搜索大量命中 **VS Code 桌面工作区插件**（microsoft/vscode-livepreview、ritwickdey/vscode-live-server 等），它们要扩展宿主 + 本地 server，**不能**嵌进 Monaco，已排除。stars/提交时间来自查询时点，未逐一复核（未核实）。

## 6. VS Code 预览行为（要复刻的精确行为，来自 package.json 原文）

- **Markdown 预览按钮**（`editor/title`，group `navigation@1`）：`markdown.showPreviewToSide` 带 `alt: markdown.showPreview`，when：`editorLangId =~ /^(markdown|prompt|instructions|chatagent|skill)$/ && !notebookEditorFocused && !hasCustomMarkdownPreview`；图标 `$(open-preview)`（另有 `markdown.reopenAsPreview` `$(preview)`、`markdown.showSource` `$(file-code)`）[来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/package.json)。
- **Open Preview vs Open Preview to the Side**：实现于 `showPreview.ts`——两者只有 `sideBySide` 布尔不同：`showPreview` = `sideBySide:false`（同组），`showPreviewToSide` = `sideBySide:true`（`vscode.ViewColumn.Beside` 并排）[来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/src/commands/showPreview.ts)。
- **快捷键（现行，与常见记忆不同）**：`markdown.showPreviewToSide` = `ctrl+k v`；`shift+ctrl+v` 现在是 `markdown.togglePreview`（开关预览），而非 `showPreview` [来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/package.json)。
- **Markdown 预览实时更新**：`vscode.workspace.onDidChangeTextDocument` → `this.refresh()`（首个事件立即刷新，紧随的防抖）+ 外部文件 watcher；并排滚动同步在 `preview-src/scroll-sync.ts` 双向实现（`scrollPreviewWithEditor`/`scrollEditorWithPreview` 默认 true）[来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/src/preview/preview.ts)、[来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/preview-src/scroll-sync.ts)。渲染用 markdown-it + highlight.js/katex/mermaid/dompurify [来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/package.json)。
- **Markdown 安全选择器**：`markdown.showPreviewSecuritySelector`（security-restricted 是 **markdown** 的特性，不是 html-preview 的）[来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/markdown-language-features/package.json)。
- **图片/SVG 预览 = `extensions/media-preview` 的 custom editor**：`viewType: imagePreview.previewEditor`，`selector: *.{jpg,jpe,jpeg,png,bmp,gif,ico,webp,avif,svg}`（另有 audio `*.{mp3,wav,ogg,oga}`、video `*.{mp4,webm}`），priority `builtin`；命令 `imagePreview.zoomIn`/`zoomOut`；SVG 专属 `editor/title` 的 `reopenAsPreview`/`reopenAsText`（`$(preview)`/`$(go-to-file)`，group `navigation`）[来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/media-preview/package.json)。
- **图片预览缩放/像素/适配显示**：webview 脚本 `MAX_SCALE=20 / MIN_SCALE=0.1`、离散 `zoomLevels`、默认 `scale:'fit'`，并把 `image.naturalWidth x image.naturalHeight` 回传状态栏显示像素尺寸 [来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/media-preview/media/imagePreview.js)、[来源](https://raw.githubusercontent.com/microsoft/vscode/main/extensions/media-preview/src/imagePreview/index.ts)。
- **HTML 预览**：现行 VS Code **无**；历史语义是「编辑即渲染」——`HtmlPreviewPart` 里 `model.onDidChangeContent(() => this.webview.contents = model.getLinesContent().join('\n'))`（打字即重渲染）[来源](https://raw.githubusercontent.com/microsoft/vscode/1.32.0/src/vs/workbench/contrib/html/electron-browser/htmlPreviewPart.ts)。

# 需要复刻的 VS Code 预览行为

1. 标题栏右上角「打开预览」小图标（codicon `open-preview`）：仅非二进制文本、可识别语言（markdown/html/svg）显示，默认动作「同组打开」，alt 动作「并排打开」。
2. 「Open Preview to the Side」= 编辑器组内**并排**拆分（`ViewColumn.Beside`）；「Open Preview」= 同组替换。
3. 快捷键：Ctrl+K V = 并排预览；Ctrl+Shift+V = 开关预览（对标现行 VS Code，而非旧文档的 showPreview）。
4. 文件类型→行为映射：Markdown（live 渲染，滚动同步可选）、HTML（iframe srcDoc 实时渲染）、SVG（`<img>` 或 iframe 渲染 + 可切回源码）、位图 jpg/png/bmp/gif/ico/webp/avif（`<img>`）、其它文本→可编辑/只读高亮→无预览按钮。
5. 图片预览能力：缩放 in/out（10%~2000%）、fit、显示 `自然宽x自然高` 像素尺寸。
6. 安全：Markdown 渲染用 dompurify 消毒；HTML 预览放 `<iframe sandbox>`（对应 VS Code 的 untrusted/security 语义）；不执行 `<script>`。
7. UI 一致性：vs/vs-dark/hc-black/hc-light 主题、minimap、sticky scroll、Ctrl+F 查找、行号、Bracket Pair Colorization——monaco 全部免费内置（唯 breadcrumbs 缺，需自绘或放弃）。

# 本仓集成要点 (Tauri/Vite)

> 建立在真实文件之上：`src-tauri/tauri.conf.json`（`devUrl=http://127.0.0.1:16888`、`frontendDist=../dist`、`app.security.csp=null`）与 `vite.config.ts`（`@vitejs/plugin-react`、port 16888 strictPort、`build.assetsInlineLimit=0`、manualChunks 含 prismj/xterm/lucide/marked/react）。这些是 repo-file 事实 [来源](../src-tauri/tauri.conf.json)、[来源](../vite.config.ts)。

- **离线桌面必须本地打包 monaco，禁用 CDN**：`@monaco-editor/react` 默认从 CDN 拉资源 [来源](https://github.com/suren-atoyan/monaco-react#readme)，在 Tauri 离线应用里不可用——要么不用它、直接 `import * as monaco from 'monaco-editor'`，要么 `loader.config({ monaco })` 强制走本地 ESM chunk。
- **worker 加载（照抄官方 Vite 集成）**：`self.MonacoEnvironment.getWorker` 按 label 返回 `new Worker(new URL('monaco-editor/esm/vs/.../xxx.worker.js', import.meta.url), { type: 'module' })`（等价 `?worker` 后缀）；json/css/html/typescript 各自 worker，默认 editor.worker [来源](https://raw.githubusercontent.com/microsoft/monaco-editor/main/docs/integrate-esm.md)。Vite 内置 `import Worker from './worker.js?worker'` 语法 [来源](https://vite.dev/guide/features#web-workers)。
- **`assetsInlineLimit=0` 是利好**：worker/字体/css 落成独立文件而非 data URL，正好满足 monaco worker 需在 Tauri 自定义协议下按真实 URL 加载的要求 [来源](../vite.config.ts)（本仓事实）；无需改动该配置。
- **生产构建 URL 基础**：前端进 `../dist` 由 Tauri 自定义协议加载（Windows `http://tauri.localhost`，其它平台 `tauri://localhost`），dev 为 `http://127.0.0.1:16888`（本仓事实）。monaco 的 `new URL(..., import.meta.url)` worker 与字体/worker 资源随 Vite 产物自动解析到同源，自定义协议下可工作；遇 worker 404 优先检查 Vite `base` 是否相对。
- **CSP 现状 `null`（关闭）**：暂无 CSP 拦截（本仓事实）。**若日后启用 CSP**：monaco 默认用 blob URL 包装 worker，需 `worker-src blob:`；并放行 `font-src`/`style-src 'unsafe-inline'`（monaco 注入样式），否则 tokenize worker 与高亮样式被拦 [来源](https://raw.githubusercontent.com/microsoft/monaco-editor/main/docs/integrate-esm.md)。
- **按需拆 chunk**：本仓 `manualChunks` 尚无数 monaco 项，建议加 `monaco-vendor`（匹配 `/monaco-editor/` 或 `/monaco-editor-core/`）复用现有拆分策略 [来源](../vite.config.ts)（本仓事实）。monaco 全量含 4 个语言 worker + 字体，数 MB 级（未精确核实），应在进入编辑器面板时动态 import 而非首屏。
- **保存钩子**：monaco 无 `onDidSaveModel`，用 `editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, ...)` 内实现「防抖写回 + 触发现有 Tauri 保存命令」，并与右侧预览联动刷新 [来源](https://unpkg.com/monaco-editor@0.56.0/monaco.d.ts)。
- **大文件门槛**：`maxTokenizationLineLength=20000`（默认）只按「行长」停 tokenize；对「文件大小」需自行设阈值（如 > 1~2MB 关 minimap/highlight、退化为只读）[来源](https://unpkg.com/monaco-editor@0.56.0/monaco.d.ts)。注意与本仓现有 1MB/300KB 读取上限衔接（repo 事实，见旧调研文）。

# 候选小工具

- **`@uiw/react-markdown-preview`**（MIT，5.2.1）：现成 GitHub 风格 Markdown 渲染，可作 Markdown 预览 pane 渲染器 [来源](https://github.com/uiwjs/react-markdown-preview)。
- 其余「预览到侧边」无成熟库，直接自建：HTML=`<iframe srcDoc sandbox>`，SVG/图片=`<img>`，Markdown=`marked`+dompurify（本仓已打包 marked [来源](../vite.config.ts)）。

# 风险

- **「预览扩展直接跑」是死路**：VS Code 的 html-preview（已不存在）/image-preview(→media-preview)/markdown 预览都是 workbench + webview + custom editor 机制，monaco 无此机制、monaco-vscode-api 的 webview/customEditor service 目前是 `unsupported` stub——投入产出比极差，不可作路线 [来源](https://github.com/CodinGame/monaco-vscode-api/wiki/List-of-service-overrides)。
- **monaco 首屏体积**：完整 editor.main + 4 语言 worker + 字体数 MB（未精确核实），需 manualChunks + 懒加载，否则拖慢 WebView2 首屏。
- **HTML 预览脚本执行风险**：直接 `srcDoc` 且不 sandbox 会执行 JS；必须 `<iframe sandbox="allow-same-origin">` 或禁用脚本，叠加本仓 `csp:null` 后更要谨慎。
- **默认 CDN 依赖**：`@monaco-editor/react` 默认 CDN load，漏改会导致离线白屏（必须 `loader.config({ monaco })`）。
- **VS Code 行为已变**：快捷键是 Ctrl+K V / Ctrl+Shift+V(toggle)，非旧文档的 Ctrl+Shift+V=showPreview；复刻以现行 package.json 为准。
- **完整 VS Code 类方案成本**：openvscode-server/code-server/Theia 都要本地常驻 Node 进程 + iframe 跨域、无直接文件访问；Theia 为 EPL/GPL 双许可——与本仓「轻量离线 + 已有终端 + Tauri IPC」定位冲突。
