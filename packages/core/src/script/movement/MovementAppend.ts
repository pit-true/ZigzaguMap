import { asmOpName, asmTokenText, parseAsmLine } from "../asm/AsmLine.js";
import { isScriptLabelName } from "../edit/LabelNaming.js";
import type { MovementValueFormatter } from "./MovementBlock.js";
import type { MovementWritePlan } from "./MovementEdit.js";

/**
 * なぞった道（#518）を新しいラベルの移動データとして `.s` に足す計算。文字列の処理だけで、書き込みは画面の側で
 * `ScriptFiles.change` を通す。書き方は ND・Chronos の移動データと同じ 1 行の形（`Move_Moegi_1: .byte walk_up, end_m`）。
 */

/** 新しい移動データのラベル名（`Move_<マップ名>_<番号>`。番号は 1 から、使われていれば次）。 */
export function newMovementLabel(mapName: string, exists: (name: string) => boolean): string {
  for (let n = 1; ; n++) {
    const name = `Move_${mapName}_${n}`;
    if (!exists(name)) return name;
  }
}

/** 値を `.byte` に書く文字（名前があれば名前、無ければ 16 進）。 */
export function movementItemText(value: number, nameOf: MovementValueFormatter): string {
  return nameOf(value) ?? `0x${value.toString(16).toUpperCase().padStart(2, "0")}`;
}

/**
 * ファイルの最後に、空行を 1 つはさんで新しい移動データを足す。useGlobal なら前に `.global <ラベル>` を書く。
 * 改行はファイルの形（CRLF か LF）に合わせる。ラベル名が使えない字を含めば null。
 */
export function planMovementAppend(
  args: { readonly path: string; readonly text: string; readonly label: string; readonly values: readonly number[]; readonly nameOf: MovementValueFormatter; readonly useGlobal?: boolean },
): MovementWritePlan | null {
  const { path, text, label } = args;
  if (!isScriptLabelName(label)) return null;
  const eol = /\r\n/.test(text) ? "\r\n" : "\n";
  const items = [...args.values.map((v) => movementItemText(v, args.nameOf)), args.nameOf(0xfe) ?? "end_m"];
  const lines = [...(args.useGlobal ? [`.global ${label}`] : []), `${label}: .byte ${items.join(", ")}`];
  const head = text === "" || /\n[ \t]*\r?\n$/.test(text) ? text : text.endsWith("\n") ? text + eol : text + eol + eol;
  return { changes: [{ path, before: text, after: head + lines.join(eol) + eol }], newLabel: label };
}

/** `applymovement` の行の人物（1 つ目の引数の文字）と移動データのラベル（最後の引数）。違う行なら null。 */
export function readApplyMovementLine(text: string): { readonly actor: string; readonly label: string } | null {
  const line = parseAsmLine(text);
  if (asmOpName(line) !== "applymovement" || line.args.length < 2) return null;
  const label = asmTokenText(line, line.args[line.args.length - 1]!);
  if (!isScriptLabelName(label)) return null;
  return { actor: asmTokenText(line, line.args[0]!), label };
}
