import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

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
