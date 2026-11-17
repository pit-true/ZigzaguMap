import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// MCP サーバーを Node 22 で動く 1 つのファイル（dist/zigzagumap-mcp.mjs）にまとめる（#521）。
// core はソースのまま取り込む（core の dist を作らなくてよい）。外の依存は Node の組み込みだけ。
const core = fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url));

export default defineConfig({
  resolve: { alias: { "@zigzagumap/core": core } },
  ssr: { noExternal: true },
  build: {
    ssr: "src/cli.ts",
    target: "node22",
    outDir: "dist",
    emptyOutDir: true,
    minify: false,
    rollupOptions: {
      output: { entryFileNames: "zigzagumap-mcp.mjs", format: "es" },
    },
  },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
  },
});
