import { writeIndentedJson, type BochiJsonValue } from "./BochiJson.js";
import { asRecord, parseJsonObject, readInt } from "./jsonRead.js";
import { ProjectFormatError } from "./ProjectFormatError.js";
import { readTextIfExists, type ProjectFs } from "./ProjectFs.js";

/**
 * `maps\rom_erase.json`: ビルドのときに 0xFF で埋める ROM の範囲（#220。素の ROM にあるイベントのスクリプトを消したとき）。
 * ZigzaguMap は ROM へ書かないので、範囲をここに記録し、CFRU の `scripts/map_project.py`（build-support の変更を当てたもの）が
 * マップのデータを書き込む前に埋める。
 *
 * 形（Bochi の maps\ の JSON と同じ整形。2 空白の字下げ、CRLF、ASCII 以外は `\uXXXX`）:
 * `{ "Format": 1, "Ranges": [{ "Address": "0x0816A2B4", "Length": 37, "Type": "script", "Bank": 3, "Map": 0, "Event": "person", "Index": 2 }] }`
 * - `Address` は GBA のアドレス（0x08000000 以上）の 16 進の文字列、`Length` はバイト数。ビルドが使うのはこの 2 つだけ。
 * - `Type`（script / text / movement / mart / data）と、由来のマップとイベント（`Bank`・`Map`・`Event`・`Index`）は記録用。
 * - 知らない項目は、ファイルの最上位も範囲の中も、書き戻しても残す。
 */

export { ROM_ERASE_PATH } from "./paths.js";
import { ROM_ERASE_PATH } from "./paths.js";
export const ROM_ERASE_FORMAT = 1;

/** 範囲の種類。 */
export type RomEraseType = "script" | "text" | "movement" | "mart" | "data";
export const ROM_ERASE_TYPES: readonly RomEraseType[] = ["script", "text", "movement", "mart", "data"];

/** 由来のイベントの種類。 */
export type RomEraseEventKind = "person" | "sign" | "trap";

/** 埋める範囲 1 つ。 */
export interface RomEraseRange {
  /** GBA のアドレス（0x08000000 以上）。 */
  readonly address: number;
  /** バイト数（1 以上）。 */
  readonly length: number;
  readonly type: RomEraseType;
  readonly bank: number;
  readonly map: number;
  readonly event: RomEraseEventKind;
  readonly index: number;
  /** 読んだときの知らない項目（書き戻すときに残す）。 */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** 読んだファイル。 */
export interface RomEraseFile {
  readonly ranges: readonly RomEraseRange[];
  /** 最上位の知らない項目。 */
  readonly extra: Readonly<Record<string, unknown>>;
}

const KNOWN_TOP = new Set(["Format", "Ranges"]);
const KNOWN_RANGE = new Set(["Address", "Length", "Type", "Bank", "Map", "Event", "Index"]);
const EVENT_KINDS: readonly RomEraseEventKind[] = ["person", "sign", "trap"];

/** `0x0816A2B4` の形（大文字の 16 進 8 桁）。 */
export function formatRomEraseAddress(address: number): string {
  return `0x${(address >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function rest(obj: Record<string, unknown>, known: ReadonlySet<string>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (!known.has(k)) out[k] = v;
  return out;
}

/** 読む。形が違えば ProjectFormatError。 */
export function parseRomErase(text: string, path: string = ROM_ERASE_PATH): RomEraseFile {
  const root = parseJsonObject(text, path);
  const format = readInt(root, "Format", path, ROM_ERASE_FORMAT);
  if (format !== ROM_ERASE_FORMAT) throw new ProjectFormatError(`Format ${format} には対応していません（${ROM_ERASE_FORMAT} だけ）`, path);
  const list = root["Ranges"] ?? [];
  if (!Array.isArray(list)) throw new ProjectFormatError("Ranges は配列でなければなりません", path);
  const ranges = list.map((raw, i): RomEraseRange => {
    const o = asRecord(raw, `Ranges[${i}]`, path);
    const a = o["Address"];
    const address = typeof a === "string" && /^0x[0-9a-f]{1,8}$/i.test(a) ? Number.parseInt(a.slice(2), 16) : typeof a === "number" ? a : NaN;
    if (!Number.isInteger(address) || address < 0x08000000 || address > 0x09ffffff) {
      throw new ProjectFormatError(`Ranges[${i}].Address は 0x08000000〜0x09FFFFFF の 16 進の文字列でなければなりません`, path);
    }
    const length = readInt(o, "Length", path);
    if (length < 1) throw new ProjectFormatError(`Ranges[${i}].Length は 1 以上でなければなりません`, path);
    const type = String(o["Type"] ?? "data") as RomEraseType;
    const event = String(o["Event"] ?? "person") as RomEraseEventKind;
    const extra = rest(o, KNOWN_RANGE);
    return {
      address,
      length,
      type: ROM_ERASE_TYPES.includes(type) ? type : "data",
      bank: readInt(o, "Bank", path, 0),
      map: readInt(o, "Map", path, 0),
      event: EVENT_KINDS.includes(event) ? event : "person",
      index: readInt(o, "Index", path, 0),
      ...(Object.keys(extra).length > 0 ? { extra } : {}),
    };
  });
  return { ranges, extra: rest(root, KNOWN_TOP) };
}

/** 書く（Bochi と同じ整形）。 */
export function stringifyRomErase(file: RomEraseFile): string {
  const ranges = file.ranges.map((r) => {
    const o: Record<string, BochiJsonValue> = {
      Address: formatRomEraseAddress(r.address),
      Length: r.length,
      Type: r.type,
      Bank: r.bank,
      Map: r.map,
      Event: r.event,
      Index: r.index,
    };
    for (const [k, v] of Object.entries(r.extra ?? {})) o[k] = v as BochiJsonValue;
    return o;
  });
  const root: Record<string, BochiJsonValue> = { Format: ROM_ERASE_FORMAT, Ranges: ranges };
  for (const [k, v] of Object.entries(file.extra)) root[k] = v as BochiJsonValue;
  return writeIndentedJson(root);
}

/** 範囲が重なるか。 */
export function romRangesOverlap(a: { address: number; length: number }, b: { address: number; length: number }): boolean {
  return a.address < b.address + b.length && b.address < a.address + a.length;
}

/** `ranges` のどれかが `r` をすっかり含むか（同じ範囲の二重登録を防ぐ）。 */
export function romRangeCovered(ranges: readonly { address: number; length: number }[], r: { address: number; length: number }): boolean {
  return ranges.some((x) => x.address <= r.address && r.address + r.length <= x.address + x.length);
}

/** 書く文字列。範囲が無く知らない項目も無ければ null（ファイルを置かない）。 */
function textOf(file: RomEraseFile): string | null {
  if (file.ranges.length === 0 && Object.keys(file.extra).length === 0) return null;
  return stringifyRomErase(file);
}

/**
 * プロジェクトの埋める範囲（`maps\rom_erase.json`）。開いたときに読み（無ければ空）、出力のときに書く（中身が変わったときだけ）。
 * 範囲が 1 つも無くなったらファイルを消す（ZigzaguMap が作ったファイルなら。知らない項目があれば空の Ranges で残す）。
 */
export class RomEraseProject {
  private file: RomEraseFile;
  private savedText: string | null;

  private constructor(file: RomEraseFile, savedText: string | null, readonly loadError: string | null) {
    this.file = file;
    this.savedText = savedText;
  }

  /** 読む。`fs` が null（素の ROM だけ）なら空。読めなければ `loadError` を持ち、編集も上書きもしない。 */
  static async open(fs: ProjectFs | null): Promise<RomEraseProject> {
    const text = fs ? await readTextIfExists(fs, ROM_ERASE_PATH) : null;
    if (text === null) return new RomEraseProject({ ranges: [], extra: {} }, null, null);
    try {
      const file = parseRomErase(text);
      return new RomEraseProject(file, textOf(file), null);
    } catch (e) {
      return new RomEraseProject({ ranges: [], extra: {} }, text, e instanceof Error ? e.message : String(e));
    }
  }

  /** 読んだ内容から作る（テスト用）。 */
  static of(file: RomEraseFile): RomEraseProject {
    return new RomEraseProject(file, textOf(file), null);
  }

  get ranges(): readonly RomEraseRange[] {
    return this.file.ranges;
  }

  /** 範囲の一覧を置き換える（コマンドから。読めなかったファイルなら Error）。 */
  setRanges(ranges: readonly RomEraseRange[]): void {
    if (this.loadError !== null) throw new Error(`maps/rom_erase.json が読めないので記録できません: ${this.loadError}`);
    this.file = { ...this.file, ranges: [...ranges] };
  }

  /** 書く文字列（範囲が無く知らない項目も無ければ null = ファイルを消す）。 */
  private text(): string | null {
    return textOf(this.file);
  }

  /** 出力していない変更があるか。 */
  isModified(): boolean {
    return this.loadError === null && this.text() !== this.savedText;
  }

  /** 出力する。書いたパスと消したパス。 */
  async save(fs: ProjectFs): Promise<{ written: string[]; removed: string[] }> {
    if (!this.isModified()) return { written: [], removed: [] };
    const text = this.text();
    if (text === null) {
      await fs.remove(ROM_ERASE_PATH);
      this.savedText = null;
      return { written: [], removed: [ROM_ERASE_PATH] };
    }
    await fs.writeText(ROM_ERASE_PATH, text);
    this.savedText = text;
    return { written: [ROM_ERASE_PATH], removed: [] };
  }
}
