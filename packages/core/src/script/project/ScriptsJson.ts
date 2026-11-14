import { type BochiJsonValue, writeIndentedJson } from "../../project/BochiJson.js";
import { ProjectFormatError } from "../../project/ProjectFormatError.js";
import type { ProjectFs } from "../../project/ProjectFs.js";
import { type JsonRecord, asRecord, parseJsonObject, readArray, readInt } from "../../project/jsonRead.js";

/** maps\scripts.json のパス。 */
export { SCRIPTS_JSON_PATH } from "../../project/paths.js";
import { SCRIPTS_JSON_PATH } from "../../project/paths.js";
/** maps\scripts.json の Format の値。 */
export const SCRIPTS_JSON_FORMAT = 1;

/** 知らない項目（読んだときの値をそのまま書き戻す）。 */
export type ScriptsJsonExtra = Readonly<Record<string, BochiJsonValue>>;

/** scripts.json の 1 項目。バンク・マップ（`map` が null ならバンク全体）のスクリプトを書く `.s` と `.string`。 */
export interface ScriptsJsonEntry {
  readonly bank: number;
  /** null ならバンク全体。 */
  readonly map: number | null;
  /** 画面に出す名前（自由な文字列）。 */
  readonly name: string;
  /** `.s` のパス（プロジェクトフォルダからの相対、区切りは `/`）。 */
  readonly script: string;
  /** `.string` のパス。null なら `defaultScriptsJsonStringsPath(script)`。 */
  readonly strings: string | null;
  /** 知らない項目。 */
  readonly extra: ScriptsJsonExtra;
}

/** maps\scripts.json の中身。 */
export interface ScriptsJson {
  readonly format: number;
  readonly entries: readonly ScriptsJsonEntry[];
  /** ルートの知らない項目。 */
  readonly extra: ScriptsJsonExtra;
}

/** バンク・マップを解決した結果。 */
export interface ScriptsJsonResolution {
  /** 当たった項目。 */
  readonly entry: ScriptsJsonEntry;
  /** `entries` の中の位置。 */
  readonly entryIndex: number;
  readonly script: string;
  /** `Strings` が無ければ既定の名前。 */
  readonly strings: string;
}

const ROOT_KEYS = ["Format", "Entries"];
const ENTRY_KEYS = ["Bank", "Map", "Name", "Script", "Strings"];

/**
 * maps\scripts.json の読み書き。
 * 形は `{ "Format": 1, "Entries": [{ "Bank", "Map"（省略でバンク全体）, "Name", "Script", "Strings"（省略可） }] }`。
 * 書くときは Bochi の maps\ の JSON と同じ整形（2 空白の字下げ、CRLF、ASCII 以外は \uXXXX）にし、
 * 決まった項目を上の順で書いてから、知らない項目を読んだときの順で書く。
 */
export class ScriptsJsonFile {
  /** 読む。形式が不正なら ProjectFormatError。 */
  static parse(text: string, path: string | null = SCRIPTS_JSON_PATH): ScriptsJson {
    const o = parseJsonObject(text, path);
    const format = readInt(o, "Format", path, SCRIPTS_JSON_FORMAT);
    if (format !== SCRIPTS_JSON_FORMAT) throw new ProjectFormatError(`対応していない Format です: ${format}`, path);
    const entries = readArray(o, "Entries", path).map((v, i) => parseEntry(asRecord(v, `Entries[${i}]`, path), i, path));
    return { format, entries, extra: extraOf(o, ROOT_KEYS) };
  }

  /** 書く（ファイルの末尾の改行を含む）。 */
  static stringify(doc: ScriptsJson): string {
    const root: Record<string, BochiJsonValue> = {
      Format: doc.format,
      Entries: doc.entries.map((e) => {
        const o: Record<string, BochiJsonValue> = { Bank: e.bank };
        if (e.map !== null) o["Map"] = e.map;
        o["Name"] = e.name;
        o["Script"] = e.script;
        if (e.strings !== null) o["Strings"] = e.strings;
        return withExtra(o, e.extra, ENTRY_KEYS);
      }),
    };
    return writeIndentedJson(withExtra(root, doc.extra, ROOT_KEYS));
  }

  /** 空の scripts.json。 */
  static empty(): ScriptsJson {
    return { format: SCRIPTS_JSON_FORMAT, entries: [], extra: {} };
  }
}

function parseEntry(o: JsonRecord, i: number, path: string | null): ScriptsJsonEntry {
  const at = `Entries[${i}]`;
  const bank = readByte(o, "Bank", at, path, false)!;
  const map = readByte(o, "Map", at, path, true);
  const name = readOptionalString(o, "Name", at, path) ?? "";
  const script = readOptionalString(o, "Script", at, path);
  if (script === null || script === "") throw new ProjectFormatError(`${at}.Script が必要です`, path);
  const strings = readOptionalString(o, "Strings", at, path);
  return { bank, map, name, script, strings: strings === "" ? null : strings, extra: extraOf(o, ENTRY_KEYS) };
}

function readByte(o: JsonRecord, key: string, at: string, path: string | null, optional: boolean): number | null {
  const v = o[key];
  if ((v === undefined || v === null) && optional) return null;
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 255) {
    throw new ProjectFormatError(`${at}.${key} は 0〜255 の整数でなければなりません`, path);
  }
  return v;
}

function readOptionalString(o: JsonRecord, key: string, at: string, path: string | null): string | null {
  const v = o[key];
  if (v === undefined || v === null) return null;
  if (typeof v !== "string") throw new ProjectFormatError(`${at}.${key} は文字列でなければなりません`, path);
  return v;
}

function extraOf(o: JsonRecord, known: readonly string[]): ScriptsJsonExtra {
  const extra: Record<string, BochiJsonValue> = {};
  for (const [k, v] of Object.entries(o)) if (!known.includes(k)) extra[k] = v as BochiJsonValue;
  return extra;
}

function withExtra(o: Record<string, BochiJsonValue>, extra: ScriptsJsonExtra, known: readonly string[]): Record<string, BochiJsonValue> {
  for (const [k, v] of Object.entries(extra)) if (!known.includes(k)) o[k] = v;
  return o;
}

/**
 * `Strings` を省いたときの `.string` のパス: `strings/overworld_strings_<.s の名前（拡張子なし）>.string`。
 * 例: `assembly/overworld_scripts/01_moegi.s` → `strings/overworld_strings_01_moegi.string`（ND の名前の付け方）。
 */
export function defaultScriptsJsonStringsPath(script: string): string {
  const base = script.slice(Math.max(script.lastIndexOf("/"), script.lastIndexOf("\\")) + 1);
  const dot = base.lastIndexOf(".");
  return `strings/overworld_strings_${dot > 0 ? base.slice(0, dot) : base}.string`;
}

/**
 * バンク・マップのスクリプトを書く `.s` と `.string`。マップを指定した項目をバンク全体の項目より優先する。
 * 同じ重みの項目がいくつもあるときは前のもの。当たらなければ null。
 */
export function resolveScriptsJson(doc: ScriptsJson, bank: number, map: number): ScriptsJsonResolution | null {
  let found = doc.entries.findIndex((e) => e.bank === bank && e.map === map);
  if (found < 0) found = doc.entries.findIndex((e) => e.bank === bank && e.map === null);
  if (found < 0) return null;
  const entry = doc.entries[found]!;
  return { entry, entryIndex: found, script: entry.script, strings: entry.strings ?? defaultScriptsJsonStringsPath(entry.script) };
}

/** 同じバンク・マップ（またはバンク全体）を指す項目の組（後ろの項目は使われない）。編集画面の警告用。 */
export function findScriptsJsonDuplicates(doc: ScriptsJson): { readonly first: number; readonly duplicate: number }[] {
  const seen = new Map<string, number>();
  const out: { first: number; duplicate: number }[] = [];
  doc.entries.forEach((e, i) => {
    const key = `${e.bank}/${e.map ?? "*"}`;
    const first = seen.get(key);
    if (first === undefined) seen.set(key, i);
    else out.push({ first, duplicate: i });
  });
  return out;
}

/** プロジェクトの maps\scripts.json を読む。無ければ null。 */
export async function loadScriptsJson(fs: ProjectFs): Promise<ScriptsJson | null> {
  if (!(await fs.exists(SCRIPTS_JSON_PATH))) return null;
  return ScriptsJsonFile.parse(await fs.readText(SCRIPTS_JSON_PATH), SCRIPTS_JSON_PATH);
}

/** プロジェクトの maps\scripts.json を書く。 */
export async function saveScriptsJson(fs: ProjectFs, doc: ScriptsJson): Promise<void> {
  await fs.writeText(SCRIPTS_JSON_PATH, ScriptsJsonFile.stringify(doc));
}
