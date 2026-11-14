import { formatHex } from "../../binary/bytes.js";
import type { ScriptDialect } from "../config/ScriptDialect.js";
import { wrapStringBody } from "../strings/StringFile.js";
import { scriptTextLabel, type ScriptLabelKind } from "./LabelNaming.js";

/** 種別ごとのひな形の文（`.string` に書く本文。1 行 18 字に収める）。 */
export const SCRIPT_TEMPLATE_TEXTS: Readonly<Record<Exclude<ScriptLabelKind, "map">, string>> = {
  person: "ここに　はなす　ことばを　かきます",
  sign: "ここに　かんばんの　ぶんを　かきます",
  tile: "ここに　ぶんを　かきます",
};

/** ひな形 1 つ（`.s` に足す行と、`.string` に足す文字列）。 */
export interface ScriptTemplate {
  readonly label: string;
  /** `.s` に足す行（改行を除く）。 */
  readonly asm: readonly string[];
  /** `.string` に足す文字列（ラベルと本文）。 */
  readonly strings: readonly { readonly label: string; readonly text: string }[];
}

/** ひな形を作るときの指定。 */
export interface ScriptTemplateOptions {
  readonly dialect: ScriptDialect;
  /** ラベルの前に `.global` を書くか。 */
  readonly useGlobal: boolean;
}

/**
 * 人・看板・スクリプトタイルのひな形。
 * - 人: `lock` `faceplayer` `msgbox 文 MSG_FACE` `release` `end`
 * - 看板: `msgbox 文 MSG_SIGN` `end`
 * - スクリプトタイル: `lockall` `msgbox 文 MSG_NORMAL` `releaseall` `end`
 * ND は msgbox に漢字のポインタも書き（`msgbox X MSG_FACE X_k`）、`.string` にひらがなと漢字の 2 つを足す。Chronos は 1 つ。
 */
export function eventScriptTemplate(kind: Exclude<ScriptLabelKind, "map">, label: string, options: ScriptTemplateOptions): ScriptTemplate {
  const text = scriptTextLabel(label);
  const nd = options.dialect === "nd";
  const msg = (type: string): string => `\tmsgbox ${text} ${type}${nd ? ` ${scriptTextLabel(label, true)}` : ""}`;
  const body =
    kind === "person"
      ? ["\tlock", "\tfaceplayer", msg("MSG_FACE"), "\trelease", "\tend"]
      : kind === "sign"
        ? [msg("MSG_SIGN"), "\tend"]
        : ["\tlockall", msg("MSG_NORMAL"), "\treleaseall", "\tend"];
  const strings = [{ label: text, text: SCRIPT_TEMPLATE_TEXTS[kind] }];
  if (nd) strings.push({ label: scriptTextLabel(label, true), text: SCRIPT_TEMPLATE_TEXTS[kind] });
  return { label, asm: [...head(label, options), ...body], strings };
}

/** 何もしないスクリプトのひな形（マップスクリプトの各項目の行き先）。`setvar` を渡すと、終わる前に変数を書く（条件表の繰り返しを止める）。 */
export function emptyScriptTemplate(label: string, options: ScriptTemplateOptions, setvar?: { readonly variable: number; readonly value: number }): ScriptTemplate {
  const body = setvar ? [`\tsetvar ${hex(setvar.variable)} ${hex(setvar.value)}`, "\tend"] : ["\tend"];
  return { label, asm: [...head(label, options), ...body], strings: [] };
}

function head(label: string, options: ScriptTemplateOptions): string[] {
  return options.useGlobal ? [`.global ${label}`, `${label}:`] : [`${label}:`];
}

function hex(n: number): string {
  return `0x${formatHex(n)}`;
}

/** テキストの改行の形（いちばん多いもの。無ければ LF）。 */
export function textNewline(text: string): "\n" | "\r\n" {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/\n/g) ?? []).length - crlf;
  return crlf > lf ? "\r\n" : "\n";
}

/** `.s` に足すまとまりの文字列（前に空行 1 つ、最後に改行）。改行は `newline`。 */
export function asmBlockText(lines: readonly string[], newline: string): string {
  return newline + lines.join(newline) + newline;
}

/** `.string` に足すまとまりの文字列（`#org @ラベル` と本文。前に空行 1 つ。本文は制御記号のあとで行を分ける #221）。 */
export function stringsBlockText(entries: readonly { readonly label: string; readonly text: string }[], newline: string): string {
  return entries
    .map((e) => `${newline}#org @${e.label}${newline}${wrapStringBody(e.text).split("\n").join(newline)}${newline}`)
    .join("");
}

/**
 * テキストの最後にまとまりを足す。最後の行に改行が無ければ、先に改行を足す。最後がもう空行（か空のファイル）なら、前の空行は足さない。
 * 返すのは新しいテキストと、実際に足した文字列（取り消すときに探す文字列）。
 */
export function appendBlock(text: string, block: string): { readonly text: string; readonly added: string } {
  const newline = block.startsWith("\r\n") ? "\r\n" : "\n";
  const added = text === "" || text.endsWith("\n") || text.endsWith("\r") ? block : newline + block;
  return { text: text + added, added };
}

/**
 * 足したまとまりを除く。最後に足したもの（後ろから探して最初に当たるもの）を除いたテキストを返す。
 * 見つからなければ（手で書き換えた）null。
 */
export function removeBlock(text: string, added: string): string | null {
  const at = text.lastIndexOf(added);
  if (at < 0 || added === "") return null;
  return text.slice(0, at) + text.slice(at + added.length);
}
