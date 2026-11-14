/**
 * Chronos の `tools/check_text_width.py` の出力（と、`build.py` が前置きして出す同じ行）から、誤りの行を拾う。
 *
 * 形の例:
 * - `TEXT WIDTH ERROR: cfru/strings/debug_famicom.string:21 gText_X (configured) page 1 line 2: 212 px > 208 px (field ...)`
 * - `TEXT WIDTH ERROR: cfru/strings/x.string:30: gText_Y is not registered in tools/check_text_width.py (...)`
 * - `TEXT WIDTH ERROR: cfru/strings/x.string:16: text line without its own #org (a real line break? use \n)`
 * - `   TEXT WIDTH: cfru/strings/x.string:21 gText_X (widest) page 1: 3 lines, the field message box has 2`（build.py）
 * - `TEXT WIDTH ERROR: cfru/strings/text_width_registry.json: ...`（ファイルと行の分からない誤り）
 */

/** 拾った誤り 1 つ。 */
export interface WidthCheckError {
  /** 出力に書かれたパス（コマンドの作業フォルダからの相対。区切りは `/`）。分からなければ null。 */
  readonly path: string | null;
  /** 行（1 から）。分からなければ null。 */
  readonly line: number | null;
  /** ラベル（分かれば）。 */
  readonly label: string | null;
  /** `TEXT WIDTH ERROR:` の後ろの全部。 */
  readonly message: string;
  /** 同じラベルの同じ行の誤りのうち、`(widest)` のように同じ中身を繰り返すもの（波線は 1 つにまとめてよい）。 */
  readonly case: string | null;
}

const PREFIX = /^\s*TEXT WIDTH(?: ERROR)?:\s*(.*)$/;
const WHERE = /^([^\s:]+\.(?:string|json|py)):(?:(\d+):?)?\s*(.*)$/;
const LABEL = /^([A-Za-z_.][A-Za-z0-9_.]*)(?:\s+\((\w+)\))?/;
const NOT_REGISTERED = /^([A-Za-z_.][A-Za-z0-9_.]*) is not registered/;

/** 出力の 1 行を読む。幅検査の誤りの行でなければ null。 */
export function parseWidthCheckLine(text: string): WidthCheckError | null {
  const m = PREFIX.exec(text);
  if (!m) return null;
  const message = m[1]!.trim();
  const w = WHERE.exec(message);
  if (!w) return { path: null, line: null, label: null, message, case: null };
  const path = w[1]!.replace(/\\/g, "/");
  const line = w[2] ? Number.parseInt(w[2], 10) : null;
  const rest = w[3]!;
  const reg = NOT_REGISTERED.exec(rest);
  if (reg) return { path, line, label: reg[1]!, message, case: null };
  const l = LABEL.exec(rest);
  return { path, line, label: l && !/^(text|registered|cannot|directive)$/.test(l[1]!) ? l[1]! : null, message, case: l?.[2] ?? null };
}

/** 出力のすべての行から誤りを拾う（同じパス・行・ラベル・本文で `(configured)` と `(widest)` の違いだけのものは 1 つにする）。 */
export function parseWidthCheckOutput(lines: readonly string[]): WidthCheckError[] {
  const out: WidthCheckError[] = [];
  const seen = new Set<string>();
  for (const text of lines) {
    const e = parseWidthCheckLine(text);
    if (!e) continue;
    const key = `${e.path}:${e.line}:${e.label}:${e.message.replace(/\((configured|widest)\)/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out;
}
