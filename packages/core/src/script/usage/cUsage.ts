import { evaluateMacroExpression } from "../commands/macroExpression.js";
import { isVariableNumber } from "./eventUsage.js";
import type { UsageSite } from "./UsageIndex.js";

/** フラグと変数の定数を定義しているヘッダー（ここの定義だけでは「使っている」とみなさない）。 */
export const C_CONSTANT_HEADERS: readonly string[] = ["include/constants/flags.h", "include/constants/vars.h"];

/** C のソースを探すフォルダ（プロジェクトフォルダからの相対）。 */
export const C_SOURCE_DIRS: readonly string[] = ["src", "include"];

const NAME_RE = /\b(?:FLAG|VAR)_[A-Za-z0-9_]+\b/g;
const DEFINE_RE = /^\s*#\s*define\s+([A-Za-z_][A-Za-z0-9_]*)(?!\()\s*(.*)$/;

/** コメントを外す（行の数は変えない）。 */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " ")).replace(/\/\/[^\n]*/g, "");
}

/**
 * C のソース（`src/`・`include/`）が使うフラグと変数（#227）。
 *
 * - `#define 名前 値`（引数の無いもの）をすべて読み、`FLAG_*`・`VAR_*` の名前を番号にする（`(SYS_FLAGS + 0x5)` のような式も）。
 * - 使っているとみなすのは、`flags.h`・`vars.h` の外に出てくる `FLAG_*`・`VAR_*` の名前（コメントは除く）。
 *   `src/config.h` の `#define FLAG_INVERSE 0x900` のように、定数のヘッダーの外で定義しているものも使っているとみなす。
 * - 番号にできない名前（引数つきのマクロなど）は数えない。
 */
export function cSourceUsage(files: readonly { readonly path: string; readonly text: string }[]): UsageSite[] {
  const defines = new Map<string, string>();
  const uses: { name: string; path: string; line: number }[] = [];
  for (const f of files) {
    const constants = C_CONSTANT_HEADERS.includes(f.path);
    const lines = stripComments(f.text).split(/\r?\n/);
    lines.forEach((raw, i) => {
      const def = DEFINE_RE.exec(raw);
      if (def) {
        const [, name, value] = def;
        if (!defines.has(name!)) defines.set(name!, value!.trim());
        if (constants) return;
      }
      for (const m of raw.matchAll(NAME_RE)) uses.push({ name: m[0], path: f.path, line: i + 1 });
    });
  }
  const cache = new Map<string, number | null>();
  const resolve = (name: string): number | null => {
    if (cache.has(name)) return cache.get(name)!;
    const text = defines.get(name);
    if (text === undefined) return null;
    cache.set(name, null);
    const v = text === "" ? null : evaluateMacroExpression(text.replace(/\bu\b|(?<=[0-9a-fA-F])[uUlL]+\b/g, ""), resolve);
    cache.set(name, v);
    return v;
  };
  const out: UsageSite[] = [];
  const seen = new Set<string>();
  for (const u of uses) {
    const value = resolve(u.name);
    if (value === null || value < 0) continue;
    const kind = u.name.startsWith("FLAG_") ? "flag" : "var";
    if (kind === "var" && !isVariableNumber(value)) continue;
    const key = `${kind}:${value}:${u.path}`;
    if (seen.has(key)) continue; // 同じファイルの同じ番号は 1 つにまとめる（一覧を短くするため）
    seen.add(key);
    out.push({ kind, value, source: "c", where: `${u.path}:${u.line}（${u.name}）`, path: u.path, line: u.line });
  }
  return out;
}
