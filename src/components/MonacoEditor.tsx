import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type * as Monaco from "monaco-editor";
import { isDarkAppTheme, monacoLanguageForPath } from "../utils/monaco";
import { log } from "../utils/log";

type MonacoModule = typeof import("monaco-editor");
type StandaloneEditor = Monaco.editor.IStandaloneCodeEditor;

let monacoModulePromise: Promise<MonacoModule> | null = null;

/**
 * 懒加载 monaco-editor（本地打包，不走 CDN）。
 * package.json 的 exports 会把深层路径重写错，vite.config.ts 已为
 * monaco-editor/esm 与 monaco-editor/min 加 alias，worker 与 CSS 子路径导入依赖它。
 * 失败时清空缓存，保证 UI 上的「重试」能真正重新 import。
 */
async function loadMonacoModule(): Promise<MonacoModule> {
  if (monacoModulePromise) return monacoModulePromise;
  monacoModulePromise = (async () => {
    await import("monaco-editor/min/vs/editor/editor.main.css");
    const [
      monaco,
      { default: EditorWorker },
      { default: JsonWorker },
      { default: CssWorker },
      { default: HtmlWorker },
      { default: TsWorker },
    ] = await Promise.all([
      import("monaco-editor"),
      import("monaco-editor/esm/vs/editor/editor.worker?worker"),
      import("monaco-editor/esm/vs/language/json/json.worker?worker"),
      import("monaco-editor/esm/vs/language/css/css.worker?worker"),
      import("monaco-editor/esm/vs/language/html/html.worker?worker"),
      import("monaco-editor/esm/vs/language/typescript/ts.worker?worker"),
    ]);

    const workerHost = self as typeof self & {
      MonacoEnvironment?: {
        getWorker: (moduleId: unknown, label: string) => Worker;
      };
    };
    workerHost.MonacoEnvironment = {
      getWorker(_moduleId: unknown, label: string): Worker {
        switch (label) {
          case "json":
            return new JsonWorker();
          case "css":
          case "scss":
          case "less":
            return new CssWorker();
          case "html":
          case "handlebars":
          case "razor":
            return new HtmlWorker();
          case "typescript":
          case "javascript":
            return new TsWorker();
          default:
            return new EditorWorker();
        }
      },
    };
    return monaco;
  })();
  monacoModulePromise = monacoModulePromise.catch((error) => {
    // 不让失败的 Promise 永久驻留：UI 重试时重新 import
    monacoModulePromise = null;
    throw error;
  });
  return monacoModulePromise;
}

function resolveCssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
}

/**
 * #rrggbb → #rrggbbaa。
 * Monaco 的 defineTheme 只接受 hex（Color.fromHex 对 rgba() 会回退成纯红色），
 * 因此这里不能像普通 CSS 一样返回 rgba()。
 */
function hexWithAlpha(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return hex;
  const alphaHex = Math.round(Math.max(0, Math.min(1, alpha)) * 255)
    .toString(16)
    .padStart(2, "0");
  return `${match[0]}${alphaHex}`;
}

/** 跟随应用六套主题动态生成 Monaco 主题，比固定 vs/vs-dark 更贴合窗口配色 */
function applyAppThemeToMonaco(monaco: MonacoModule): void {
  const dark = isDarkAppTheme();
  const primary = resolveCssVar("--color-primary", dark ? "#3b82f6" : "#2563eb");
  const background = resolveCssVar("--bg-main", dark ? "#1e1e1e" : "#ffffff");
  const sidebar = resolveCssVar("--bg-sidebar", dark ? "#252526" : "#f3f3f3");
  const foreground = resolveCssVar("--text-primary", dark ? "#e0e0e0" : "#1e293b");
  const secondary = resolveCssVar("--text-secondary", dark ? "#94a3b8" : "#64748b");
  const border = resolveCssVar("--border-color", dark ? "#3c3c3c" : "#e2e8f0");
  const activeItem = resolveCssVar("--bg-active-item", dark ? "#37373d" : "#dbeafe");

  monaco.editor.defineTheme("kkcoder-app", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": background,
      "editor.foreground": foreground,
      "editorLineNumber.foreground": hexWithAlpha(secondary, 0.65),
      "editorLineNumber.activeForeground": foreground,
      "editorCursor.foreground": primary,
      "editor.selectionBackground": hexWithAlpha(primary, 0.35),
      "editor.inactiveSelectionBackground": hexWithAlpha(primary, 0.18),
      "editor.lineHighlightBackground": hexWithAlpha(secondary, 0.1),
      "editor.lineHighlightBorder": "#00000000",
      "editorIndentGuide.background1": hexWithAlpha(secondary, 0.22),
      "editorIndentGuide.activeBackground1": hexWithAlpha(secondary, 0.5),
      "editorGutter.background": background,
      "editorWidget.background": sidebar,
      "editorWidget.border": border,
      "editorSuggestWidget.background": sidebar,
      "editorSuggestWidget.border": border,
      "editorSuggestWidget.selectedBackground": activeItem,
      "editorHoverWidget.background": sidebar,
      "editorHoverWidget.border": border,
      "editorOverviewRuler.border": "#00000000",
      "minimap.background": background,
      "scrollbarSlider.background": hexWithAlpha(secondary, 0.28),
      "scrollbarSlider.hoverBackground": hexWithAlpha(secondary, 0.5),
      "scrollbarSlider.activeBackground": hexWithAlpha(secondary, 0.65),
    },
  });
  monaco.editor.setTheme("kkcoder-app");
}

export interface MonacoEditorHandle {
  /** 触发保存（等价 Ctrl+S） */
  save: () => void;
  focus: () => void;
}

export interface MonacoEditorProps {
  /** 相对项目路径（用于语言识别与 URI） */
  filePath: string;
  /** 初始内容；本组件挂载后自身持有内容，父级不要再随输入回流 */
  initialValue: string;
  /** 每次编辑内容变化回调（供 HTML 实时预览等场景读取最新值） */
  onValueChange?: (value: string) => void;
  onDirtyChange: (dirty: boolean) => void;
  /** 保存回调：返回 true 表示保存成功，组件据此同步 dirty 状态 */
  onSave: (content: string) => Promise<boolean>;
  onInsertSelection: (text: string) => void;
  /** Ctrl+W 关闭预览（与 VS Code 一致） */
  onCloseRequest: () => void;
  /** 可选：Ctrl+K V 复刻 VS Code「并排打开预览」 */
  onTogglePreview?: () => void;
}

export const MonacoEditor = forwardRef<MonacoEditorHandle, MonacoEditorProps>(
  function MonacoEditor(
    {
      filePath,
      initialValue,
      onValueChange,
      onDirtyChange,
      onSave,
      onInsertSelection,
      onCloseRequest,
      onTogglePreview,
    },
    ref,
  ) {
    const [monacoModule, setMonacoModule] = useState<MonacoModule | null>(null);
    const [monacoLoadError, setMonacoLoadError] = useState<string | null>(null);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const mountRef = useRef<HTMLDivElement | null>(null);
    const editorRef = useRef<StandaloneEditor | null>(null);
    const monacoRef = useRef<MonacoModule | null>(null);
    const savedVersionIdRef = useRef<number>(0);
    const lastDirtyRef = useRef<boolean>(false);
    const suppressDirtyRef = useRef<boolean>(false);

    const onSaveRef = useRef(onSave);
    const onValueChangeRef = useRef(onValueChange);
    const onDirtyChangeRef = useRef(onDirtyChange);
    const onInsertSelectionRef = useRef(onInsertSelection);
    const onCloseRequestRef = useRef(onCloseRequest);
    const onTogglePreviewRef = useRef(onTogglePreview);
    useEffect(() => {
      onSaveRef.current = onSave;
      onValueChangeRef.current = onValueChange;
      onDirtyChangeRef.current = onDirtyChange;
      onInsertSelectionRef.current = onInsertSelection;
      onCloseRequestRef.current = onCloseRequest;
      onTogglePreviewRef.current = onTogglePreview;
    }, [onDirtyChange, onInsertSelection, onSave, onCloseRequest, onTogglePreview, onValueChange]);

    useEffect(() => {
      let cancelled = false;
      setMonacoLoadError(null);
      void loadMonacoModule()
        .then((module) => {
          if (cancelled) return;
          monacoRef.current = module;
          setMonacoModule(module);
        })
        .catch((error: unknown) => {
          if (cancelled) return;
          const message = error instanceof Error ? error.message : String(error);
          log(`[monaco] editor module load failed: ${message}`);
          setMonacoLoadError(message);
        });
      return () => {
        cancelled = true;
      };
    }, [loadAttempt]);

    // 应用主题并跟随 data-theme 变化（应用有 6 套主题）
    useEffect(() => {
      const monaco = monacoRef.current;
      if (!monaco) return;
      const apply = () => applyAppThemeToMonaco(monaco);
      apply();
      const observer = new MutationObserver(apply);
      observer.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["data-theme"],
      });
      window.addEventListener("kkcoder-theme-change", apply);
      return () => {
        observer.disconnect();
        window.removeEventListener("kkcoder-theme-change", apply);
      };
    }, [monacoModule]);

    // 创建编辑器：只依赖 monaco 模块就绪；父级用 key 换文件重建组件，
    // 因此这里不需要响应 initialValue/filePath 变化（重命名由下方 effect 单独处理）。
    useEffect(() => {
      const monaco = monacoRef.current;
      const mount = mountRef.current;
      if (!monaco || !mount) return;

      const language = monacoLanguageForPath(filePath);
      const model = monaco.editor.createModel(
        initialValue,
        language,
        monaco.Uri.parse(`file:///kkcoder/${filePath.replace(/\\/g, "/")}`),
      );
      savedVersionIdRef.current = model.getAlternativeVersionId();
      lastDirtyRef.current = false;

      const editor = monaco.editor.create(mount, {
        model,
        theme: "kkcoder-app",
        automaticLayout: true,
        minimap: { enabled: true, showSlider: "mouseover" },
        fontFamily: resolveCssVar("--font-mono", "Consolas, 'Courier New', monospace"),
        fontLigatures: true,
        fontSize: 13,
        padding: { top: 8 },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        cursorSmoothCaretAnimation: "on",
        renderWhitespace: "selection",
        bracketPairColorization: { enabled: true },
        guides: { bracketPairs: "active" },
        stickyScroll: { enabled: true },
        wordWrap: "off",
        detectIndentation: true,
        tabSize: 4,
        contextmenu: true,
        fixedOverflowWidgets: false,
      });
      editorRef.current = editor;

      const disposables: Monaco.IDisposable[] = [];
      disposables.push(
        model.onDidChangeContent(() => {
          if (suppressDirtyRef.current) return;
          onValueChangeRef.current?.(model.getValue());
          const dirty = model.getAlternativeVersionId() !== savedVersionIdRef.current;
          if (dirty !== lastDirtyRef.current) {
            lastDirtyRef.current = dirty;
            onDirtyChangeRef.current(dirty);
          }
        }),
      );

      const save = async (): Promise<boolean> => {
        const currentEditor = editorRef.current;
        if (!currentEditor) return false;
        const modelAtSave = currentEditor.getModel();
        if (!modelAtSave) return false;
        const versionAtSave = modelAtSave.getAlternativeVersionId();
        const ok = await onSaveRef.current(modelAtSave.getValue());
        if (ok && savedVersionIdRef.current !== versionAtSave) {
          // 保存成功且保存期间没有新输入：同步 dirty 基准
          savedVersionIdRef.current = versionAtSave;
          if (lastDirtyRef.current) {
            lastDirtyRef.current = false;
            onDirtyChangeRef.current(false);
          }
        }
        return ok;
      };

      disposables.push(
        editor.addAction({
          id: "kkcoder-save-file",
          label: "保存 (Ctrl+S)",
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
          contextMenuGroupId: "1_modification",
          contextMenuOrder: 1,
          run: () => {
            void save();
          },
        }),
      );
      disposables.push(
        editor.addAction({
          id: "kkcoder-close-editor",
          label: "关闭编辑器 (Ctrl+W)",
          keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyW],
          contextMenuGroupId: "9_cutcopypaste",
          contextMenuOrder: 5,
          run: () => onCloseRequestRef.current(),
        }),
      );
      if (onTogglePreview) {
        disposables.push(
          editor.addAction({
            id: "kkcoder-toggle-preview",
            label: "打开预览到侧边 (Ctrl+K V)",
            keybindings: [
              monaco.KeyMod.chord(
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
                monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyV,
              ),
            ],
            contextMenuGroupId: "navigation",
            contextMenuOrder: 1.5,
            run: () => onTogglePreviewRef.current?.(),
          }),
        );
      }
      disposables.push(
        editor.addAction({
          id: "kkcoder-insert-selection",
          label: "添加到对话",
          contextMenuGroupId: "9_cutcopypaste",
          contextMenuOrder: 4,
          precondition: "editorHasSelection",
          run: () => {
            const selection = editor.getSelection();
            const modelOfEditor = editor.getModel();
            if (!selection || !modelOfEditor || selection.isEmpty()) return;
            const text = modelOfEditor.getValueInRange(selection).trim();
            if (text) onInsertSelectionRef.current(text);
          },
        }),
      );

      // Ctrl+U：沿用应用既有「选中文本加入对话」语义（覆盖 monaco 默认 cursorUndo）
      disposables.push(
        editor.onKeyDown((event) => {
          if (
            (event.ctrlKey || event.metaKey) &&
            event.keyCode === monaco.KeyCode.KeyU
          ) {
            event.preventDefault();
            event.stopPropagation();
            const selection = editor.getSelection();
            const modelOfEditor = editor.getModel();
            if (!selection || !modelOfEditor || selection.isEmpty()) return;
            const text = modelOfEditor.getValueInRange(selection).trim();
            if (text) onInsertSelectionRef.current(text);
          }
        }),
      );

      const focusTimer = window.setTimeout(() => editor.focus(), 0);
      return () => {
        window.clearTimeout(focusTimer);
        for (const disposable of disposables) disposable.dispose();
        editor.dispose();
        model.dispose();
        editorRef.current = null;
        lastDirtyRef.current = false;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [monacoModule]);

    // 文件重命名（不重建组件）：同步语言即可，编辑内容保留
    useEffect(() => {
      const monaco = monacoRef.current;
      const editor = editorRef.current;
      if (!monaco || !editor) return;
      const model = editor.getModel();
      if (!model) return;
      const language = monacoLanguageForPath(filePath);
      if (model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filePath, monacoModule]);

    const save = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const model = editor.getModel();
      if (!model) return;
      const versionAtSave = model.getAlternativeVersionId();
      void onSaveRef.current(model.getValue()).then((ok) => {
        if (ok && savedVersionIdRef.current !== versionAtSave) {
          savedVersionIdRef.current = versionAtSave;
          if (lastDirtyRef.current) {
            lastDirtyRef.current = false;
            onDirtyChangeRef.current(false);
          }
        }
      });
    }, []);

    useImperativeHandle(
      ref,
      () => ({
        save,
        focus: () => editorRef.current?.focus(),
      }),
      [save],
    );

    return (
      <div className="monaco-editor-host">
        {!monacoModule && !monacoLoadError && (
          <div className="monaco-editor-loading">正在加载编辑器…</div>
        )}
        {!monacoModule && monacoLoadError && (
          <div className="monaco-editor-loading error">
            <div className="monaco-editor-load-error-title">编辑器加载失败</div>
            <div className="monaco-editor-load-error-detail" title={monacoLoadError}>
              {monacoLoadError}
            </div>
            <button
              className="preview-open-system-btn monaco-editor-retry-btn"
              onClick={() => setLoadAttempt((value) => value + 1)}
            >
              重试
            </button>
          </div>
        )}
        <div ref={mountRef} className="monaco-editor-mount" />
      </div>
    );
  },
);
