// 画面の文言の元になる Japanese.ini から、文言のモジュール（ini.generated.ts）を作る。
//
//   node scripts/gen-i18n.mjs          作り直す
//   node scripts/gen-i18n.mjs --check  作り直した結果と今のファイルが同じか確かめる（違えば終了コード 1）
//
// ini は apps/desktop/src/i18n/source/Japanese.ini（UTF-8。BOM と CRLF はあってもよい）。
// 値の扱い:
//   - AdvanceMap 1.95 向けの注記（「(AM1.95未使用)」など）は stripNote で外す
//   - 行末の空白とタブは外す
//   - 注記を外して空になった値は出さない（その番号は無いものとして扱う）
// 節は EXCLUDED_SECTIONS に挙げたもの以外をすべて出す。
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const INI_PATH = join(ROOT, "apps/desktop/src/i18n/source/Japanese.ini");
export const OUT_PATH = join(ROOT, "apps/desktop/src/i18n/ini.generated.ts");

/** ZigzaguMap に該当する機能が無いので出さない節（ルビー・サファイア・エメラルドの挙動、季節など）。 */
const EXCLUDED_SECTIONS = new Set([
  "LanguageSections",
  "Verhalten_RS",
  "Hintergrund_RS",
  "Verhalten_E",
  "Hintergrund_E",
  "Season",
  "TimePeriod",
  "SeasonForm",
]);

/**
 * AdvanceMap 1.95 の利用者向けの注記。ZigzaguMap では表示しない。
 * 方針を変えるときはここだけを直す。
 */
const NOTE_PATTERN = /[(（]※?AM\d+(?:\.\d+)*(?:未使用|使用不可)[)）]/g;

/** 値から 1.95 向けの注記を外す。 */
export function stripNote(value) {
  return value.replace(NOTE_PATTERN, "");
}

/** 値の中の注記を返す（check-i18n.mjs の報告用）。 */
export function findNotes(value) {
  return value.match(NOTE_PATTERN) ?? [];
}

/** ini の文字列を節ごとの { 番号: 値 } にする（値は ini のまま）。 */
export function parseIni(text) {
  const sections = new Map();
  let current = null;
  for (const raw of text.replace(/^﻿/, "").split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith(";")) continue;
    const head = /^\[(.+)\]$/.exec(line);
    if (head) {
      current = sections.get(head[1]) ?? new Map();
      sections.set(head[1], current);
      continue;
    }
    const eq = raw.indexOf("=");
    if (current === null || eq < 0) continue;
    const key = raw.slice(0, eq).trim();
    if (current.has(key)) console.warn(`警告: 番号が重複しています: [${[...sections].find(([, v]) => v === current)[0]}] ${key}`);
    current.set(key, raw.slice(eq + 1));
  }
  return sections;
}

/** 画面に出す値（注記と行末の空白を外したもの。空になれば null）。 */
export function displayValue(value) {
  const v = stripNote(value).replace(/[ \t]+$/, "");
  return v === "" ? null : v;
}

/** 生成するモジュールの中身。 */
export function generate(text) {
  const sections = parseIni(text);
  const out = [
    "// このファイルは scripts/gen-i18n.mjs が source/Japanese.ini から作る。手で直さない。",
    "// 文言を変えるときは source/Japanese.ini を直して `node scripts/gen-i18n.mjs` を実行する。",
    "",
    "/** Japanese.ini の値（節 → 番号 → 文言）。AdvanceMap 1.95 向けの注記は外してある。 */",
    "export const ini = {",
  ];
  for (const [name, entries] of sections) {
    if (EXCLUDED_SECTIONS.has(name)) continue;
    out.push(`  ${JSON.stringify(name)}: {`);
    for (const [key, value] of entries) {
      const v = displayValue(value);
      if (v !== null) out.push(`    ${JSON.stringify(key)}: ${JSON.stringify(v)},`);
    }
    out.push("  },");
  }
  out.push("} as const;", "");
  return out.join("\n");
}

function main() {
  const text = readFileSync(INI_PATH, "utf8");
  const next = generate(text);
  if (process.argv.includes("--check")) {
    let now = "";
    try {
      now = readFileSync(OUT_PATH, "utf8");
    } catch {
      // 無ければ違うとみなす
    }
    if (now !== next) {
      console.error("ini.generated.ts が Japanese.ini と合っていません。node scripts/gen-i18n.mjs で作り直してください。");
      process.exit(1);
    }
    console.log("ini.generated.ts は Japanese.ini と合っています。");
    return;
  }
  writeFileSync(OUT_PATH, next);
  console.log(`作りました: ${OUT_PATH}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
