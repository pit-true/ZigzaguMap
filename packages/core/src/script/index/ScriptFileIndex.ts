import { asmEquDefinition, asmGlobalNames, asmIncludePath, parseAsmLine, type AsmLine } from "../asm/AsmLine.js";
import { detectAsmLineEnding, splitAsmLines, type AsmLineEnding } from "../asm/lineEnding.js";

/** ラベル定義。 */
export interface ScriptLabel {
  readonly name: string;
  /** プロジェクトフォルダからの相対パス（区切りは `/`）。 */
  readonly path: string;
  /** 行（1 始まり）。 */
  readonly line: number;
  /** 桁（0 始まり）。 */
  readonly column: number;
  /** 同じファイルに `.global` があるか。 */
  readonly global: boolean;
  /** 先頭の数行（ホバー用。字下げと後ろのコメントを除き、続く空白は 1 つにまとめる）。 */
  readonly preview: readonly string[];
}

/** `.equ`（`.set` なども）の定義。 */
export interface ScriptEqu {
  readonly name: string;
  /** 値（書いたままの文字列。`0x11`、`FLAG_X + 1` など）。 */
  readonly value: string;
  /** 同じ行の `@` コメント。無ければ null。 */
  readonly description: string | null;
  readonly path: string;
  /** 行（1 始まり）。 */
  readonly line: number;
}

/** 1 ファイル分の索引。 */
export interface ScriptFileIndex {
  readonly path: string;
  /** 読んだときの改行。書き戻すときに使う。 */
  readonly lineEnding: AsmLineEnding;
  readonly labels: readonly ScriptLabel[];
  readonly equs: readonly ScriptEqu[];
  /** `.include` のパス（書いたまま）。 */
  readonly includes: readonly string[];
  /** 移動の名前（`xse_defines.s` の `look_down` から `end_m` までの `.equ`）。他のファイルでは空。 */
  readonly movements: readonly string[];
}

/** プレビューに入れる行の数。 */
export const SCRIPT_LABEL_PREVIEW_LINES = 4;
/** プレビューの 1 行の長さの上限（これより長い行は切る）。 */
export const SCRIPT_LABEL_PREVIEW_WIDTH = 80;

/** 移動の名前を持つファイル。 */
export const SCRIPT_MOVEMENT_FILE = "xse_defines.s";
/** 移動の名前の最初と最後の `.equ`。 */
const MOVEMENT_FIRST = "look_down";
const MOVEMENT_LAST = "end_m";

/**
 * `.s` の 1 ファイルを読んで索引を作る。
 *
 * - `/* *\/` の中の行はラベルにしない。数字だけのローカルラベル（`1:`）は入れない。
 * - プレビューは、ラベルと同じ行の後ろ（`.byte ...` など）と、続く行のうち命令かディレクティブのある行を
 *   最大 {@link SCRIPT_LABEL_PREVIEW_LINES} 行。次のラベルの行で止める。
 * - `path` が {@link SCRIPT_MOVEMENT_FILE} のときだけ移動の名前を拾う。
 */
export function indexAsmFile(path: string, text: string): ScriptFileIndex {
  const rows = splitAsmLines(text);
  const lines: AsmLine[] = new Array(rows.length);
  let inBlock = false;
  for (let i = 0; i < rows.length; i++) {
    const line = parseAsmLine(rows[i]!, inBlock);
    lines[i] = line;
    inBlock = line.endsInBlockComment;
  }

  const globals = new Set<string>();
  const includes: string[] = [];
  const equs: ScriptEqu[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (!line.op) continue;
    for (const name of asmGlobalNames(line)) globals.add(name);
    const include = asmIncludePath(line);
    if (include !== null) includes.push(include);
    const equ = asmEquDefinition(line);
    if (equ) equs.push({ name: equ.name, value: equ.value, description: line.comment || null, path, line: i + 1 });
  }

  const labels: ScriptLabel[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    for (const token of line.labels) {
      const name = line.text.slice(token.start, token.end);
      if (isLocalLabel(name)) continue;
      labels.push({ name, path, line: i + 1, column: token.start, global: globals.has(name), preview: preview(lines, i) });
    }
  }

  return {
    path,
    lineEnding: detectAsmLineEnding(text),
    labels,
    equs,
    includes,
    movements: path === SCRIPT_MOVEMENT_FILE ? movementNames(equs) : [],
  };
}

function isLocalLabel(name: string): boolean {
  const c = name.charCodeAt(0);
  return c >= 48 && c <= 57;
}

function preview(lines: readonly AsmLine[], index: number): string[] {
  const out: string[] = [];
  const own = lines[index]!;
  if (own.op) out.push(clip(codeText(own, own.op.start)));  for (let i = index + 1; i < lines.length && out.length < SCRIPT_LABEL_PREVIEW_LINES; i++) {
    const line = lines[i]!;
    if (line.labels.length > 0) break;
    if (!line.op) continue;
    out.push(clip(codeText(line, line.op.start)));
  }
  return out;
}

/** 命令の始まりから最後の引数まで（後ろのコメントは除き、続く空白は 1 つにまとめる）。 */
function codeText(line: AsmLine, start: number): string {
  const last = line.args[line.args.length - 1] ?? line.op!;
  return line.text.slice(start, last.end).replace(/\s+/g, " ");
}

function clip(s: string): string {
  return s.length > SCRIPT_LABEL_PREVIEW_WIDTH ? s.slice(0, SCRIPT_LABEL_PREVIEW_WIDTH - 1) + "…" : s;
}

/** `look_down` から `end_m` までの `.equ` の名前（ファイルの順）。どちらかが無ければ空。 */
function movementNames(equs: readonly ScriptEqu[]): string[] {
  const first = equs.findIndex((e) => e.name === MOVEMENT_FIRST);
  if (first < 0) return [];
  const last = equs.findIndex((e, i) => i >= first && e.name === MOVEMENT_LAST);
  if (last < 0) return [];
  return equs.slice(first, last + 1).map((e) => e.name);
}
