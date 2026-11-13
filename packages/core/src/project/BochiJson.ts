import { encodeBase64 } from "../binary/base64.js";

/**
 * Bochi（.NET の System.Text.Json）と同じ整形で JSON を書くための小さな書き手。
 *
 * - `WriteIndented = true`: 2 空白の字下げ、`"キー": 値`、空の配列は `[]`、空のオブジェクトは `{}`。
 * - 改行は Windows の Environment.NewLine（CRLF）。ファイルの末尾にも改行を 1 つ付ける。
 * - byte[] は base64 をそのまま書く（`+` や `/` もエスケープしない）。
 * - 文字列は JavaScriptEncoder.Default と同じく、ASCII の表示文字以外と `"&'+<>\`` をエスケープする。
 */

/** JSON に書く値。Uint8Array は base64 の文字列として書く。 */
export type BochiJsonValue =
  | number
  | boolean
  | string
  | null
  | Uint8Array
  | readonly BochiJsonValue[]
  | { readonly [key: string]: BochiJsonValue };

/** Bochi の改行。 */
export const BOCHI_NEWLINE = "\r\n";
/** 字下げ 1 段。 */
const INDENT = "  ";

/** 字下げつきで書く（ファイルの末尾の改行を含む）。 */
export function writeIndentedJson(value: BochiJsonValue, newline: string = BOCHI_NEWLINE): string {
  return writeValue(value, "", newline) + newline;
}

/** 字下げなしで書く（ファイルの末尾の改行を含む）。maps\project.json 用。 */
export function writeCompactJson(value: BochiJsonValue, newline: string = BOCHI_NEWLINE): string {
  return writeValue(value, null, newline) + newline;
}

function writeValue(value: BochiJsonValue, indent: string | null, nl: string): string {
  if (value === null) return "null";
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new RangeError("JSON に書けない数です");
    return String(value);
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return quote(value);
  if (value instanceof Uint8Array) return `"${encodeBase64(value)}"`;
  const inner = indent === null ? null : indent + INDENT;
  const open = (bracket: string) => (inner === null ? bracket : bracket + nl + inner);
  const close = (bracket: string) => (inner === null ? bracket : nl + indent + bracket);
  const sep = inner === null ? "," : "," + nl + inner;
  if (Array.isArray(value)) {
    const items = value as readonly BochiJsonValue[];
    if (items.length === 0) return "[]";
    return open("[") + items.map((v) => writeValue(v, inner, nl)).join(sep) + close("]");
  }
  const entries = Object.entries(value as { readonly [key: string]: BochiJsonValue });
  if (entries.length === 0) return "{}";
  const colon = inner === null ? ":" : ": ";
  return open("{") + entries.map(([k, v]) => quote(k) + colon + writeValue(v, inner, nl)).join(sep) + close("}");
}

/** System.Text.Json の既定のエンコーダーがそのまま書く ASCII 以外の記号。 */
const ESCAPED_ASCII = new Set(['"', "&", "'", "+", "<", ">", "`"]);

function quote(text: string): string {
  let out = '"';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    const code = text.charCodeAt(i);
    if (c === "\\") out += "\\\\";
    else if (c === "\n") out += "\\n";
    else if (c === "\r") out += "\\r";
    else if (c === "\t") out += "\\t";
    else if (c === "\b") out += "\\b";
    else if (c === "\f") out += "\\f";
    else if (code < 0x20 || code > 0x7e || ESCAPED_ASCII.has(c)) out += "\\u" + code.toString(16).toUpperCase().padStart(4, "0");
    else out += c;
  }
  return out + '"';
}
