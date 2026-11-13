import { EditError, parseHexInput, parseIntInput } from "@zigzagumap/core";
import { showEditError } from "./inputErrors";

/**
 * 整数の欄をいつ・どう確かめるか（AdvanceMap の欄ごとの動作をそろえるための共通部品）。
 *
 * AdvanceMap は OnChange で値を読む欄だと 1 文字入れるたびに StrToInt を呼び、読めなければ
 * 「'abc' is not a valid integer value.」を出す（値は変えない）。ボタンを押したときに読む欄は、押すまで確かめない。
 * どちらの欄かは inventory（04〜07 と 16_errors）と実機で確かめた結果に従い、タブごとに書き分けずにこの部品を使う。
 */

/**
 * 欄の書式。
 * - `hex`: `$` を前に付けて読む（AdvanceMap の 16 進欄。空欄は 0）
 * - `int`: そのまま読む（10 進。`$` 付きなら 16 進。オフセット欄のように文字に `$` が入っている欄もこれ）
 */
export type IntegerFormat = "hex" | "int";

/** 書式どおりに読む。読めなければ EditError（文言は AdvanceMap と同じ）。 */
export function parseInteger(text: string, format: IntegerFormat): number {
  return format === "hex" ? parseHexInput(text) : parseIntInput(text);
}

/** 黙って読む。読めなければ null（確かめるのは入力のときに済んでいる欄で使う）。 */
export function tryInteger(text: string, format: IntegerFormat): number | null {
  try {
    return parseInteger(text, format);
  } catch {
    return null;
  }
}

/** 読む。読めなければ AdvanceMap と同じダイアログを出して null（ボタンを押したときに読む欄）。 */
export function readInteger(text: string, format: IntegerFormat): number | null {
  try {
    return parseInteger(text, format);
  } catch (e) {
    if (!(e instanceof EditError)) throw e;
    void showEditError(e);
    return null;
  }
}

/**
 * 入力のたびに確かめる欄にする（AdvanceMap の OnChange で読む欄）。
 * 読めた値は `onValue` に渡し、読めなければダイアログを出して何もしない。
 * 10 進の欄の空欄は、AdvanceMap と同じく何もしない（16 進の空欄は 0）。
 */
export function checkOnInput(input: HTMLInputElement, format: IntegerFormat, onValue: (value: number) => void = () => undefined): void {
  input.addEventListener("input", () => {
    if (format === "int" && input.value.trim() === "") return;
    const value = readInteger(input.value, format);
    if (value !== null) onValue(value);
  });
}

/**
 * 入力のたびに読んで連動させるが、読めなくてもエラーを出さない欄にする
 * （AdvanceMap の高度な表示の境界ブロックの横幅・高さ。読めない間は何もしない）。
 */
export function followInput(input: HTMLInputElement, format: IntegerFormat, onValue: (value: number) => void): void {
  input.addEventListener("input", () => {
    const value = tryInteger(input.value, format);
    if (value !== null) onValue(value);
  });
}
