import { asmWordAt, type AnalyzedLine, type ScriptAssist } from "./ScriptAssist.js";

/** 定義の場所 1 つ。 */
export interface DefinitionTarget {
  /** プロジェクトフォルダからの相対パス（区切りは `/`）。 */
  readonly path: string;
  /** 行（1 始まり）。 */
  readonly line: number;
}

/** 定義へ移動の行き先。`start`〜`end` は名前の範囲（行の中の桁）。 */
export interface AsmDefinition {
  /** label = `.s` のラベル、string = `.string` の `#org`、equ = `.equ`、macro = xse_commands.s のマクロ。 */
  readonly kind: "label" | "string" | "equ" | "macro";
  readonly name: string;
  readonly start: number;
  readonly end: number;
  /** 行き先（同じ名前がいくつもあれば全部。先頭が第一候補）。 */
  readonly targets: readonly DefinitionTarget[];
}

/**
 * 1 行の、桁 `column` にある名前の定義。名前でなければ null。見つからなければ targets を空にして返す。
 * 引く順は、ラベル（assembly の `.s`）→ 文字列のラベル（strings の `.string`）→ `.equ`。命令の名前ならマクロ。
 * 同じファイルの定義が先に来るよう、`currentPath` のものを先頭にする。
 */
export function asmDefinitionAt(assist: ScriptAssist, a: AnalyzedLine, column: number, currentPath?: string): AsmDefinition | null {
  if (a.line.tokens.some((t) => t.kind === "comment" && column >= t.start && column < t.end)) return null;
  const word = asmWordAt(a.line.text, column);
  if (!word) return null;
  const name = a.line.text.slice(word.start, word.end);
  if (/^[0-9]/.test(name) || name.startsWith(".")) return null;
  const op = a.line.op;
  if (op && word.start >= op.start && word.end <= op.end) {
    const macro = a.command?.macro;
    return { kind: "macro", name, start: word.start, end: word.end, targets: macro ? [{ path: "xse_commands.s", line: macro.line }] : [] };
  }
  const order = <T extends DefinitionTarget>(list: readonly T[]): DefinitionTarget[] =>
    [...list].sort((x, y) => Number(y.path === currentPath) - Number(x.path === currentPath)).map((t) => ({ path: t.path, line: t.line }));
  const labels = assist.index.findLabels(name);
  if (labels.length > 0) return { kind: "label", name, start: word.start, end: word.end, targets: order(labels) };
  const strings = assist.strings.find(name);
  if (strings.length > 0) return { kind: "string", name, start: word.start, end: word.end, targets: order(strings) };
  const equs = assist.index.findEqus(name);
  if (equs.length > 0) return { kind: "equ", name, start: word.start, end: word.end, targets: order(equs) };
  return { kind: "label", name, start: word.start, end: word.end, targets: [] };
}
