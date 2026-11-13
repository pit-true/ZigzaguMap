import { defineConfig } from "vite";

// Tauri から使う Vite の設定。
// index.html がメインウィンドウ、tool.html が別ウィンドウ（ブロックエディタなど。開いたときに初めて読み込む）。
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
    rollupOptions: {
      input: {
        main: "index.html",
        tool: "tool.html",
      },
    },
  },
});
