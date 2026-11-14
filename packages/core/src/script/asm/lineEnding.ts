/** テキストファイルの改行（`.s` と `.string` で使う）。 */
export type AsmLineEnding = "\n" | "\r\n";

/**
 * ファイルの改行を判定する。CRLF の行が LF だけの行より多ければ CRLF、それ以外（改行が無い・同数を含む）は LF。
 * 書き戻すときにこの改行へそろえる。
 */
export function detectAsmLineEnding(text: string): AsmLineEnding {
  let crlf = 0;
  let lf = 0;
  for (let i = text.indexOf("\n"); i >= 0; i = text.indexOf("\n", i + 1)) {
    if (i > 0 && text.charCodeAt(i - 1) === 13) crlf++;
    else lf++;
  }
  return crlf > lf ? "\r\n" : "\n";
}

/** 改行を `eol` にそろえる（LF・CRLF が混ざった文字列も、すべて `eol` になる）。 */
export function applyAsmLineEnding(text: string, eol: AsmLineEnding): string {
  return text.replace(/\r?\n/g, eol);
}

/** 行に分ける（LF と CRLF のどちらも区切りにする。各行に改行は含まない）。 */
export function splitAsmLines(text: string): string[] {
  return text.split(/\r?\n/);
}
