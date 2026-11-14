/** 本文の変更（CodeMirror の `changes` の形）。 */
export interface TextChangeSpec {
  readonly changes: { readonly from: number; readonly to: number; readonly insert: string };
}

/** 2 つの本文の、変わった範囲だけを置き換える変更（同じなら null）。カーソルと選択が同じ場所に残る。 */
export function minimalChange(before: string, after: string): TextChangeSpec | null {
  if (before === after) return null;
  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let end = 0;
  while (end < max - start && before.charCodeAt(before.length - 1 - end) === after.charCodeAt(after.length - 1 - end)) end++;
  return { changes: { from: start, to: before.length - end, insert: after.slice(start, after.length - end) } };
}
