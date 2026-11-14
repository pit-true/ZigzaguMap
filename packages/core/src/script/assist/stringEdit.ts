import { findStringEntry, parseStringFile, replaceStringBody, stringifyStringFile } from "../strings/StringFile.js";

/** 本文の差し替え 1 つ（`from`〜`to` を `insert` にする。位置は本文の中の UTF-16 の位置）。 */
export interface TextChange {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/**
 * `.string` の本文（改行は `\n`）で、ラベルの本文を `body` に差し替える変更を作る。
 * 書き戻しの決まりは replaceStringBody と同じ（最初の本文の行だけを変える。本文の無い `#org` には 1 行足す）。
 * 変わらなければ null。ラベルが無い・本文に書けない文字列なら StringFileError。
 */
export function planStringBodyEdit(text: string, label: string, body: string): TextChange | null {
  const before = parseStringFile(text);
  const after = stringifyStringFile(replaceStringBody(before, label, body));
  if (after === text) return null;
  return minimalChange(text, after);
}

/** ラベルの本文（最初の本文の行）。本文が無ければ空、ラベルが無ければ null。 */
export function stringBodyOf(text: string, label: string): string | null {
  const entry = findStringEntry(parseStringFile(text), label);
  return entry ? entry.text : null;
}

/** 2 つの文字列の違う範囲だけを置き換える変更。 */
export function minimalChange(before: string, after: string): TextChange {
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return { from: start, to: before.length - end, insert: after.slice(start, after.length - end) };
}
