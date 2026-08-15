import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// monaco-editor 的 package.json exports 会把深层路径重写为 ./esm/vs/*.js，
// 直接 import "monaco-editor/esm/..." 会拼出错误的双段路径。
// 这里把 esm/min 前缀指向 node_modules 真实目录，供 worker(?worker) 与 CSS 子路径导入使用。
const monacoEsmDir = fileURLToPath(new URL("./node_modules/monaco-editor/esm", import.meta.url));
const monacoMinDir = fileURLToPath(new URL("./node_modules/monaco-editor/min", import.meta.url));

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: [
      // 根导入直接落到 ESM 入口文件，避免 Vite 对 5000+ 模块的 monaco 做预打包
      { find: /^monaco-editor$/, replacement: `${monacoEsmDir}/vs/index.js` },
      { find: "monaco-editor/esm", replacement: monacoEsmDir },
      { find: "monaco-editor/min", replacement: monacoMinDir },
    ],
  },

  // Monaco 是浏览器原生 ESM 且体量极大，dev 下走 /@fs 按需加载；
  // 预打包会让 esbuild 卡死/超长等待，表现为“正在加载编辑器…”一直不结束。
  optimizeDeps: {
    exclude: ["monaco-editor"],
  },

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: 16888,
    strictPort: true,
    host: host || "127.0.0.1",
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 16889,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and database/log/journal files to avoid full page reloads
      ignored: [
        "**/src-tauri/**",
        "**/kkcoder.db*",
        "**/kkcoder_debug.log"
      ],
    },
  },
  build: {
    // Monaco 完整语言包单一 vendor chunk 约 4.4MB（gzip 1.1MB），桌面应用可接受，
    // 提高告警阈值避免每次构建刷屏；该 chunk 仍按需动态加载，不进首屏。
    chunkSizeWarningLimit: 5000,
    // 4. 资源一律不内联为 data URL：131 个材质图标改为独立文件由 <img> 异步加载，
    //    避免数百 KB base64 内联进主 JS 拖慢 WebView2 首屏解析
    assetsInlineLimit: 0,
    rollupOptions: {
      output: {
        // 5. 依赖库按域拆分 chunk：WebView2 解析/缓存粒度更细，
        //    后续版本升级只影响对应 chunk。
        //    函数形式按模块路径匹配（对象形式无法覆盖 CJS 子路径如 prismjs/components/*）
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@xterm/") || id.includes("/xterm/")) return "xterm-vendor";
          if (id.includes("/prismjs/")) return "prism-vendor";
          if (id.includes("/lucide-react/")) return "lucide-vendor";
          if (id.includes("/marked/")) return "marked-vendor";
          if (id.includes("/monaco-editor/")) return "monaco-vendor";
          if (
            id.includes("/react/") ||
            id.includes("/react-dom") ||
            id.includes("/scheduler/")
          ) {
            return "react-vendor";
          }
          return undefined;
        },
      },
    },
  },
}));
