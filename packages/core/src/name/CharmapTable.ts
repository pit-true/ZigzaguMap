/**
 * charmap.tbl（`XX=文字`、`XX YY ZZ=文字` の行の並び）を読んだ文字コード表。
 *
 * - 左辺は 16 進のバイト（空白区切りで複数可。例: `FC 88 9F=亜`）。
 * - 同じバイト列や同じ文字が何度出てもよい。文字 → バイトは最初の定義を使う。
 * - 右辺の `\$` と `\"` は `$` と `"`、`\n` は改行として扱う。それ以外の `\l` などは書いたままの文字列。
 * - `/FF` のように `/` で始まる行は終端の宣言。終端のバイト（既定 0xFF）の定義は文字として使わない。
 * - `=` の無い行、左辺が 16 進でない行は読み飛ばす。
 */
export interface CharmapEntry {
  readonly bytes: Uint8Array;
  readonly text: string;
}

/** 文字列の終端（0xFF）。 */
const DEFAULT_TERMINATOR = 0xff;

/** charmap.tbl を読んだ表。 */
export class CharmapTable {
  /** 定義（ファイルの順）。終端の定義は含まない。 */
  readonly entries: readonly CharmapEntry[];
  /** 終端のバイト。 */
  readonly terminator: number;

  constructor(entries: readonly CharmapEntry[], terminator = DEFAULT_TERMINATOR) {
    this.entries = entries;
    this.terminator = terminator;
  }

  /** charmap.tbl の文字列を読む。 */
  static parse(text: string): CharmapTable {
    const entries: CharmapEntry[] = [];
    let terminator = DEFAULT_TERMINATOR;
    for (const rawLine of text.replace(/^﻿/, "").split(/\r?\n/)) {
      const line = rawLine;
      if (line.startsWith("/")) {
        const m = /^\/([0-9A-Fa-f]{2})\s*$/.exec(line);
        if (m) terminator = parseInt(m[1]!, 16);
        continue;
      }
      const eq = line.indexOf("=");
      if (eq <= 0) continue;
      const left = line.slice(0, eq).trim();
      if (!/^[0-9A-Fa-f]{2}(?: [0-9A-Fa-f]{2})*$/.test(left)) continue;
      const bytes = Uint8Array.from(left.split(" ").map((h) => parseInt(h, 16)));
      const value = unescapeValue(line.slice(eq + 1));
      if (value === "") continue;
      entries.push({ bytes, text: value });
    }
    return new CharmapTable(
      entries.filter((e) => !(e.bytes.length === 1 && e.bytes[0] === terminator)),
      terminator,
    );
  }
}

function unescapeValue(value: string): string {
  if (value === "\\n") return "\n";
  if (value === "\\$") return "$";
  if (value === '\\"') return '"';
  return value;
}
