import { asmOpName, parseAsmLine } from "../asm/AsmLine.js";
import { findLabelOccurrences } from "../edit/LabelRename.js";
import { knownMovementIds, movementAction, movementWithDirection, MOVEMENT_DIRECTIONS, type MovementDirection } from "./MovementActionTable.js";
import { writeMovementBlock, type MovementBlock, type MovementValueFormatter } from "./MovementBlock.js";

/**
 * タイムラインの編集（#458）の計算。移動データの値の並びを編集し、`.s` の新しい本文を作る（文字列の処理だけ。書き込みは画面の側で
 * `ScriptFiles.change` を通す）。できる編集は A-11（向き・速さ・種類の差し替え、前後に足す、消す、並べ替え、同じ命令の回数）。
 */

/** 編集 1 つ。index は移動データの何番目か（0 始まり、`end_m` を含まない）。 */
export type MovementEdit =
  /** 別の命令に差し替える。 */
  | { readonly type: "replace"; readonly index: number; readonly value: number }
  /** 向きだけ変える（向きの 4 つ組の命令だけ）。 */
  | { readonly type: "direction"; readonly index: number; readonly direction: MovementDirection }
  /** index の前（after なら後）に足す。 */
  | { readonly type: "insert"; readonly index: number; readonly value: number; readonly after?: boolean }
  /** 消す。 */
  | { readonly type: "delete"; readonly index: number }
  /** from を to の位置へ動かす（to は動かした後の位置）。 */
  | { readonly type: "move"; readonly from: number; readonly to: number }
  /** index を含む、同じ命令の続き（walk_up, walk_up, walk_up など）の回数を count にする。 */
  | { readonly type: "repeat"; readonly index: number; readonly count: number };

/** 編集を当てた新しい並び。できない編集（範囲の外、向きの無い命令の向き変えなど）は null。 */
export function applyMovementEdit(values: readonly number[], edit: MovementEdit): number[] | null {
  const out = [...values];
  const inRange = (i: number) => Number.isInteger(i) && i >= 0 && i < out.length;
  switch (edit.type) {
    case "replace":
      if (!inRange(edit.index) || !isByte(edit.value)) return null;
      out[edit.index] = edit.value;
      return out;
    case "direction": {
      if (!inRange(edit.index)) return null;
      const v = movementWithDirection(out[edit.index]!, edit.direction);
      if (v === null) return null;
      out[edit.index] = v;
      return out;
    }
    case "insert": {
      if (!Number.isInteger(edit.index) || edit.index < 0) return null;
      const at = edit.after ? edit.index + 1 : edit.index;
      if (!Number.isInteger(at) || at < 0 || at > out.length || !isByte(edit.value)) return null;
      out.splice(at, 0, edit.value);
      return out;
    }
    case "delete":
      if (!inRange(edit.index)) return null;
      out.splice(edit.index, 1);
      return out;
    case "move": {
      if (!inRange(edit.from) || !Number.isInteger(edit.to) || edit.to < 0 || edit.to >= out.length) return null;
      const [v] = out.splice(edit.from, 1);
      out.splice(edit.to, 0, v!);
      return out;
    }
    case "repeat": {
      if (!inRange(edit.index) || !Number.isInteger(edit.count) || edit.count < 1 || edit.count > 255) return null;
      const run = repeatRun(out, edit.index);
      out.splice(run.start, run.count, ...new Array<number>(edit.count).fill(out[edit.index]!));
      return out;
    }
  }
}

function isByte(v: number): boolean {
  return Number.isInteger(v) && v >= 0 && v <= 0xff && v !== 0xfe;
}

/** index を含む、同じ値の続きの始まりと数。 */
export function repeatRun(values: readonly number[], index: number): { start: number; count: number } {
  if (!Number.isInteger(index) || index < 0 || index >= values.length) return { start: index, count: 0 };
  let start = index;
  let end = index;
  while (start > 0 && values[start - 1] === values[index]) start--;
  while (end + 1 < values.length && values[end + 1] === values[index]) end++;
  return { start, count: end - start + 1 };
}

/**
 * 差し替えの候補（同じ向きで種類・速さの違う命令）。向きの 4 つ組の命令なら、同じ向きのほかの組を番号の順に返す。
 * 向きの無い命令は空。
 */
export function movementAlternatives(id: number): number[] {
  const a = movementAction(id);
  if (a.direction === null) return [];
  const out: number[] = [];
  for (const other of knownMovementIds()) {
    if (other === id) continue;
    const b = movementAction(other);
    if (b.direction !== a.direction || b.kind === "unknown") continue;
    if (movementWithDirection(other, a.direction) !== other) continue;
    out.push(other);
  }
  return out;
}

/** 向きの 4 つ組の向き（UI の矢印の順）。 */
export const EDIT_DIRECTIONS: readonly MovementDirection[] = MOVEMENT_DIRECTIONS;

/** ファイル 1 つの書き換え（前の本文と後の本文）。 */
export interface MovementTextChange {
  readonly path: string;
  readonly before: string;
  readonly after: string;
}

/** 移動データの編集の結果。 */
export interface MovementWritePlan {
  readonly changes: readonly MovementTextChange[];
  /** 新しいラベルに写したときの名前。そのまま書き換えたなら null。 */
  readonly newLabel: string | null;
}

/** そのまま書き換える（同じ移動データを使うほかのスクリプトも変わる）。 */
export function planMovementRewrite(path: string, text: string, block: MovementBlock, values: readonly number[], nameOf: MovementValueFormatter): MovementWritePlan {
  return { changes: [{ path, before: text, after: writeMovementBlock(text, block, values, nameOf) }], newLabel: null };
}

/** 写すときの新しいラベルの名前（`<元の名前>_2`、使われていれば `_3`…）。exists はラベルがもうあるか。 */
export function copyLabelName(label: string, exists: (name: string) => boolean): string {
  for (let n = 2; ; n++) {
    const name = `${label}_${n}`;
    if (!exists(name)) return name;
  }
}

/**
 * 新しいラベルに写し、そのスクリプトの `applymovement` の 1 行だけを付け替える（A-8）。
 * - 写した移動データは、元の移動データの `end_m` の行の後ろに、空行をはさまずに足す（書き方は 1 行に並べた形）。
 * - commandPath・commandLine は付け替える `applymovement` のファイルと行（0 始まり）。移動データと同じファイルなら 1 つの書き換えにまとめる。
 * texts はファイルの今の本文。付け替える行にラベルが無ければ null。
 */
export function planMovementCopy(
  args: {
    readonly movementPath: string;
    readonly block: MovementBlock;
    readonly commandPath: string;
    readonly commandLine: number;
    readonly newLabel: string;
    readonly values: readonly number[];
    readonly nameOf: MovementValueFormatter;
  },
  texts: (path: string) => string | null,
): MovementWritePlan | null {
  const { block, newLabel, nameOf } = args;
  const original = texts(args.movementPath);
  if (original === null || block.problem || !block.endStep || !/^[A-Za-z_.$][\w.$]*$/.test(newLabel)) return null;
  // 1. 付け替える行（先にする。移動データと同じファイルなら、行の番号はこの後に足す行より前）。
  const retarget = (text: string): string | null => {
    const rows = splitRows(text);
    const row = rows[args.commandLine];
    if (!row || asmOpName(parseAsmLine(row.text)) !== "applymovement") return null;
    const hit = findLabelOccurrences(row.text, block.label).find((o) => !o.definition);
    if (!hit) return null;
    rows[args.commandLine] = { ...row, text: row.text.slice(0, hit.from) + newLabel + row.text.slice(hit.to) };
    return rows.map((r) => r.text + r.eol).join("");
  };
  // 2. 写した移動データを end_m の行の後ろに足す。
  const append = (text: string): string => {
    const rows = splitRows(text);
    const endLine = block.endStep!.line;
    const eol = rows[endLine]!.eol || (/\r\n/.test(text) ? "\r\n" : "\n");
    const items = [...args.values.map((v) => nameOf(v) ?? `0x${v.toString(16).toUpperCase().padStart(2, "0")}`), block.endStep!.text];
    const line = `${newLabel}: .byte ${items.join(", ")}`;
    if (rows[endLine]!.eol === "") rows[endLine] = { ...rows[endLine]!, eol };
    rows.splice(endLine + 1, 0, { text: line, eol: rows[endLine + 1] ? eol : "" });
    return rows.map((r) => r.text + r.eol).join("");
  };
  if (args.commandPath === args.movementPath) {
    const moved = retarget(original);
    if (moved === null) return null;
    return { changes: [{ path: args.movementPath, before: original, after: append(moved) }], newLabel };
  }
  const commandText = texts(args.commandPath);
  if (commandText === null) return null;
  const moved = retarget(commandText);
  if (moved === null) return null;
  return {
    changes: [
      { path: args.movementPath, before: original, after: append(original) },
      { path: args.commandPath, before: commandText, after: moved },
    ],
    newLabel,
  };
}

function splitRows(text: string): { text: string; eol: string }[] {
  const out: { text: string; eol: string }[] = [];
  const re = /\r?\n/g;
  let from = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    out.push({ text: text.slice(from, m.index), eol: m[0] });
    from = m.index + m[0].length;
  }
  out.push({ text: text.slice(from), eol: "" });
  return out;
}
