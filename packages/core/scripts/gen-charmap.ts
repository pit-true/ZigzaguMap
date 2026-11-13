/**
 * 同梱の文字コード表（src/name/charmapNd.ts）を charmap.tbl から作り直すツール。
 *
 *   node scripts/gen-charmap.ts <NeoDark-CFRU の charmap.tbl>
 *
 * 中身はそのまま文字列として埋め込む（読み方は CharmapTable が決める）。
 */
import { readFileSync, writeFileSync } from "node:fs";

const input = process.argv[2];
if (!input) {
  console.error("使い方: gen-charmap <charmap.tbl>");
  process.exit(2);
}
const text = readFileSync(input, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");
const out =
  "// scripts/gen-charmap.ts で NeoDark-CFRU の charmap.tbl から作ったファイル。手で直さない。\n\n" +
  "/** NeoDark-CFRU の charmap.tbl（同梱の既定の文字コード表）。 */\n" +
  `export const ND_CHARMAP_TBL: string = ${JSON.stringify(text)};\n`;
writeFileSync(new URL("../src/name/charmapNd.ts", import.meta.url), out, "utf8");
console.log(`${text.split("\n").length} 行を書きました`);
