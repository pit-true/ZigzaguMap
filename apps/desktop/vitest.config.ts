import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 画面のうち、DOM を使わない部分（文言の組み立て・変換・メニューの定義など）の単体テスト。
// core はビルドせずにソースを読む（Node の条件では dist を指すため）。
export default defineConfig({
  resolve: {
    alias: { "@zigzagumap/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) },
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
