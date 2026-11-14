/**
 * スクリプトエディタで開くファイルの、パスの決まりと文字の読み書き（DOM を使わない。メインとエディタの両方から使う）。
 *
 * - 開けるのは `assembly/overworld_scripts/` と `strings/` の下のファイルだけ（SPEC の Phase2）。
 * - CodeMirror は改行を `\n` にそろえて持つので、読んだときの改行（LF / CRLF / CR）と BOM を覚え、保存で元の形に戻す。
 *   改行が混ざっているファイルは、いちばん多い形にそろえて保存する。
 */

/** 開けるフォルダ（プロジェクトフォルダからの相対パス。区切りは `/`）。 */
export const SCRIPT_EDITOR_FOLDERS: readonly string[] = ["assembly/overworld_scripts/", "strings/"];

/** ファイルの種類（色付けなどの拡張が見分けに使う）。`.string` は文字列、ほかは `.s`。 */
export type ScriptFileKind = "asm" | "string";

/** 改行の形。 */
export type LineEnding = "\n" | "\r\n" | "\r";

/** 読んだ本文を、エディタに渡す形にしたもの。 */
export interface DecodedText {
  /** 改行を `\n` にそろえ、BOM を外した本文。 */
  readonly text: string;
  readonly lineEnding: LineEnding;
  readonly bom: boolean;
}

/** パスの区切りを `/` にそろえ、先頭の `./` を外す。 */
export function normalizeScriptPath(path: string): string {
  let p = path.replace(/\\/g, "/");
  while (p.startsWith("./")) p = p.slice(2);
  return p;
}

/** エディタで開けるパスか（`..` や絶対パスは不可。大文字小文字は区別しない）。 */
export function isEditableScriptPath(path: string): boolean {
  const p = normalizeScriptPath(path);
  if (p === "" || p.startsWith("/") || /^[A-Za-z]:/.test(p)) return false;
  const parts = p.split("/");
  if (parts.some((s) => s === ".." || s === "." || s === "")) return false;
  const lower = p.toLowerCase();
  return SCRIPT_EDITOR_FOLDERS.some((f) => lower.startsWith(f) && lower.length > f.length);
}

/** ファイルの種類。 */
export function scriptFileKind(path: string): ScriptFileKind {
  return path.toLowerCase().endsWith(".string") ? "string" : "asm";
}

/** いちばん多い改行の形（改行が無ければ LF）。同じ数なら LF > CRLF > CR の順。 */
export function detectLineEnding(text: string): LineEnding {
  let crlf = 0;
  let lf = 0;
  let cr = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 13) {
      if (text.charCodeAt(i + 1) === 10) {
        crlf++;
        i++;
      } else cr++;
    } else if (c === 10) lf++;
  }
  if (lf >= crlf && lf >= cr) return "\n";
  return crlf >= cr ? "\r\n" : "\r";
}

/** BOM を外し、改行を `\n` にそろえる（索引に入れるときなど、改行の形を覚えなくてよいとき）。 */
export function normalizeScriptText(raw: string): string {
  return (raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw).replace(/\r\n?/g, "\n");
}

/** 読んだ本文をエディタの形にする。 */
export function decodeScriptText(raw: string): DecodedText {
  const bom = raw.charCodeAt(0) === 0xfeff;
  const body = bom ? raw.slice(1) : raw;
  return { text: normalizeScriptText(body), lineEnding: detectLineEnding(body), bom };
}

/** エディタの本文（改行は `\n`）を、読んだときの改行と BOM でファイルの形に戻す。 */
export function encodeScriptText(text: string, lineEnding: LineEnding, bom: boolean): string {
  const body = lineEnding === "\n" ? text : text.replace(/\n/g, lineEnding);
  return bom ? `﻿${body}` : body;
}
