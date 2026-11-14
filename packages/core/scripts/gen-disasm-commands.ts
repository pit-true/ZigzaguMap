/**
 * 素の ROM の逆アセンブルに使う同梱の命令の一覧（src/script/disasm/bundledCommands.ts）を作り直すツール。
 *
 *   pnpm -C packages/core build
 *   node scripts/gen-disasm-commands.ts <xse_commands.s のあるフォルダ> [--skip-opcodes 2c,2d,74]
 *
 * フォルダは 0F が 1 ポインタの CFRU のもの（Chronos の cfru など）。フォルダの xse_defines.s と asm_defines.s も読む。
 * 書き出すのは、逆アセンブルに要る分（命令番号・名前・バイトの並び・引数の名前と種類）と移動の名前だけ。
 * --skip-opcodes には、そのフォルダだけで命令を変えた番号（素の ROM とは違う番号）を書く。
 * 同梱の表は Chronos の cfru から 2c,2d,74（npcmsgbox・settimeofday・customchoice）を除いて作った。
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DisasmCommandSet, ScriptCommandTable, movementNamesFromDefines } from "@zigzagumap/core";

const args = process.argv.slice(2);
const dir = args[0];
if (!dir) {
  console.error("使い方: gen-disasm-commands <xse_commands.s のあるフォルダ> [--skip-opcodes 2c,2d,74]");
  process.exit(2);
}
const skipAt = args.indexOf("--skip-opcodes");
const skip = new Set(skipAt >= 0 ? (args[skipAt + 1] ?? "").split(",").filter((s) => s !== "").map((s) => parseInt(s, 16)) : []);

const read = (name: string) => readFileSync(join(dir, name), "utf8");
const defines = ["xse_defines.s", "asm_defines.s"].filter((n) => existsSync(join(dir, n))).map(read);
const table = ScriptCommandTable.build({ xseCommands: read("xse_commands.s"), defines });

// 移動の名前は xse_defines.s の look_down から end_m まで。
const moves = movementNamesFromDefines(read("xse_defines.s"));

const full = DisasmCommandSet.fromCommandTable(table, moves);
const set = new DisasmCommandSet(full.variants.filter((v) => !skip.has(v.opcode)), moves);
const commandLines = set
  .serialize()
  .split("\n")
  .map((l) => `  ${JSON.stringify(l)},\n`)
  .join("");
const movementLines = [...moves]
  .sort((a, b) => a[0] - b[0])
  .map(([k, v]) => `  ${JSON.stringify(k.toString(16).padStart(2, "0"))}: ${JSON.stringify(v)},\n`)
  .join("");

const out =
  "// scripts/gen-disasm-commands.ts で、0F が 1 ポインタの CFRU の xse_commands.s・xse_defines.s から作ったファイル。手で直さない。\n" +
  (skip.size > 0 ? `// 除いた命令番号: ${[...skip].map((n) => `0x${n.toString(16).padStart(2, "0")}`).join(", ")}\n` : "") +
  "\n" +
  "/** 同梱の命令の一覧（DisasmCommandSet.serialize の形。1 行が 1 つの型）。 */\n" +
  `export const BUNDLED_DISASM_COMMANDS: string = [\n${commandLines}].join("\\n");\n\n` +
  "/** 同梱の移動の名前（16 進の値 → 名前）。 */\n" +
  `export const BUNDLED_MOVEMENT_NAMES: Readonly<Record<string, string>> = {\n${movementLines}};\n`;
writeFileSync(new URL("../src/script/disasm/bundledCommands.ts", import.meta.url), out, "utf8");
console.log(`命令の型 ${set.variants.length} 個、移動の名前 ${moves.size} 個を書きました`);
