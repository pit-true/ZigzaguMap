import { defineConfig } from "vite";

// Tauri から使う Vite の設定。
export default defineConfig({
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: "es2022",
    outDir: "dist",
    emptyOutDir: true,
    // メイン（index.html）と別ウィンドウ（tool.html）の入口を分ける。別ウィンドウはメインの画面のコードを読まない。
    rollupOptions: {
      input: { main: "index.html", tool: "tool.html" },
    },
  },
});
