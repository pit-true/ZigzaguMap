/**
 * commands.csv（Gen3 Script Assistant 拡張が読む命令の説明）を読む。
 * 列は name, detail, hover, opcode, args。BOM 付き UTF-8 で、`#` で始まる行と空行は飛ばす。
 * `"` で囲んだ値の中の `,`・改行・`""` も読む。
 */

/** CSV の 1 行。 */
export interface CommandCsvEntry {
  name: string;
  /** 補完の一覧に出す短い説明。 */
  detail: string;
  /**
   * ホバーの Markdown。CSV の `\n`（`\\n` とも書く）を改行に直してある。
   * 改行はそのまま行の区切りとして見せる（拡張と同じ）。
   */
  hover: string;
  /** 命令番号（CSV の 16 進）。空なら null。 */
  opcode: number | null;
  /** 引数の並びの略記（`1AA` など。CSV のまま）。 */
  args: string;
  /** CSV の行番号（1 始まり。値が複数行にわたるときは始まりの行）。 */
  line: number;
}

/** CSV を読んだ結果。 */
export interface CommandCsv {
  /** CSV の順。同じ名前が複数あれば全部入れる（例: applymovement の 0x4F と 0x50）。 */
  entries: CommandCsvEntry[];
  /** 読めなかった行と理由。 */
  problems: { line: number; reason: string }[];
}

/** CSV の 1 レコード（値の列と、始まりの行）。 */
interface CsvRecord {
  values: string[];
  line: number;
}

/** CSV を値の列に分ける。`#` で始まる行（引用の外）と空行は飛ばす。 */
function readRecords(text: string): CsvRecord[] {
  const src = text.replace(/^﻿/, "");
  const records: CsvRecord[] = [];
  let i = 0;
  let line = 1;
  while (i < src.length) {
    // 行頭: 飛ばす行か見る。
    const lineEnd = src.indexOf("\n", i);
    const rawLine = src.slice(i, lineEnd === -1 ? src.length : lineEnd).replace(/\r$/, "");
    const trimmed = rawLine.trim();
    if (trimmed === "" || trimmed.startsWith("#")) {
      i = lineEnd === -1 ? src.length : lineEnd + 1;
      line++;
      continue;
    }
    const start = line;
    const values: string[] = [];
    let current = "";
    let quoted = false;
    for (;;) {
      if (i >= src.length) {
        values.push(current);
        break;
      }
      const c = src[i]!;
      if (quoted) {
        if (c === '"' && src[i + 1] === '"') {
          current += '"';
          i += 2;
        } else if (c === '"') {
          quoted = false;
          i++;
        } else {
          if (c === "\n") line++;
          current += c;
          i++;
        }
        continue;
      }
      if (c === '"') {
        quoted = true;
        i++;
      } else if (c === ",") {
        values.push(current);
        current = "";
        i++;
      } else if (c === "\r" && src[i + 1] === "\n") {
        i++;
      } else if (c === "\n") {
        values.push(current);
        i++;
        line++;
        break;
      } else {
        current += c;
        i++;
      }
    }
    records.push({ values, line: start });
  }
  return records;
}

/** CSV の `\n` / `\\n` を改行にする。 */
function decodeHover(text: string): string {
  return text.replace(/\\\\n|\\n/g, "\n");
}

/** commands.csv の文字列を読む。先頭の行（飛ばす行を除く）を見出しとする。例外は投げない。 */
export function parseCommandCsv(text: string): CommandCsv {
  const records = readRecords(text);
  const entries: CommandCsvEntry[] = [];
  const problems: CommandCsv["problems"] = [];
  const header = records[0];
  if (!header) return { entries, problems };
  const columns = header.values.map((h) => h.trim().toLowerCase());
  const col = (name: string) => columns.indexOf(name);
  const nameCol = col("name");
  if (nameCol === -1) {
    problems.push({ line: header.line, reason: "見出しに name の列がありません" });
    return { entries, problems };
  }
  const get = (r: CsvRecord, name: string) => {
    const c = col(name);
    return c === -1 ? "" : (r.values[c] ?? "");
  };
  for (const r of records.slice(1)) {
    const name = (r.values[nameCol] ?? "").trim();
    if (name === "") {
      problems.push({ line: r.line, reason: "name が空です" });
      continue;
    }
    const opcodeText = get(r, "opcode").trim();
    let opcode: number | null = null;
    if (opcodeText !== "") {
      if (/^(0x)?[0-9a-f]+$/i.test(opcodeText)) opcode = Number.parseInt(opcodeText.replace(/^0x/i, ""), 16);
      else problems.push({ line: r.line, reason: `opcode が 16 進数ではありません: ${opcodeText}` });
    }
    entries.push({
      name,
      detail: get(r, "detail").trim(),
      hover: decodeHover(get(r, "hover")),
      opcode,
      args: get(r, "args").trim(),
      line: r.line,
    });
  }
  return { entries, problems };
}
