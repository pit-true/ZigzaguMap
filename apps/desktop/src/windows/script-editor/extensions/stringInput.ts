import type { EditorState } from "@codemirror/state";
import { endsWithBreakControl } from "@zigzagumap/core";

// 複数行の本文の入力の決まり（#221）。DOM を使わない部分だけをここに置く（テストから呼ぶ）。

/** 入力欄の文字列を、.string に書く本文（改行は制御記号のすぐ後ろだけ）にする。制御記号の無い改行には `\n` を補う。 */
export function normalizeStringInput(value: string): string {
  const lines = value.replace(/\r\n?/g, "\n").split("\n");
  while (lines.length > 1 && lines[lines.length - 1] === "") lines.pop();
  return lines.map((l, i) => (i < lines.length - 1 && !endsWithBreakControl(l) ? `${l}\\n` : l)).join("\n");
}

/** 本文の改行の文字を除いた、string.py がつないだあとの文字列（幅検査に使う）。 */
export function joinedStringInput(value: string): string {
  return normalizeStringInput(value).replace(/\n/g, "");
}

/** 本文の行か（行の文字だけで決める: 空白だけ・`//`・`#` で始まる行・`MAX_LENGTH=` などではない）。 */
function looksLikeBody(text: string): boolean {
  const t = text.trim();
  return t !== "" && !text.startsWith("//") && !t.startsWith("#") && !/^\s*(MAX_LENGTH|FILL_FF)\s*=/.test(text);
}

/**
 * `.string` で Enter を押したときに入れる文字列。ふつうの改行に任せるときは null。
 * - 本文の行で、カーソルの前が制御記号なら改行だけ（字下げしない）。
 * - 本文の行の途中で、カーソルの前が制御記号でなければ `\n` と改行（そのまま改行すると、後ろが別の文字列になるため）。
 * - 行の終わり・行の頭・本文でない行・選択があるときは null。
 */
export function stringEnterInsert(state: EditorState): string | null {
  const sel = state.selection;
  if (sel.ranges.length !== 1 || !sel.main.empty) return null;
  const pos = sel.main.head;
  const line = state.doc.lineAt(pos);
  if (!looksLikeBody(line.text)) return null;
  const before = line.text.slice(0, pos - line.from);
  const after = line.text.slice(pos - line.from);
  if (endsWithBreakControl(before)) return "\n";
  if (after !== "" && before !== "") return "\\n\n";
  return null;
}
