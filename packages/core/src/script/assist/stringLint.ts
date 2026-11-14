import { endsWithBreakControl, parseStringFile, stringLineOffsets } from "../strings/StringFile.js";
import { checkStringFileWidth, type TextWidthOptions } from "../strings/TextWidth.js";
import type { ScriptDiagnostic } from "./asmLint.js";
import type { ScriptStringIndex } from "./ScriptStringIndex.js";

/**
 * `.string` の本文（改行は `\n`）を調べて波線を返す。
 * - 同じファイルに同じラベルの `#org` が 2 つ以上: 2 つ目からエラー
 * - 別の `.string` に同じラベルがある: 警告（`strings` の索引を渡したときだけ。`path` はこのファイル）
 * - 簡易の幅検査（字数）: 上限を超えた行に警告（`width` を null にすると調べない）
 * - 続きにならない本文の行（#221）: 前の本文の行が制御記号で終わらず、ラベルの付かない別の文字列になる行に警告。
 *   前の行が制御記号と空白で終わるなら、その空白に「空白を消すと続きになる」の警告
 */
export function lintStringText(
  text: string,
  options: { path?: string; strings?: ScriptStringIndex | null; width?: TextWidthOptions | null } = {},
): ScriptDiagnostic[] {
  const file = parseStringFile(text);
  const offsets = stringLineOffsets(file);
  const out: ScriptDiagnostic[] = [];
  const seen = new Map<string, number>();
  for (const e of file.entries) {
    const from = offsets[e.headerLine]!;
    const to = from + file.lines[e.headerLine]!.text.length;
    const first = seen.get(e.label);
    if (first !== undefined) {
      out.push({ from, to, severity: "error", code: "duplicateString", params: { label: e.label, line: first } });
      continue;
    }
    seen.set(e.label, e.headerLine + 1);
    if (options.strings && options.path) {
      const other = options.strings.find(e.label).find((x) => x.path !== options.path);
      if (other) out.push({ from, to, severity: "warning", code: "duplicateStringOther", params: { label: e.label, path: other.path, line: other.line } });
    }
  }
  for (const e of file.entries) {
    for (const lines of e.strings.slice(1)) {
      const n = lines[0]!;
      const prev = file.lines[n - 1]!;
      const trimmed = prev.text.replace(/[ 	]+$/, "");
      if (trimmed !== prev.text && endsWithBreakControl(trimmed)) {
        const from = offsets[n - 1]! + trimmed.length;
        out.push({ from, to: offsets[n - 1]! + prev.text.length, severity: "warning", code: "spaceAfterBreak", params: { label: e.label } });
      } else {
        const from = offsets[n]!;
        out.push({ from, to: from + file.lines[n]!.text.length, severity: "warning", code: "strayStringLine", params: { label: e.label } });
      }
    }
  }
  if (options.width !== null) {
    for (const issue of checkStringFileWidth(file, options.width ?? {})) {
      out.push({
        from: issue.overflowFrom,
        to: Math.max(issue.to, issue.overflowFrom + 1),
        severity: "warning",
        code: "textWidth",
        params: {
          label: issue.label,
          kind: issue.kind,
          page: issue.page + 1,
          line: issue.line + 1,
          columns: issue.columns,
          limit: issue.limit,
        },
      });
    }
  }
  return out;
}
