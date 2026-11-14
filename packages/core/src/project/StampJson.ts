import { BLOCK_ID_MASK, MOVEMENT_MAX, PRIMARY_BLOCK_COUNT } from "../map/constants.js";
import { BOCHI_NEWLINE } from "./BochiJson.js";
import { parseJsonObject, readBool, readInt, readString } from "./jsonRead.js";
import { ProjectFormatError } from "./ProjectFormatError.js";
import { STAMPS_DIR } from "./paths.js";

/**
 * スタンプのファイル `maps\stamps\<名前>.json`（#224。1 つのスタンプが 1 ファイル）。
 *
 * 形:
 * ```json
 * {
 *   "format": 1,
 *   "name": "大きな木",
 *   "width": 2,
 *   "height": 3,
 *   "primaryTileset": "0x082D4A94",
 *   "secondaryTileset": "0x082D4AAC",
 *   "secondaryUsed": true,
 *   "cells": [
 *     [16, 1], [17, 1],
 *     [24, 1], [25, 1],
 *     [32, 1], [33, 1]
 *   ],
 *   "created": "2026-11-14T12:00:00+09:00"
 * }
 * ```
 * - `cells` は左上から行ごとの `[ブロック番号, 移動許可]`。`null` のマスは貼らない。
 * - タイルセットの組はマップのヘッダーと同じ値（ROM のポインタ。maps\tilesets のタイルセットも同じ形）。
 * - `secondaryUsed` は副タイルセットのブロック（0x280 以上）を含むか。false なら主が同じマップに貼れる。
 * - `withMovements` は移動許可に意味があるか（マップから拾った選択なら true、ブロックパレットから選んだものは false で、
 *   移動許可は 0 を入れる）。省略時は true。false のスタンプは「移動許可も貼る」がオンでも移動許可を貼らない。
 * - 知らない項目は書き戻しても残す。Bochi は maps\ の数字のフォルダだけを読むので、stamps\ は無視される。
 * - 書くときは 2 空白の字下げと CRLF（maps\ の JSON にそろえる）。名前は UTF-8 のまま書く。
 */

export const STAMP_FORMAT = 1;
/** スタンプの 1 辺の上限（マップの上限と同じ程度）。 */
export const STAMP_MAX_SIDE = 255;

/** マス 1 つ（ブロック番号と移動許可）。null は貼らないマス。 */
export type StampCell = readonly [block: number, movement: number] | null;

/** スタンプ 1 つ。 */
export interface Stamp {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** 作ったマップの主タイルセット（ポインタ）。 */
  readonly primaryTileset: number;
  /** 作ったマップの副タイルセット（ポインタ）。 */
  readonly secondaryTileset: number;
  /** 副タイルセットのブロックを含むか。 */
  readonly secondaryUsed: boolean;
  /** 移動許可に意味があるか（マップから拾ったもの）。 */
  readonly withMovements: boolean;
  /** 左上から行ごと（width × height 個）。 */
  readonly cells: readonly StampCell[];
  /** 作った日時（ISO 8601）。 */
  readonly created: string;
  /** 読んだときの知らない項目（書き戻すときに残す）。 */
  readonly extra?: Readonly<Record<string, unknown>>;
}

const KNOWN = new Set(["format", "name", "width", "height", "primaryTileset", "secondaryTileset", "secondaryUsed", "withMovements", "cells", "created"]);

/** `0x082D4A94` の形（大文字の 16 進 8 桁）。 */
export function formatStampPointer(value: number): string {
  return `0x${(value >>> 0).toString(16).toUpperCase().padStart(8, "0")}`;
}

function readPointer(obj: Record<string, unknown>, key: string, path: string | null): number {
  const v = obj[key];
  if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
  if (typeof v === "string" && /^0x[0-9a-f]{1,8}$/i.test(v)) return Number.parseInt(v.slice(2), 16);
  throw new ProjectFormatError(`${key} は 0x で始まる 16 進の文字列でなければなりません`, path);
}

/** cells に副タイルセットのブロックがあるか。 */
export function stampUsesSecondary(cells: readonly StampCell[]): boolean {
  return cells.some((c) => c !== null && c[0] >= PRIMARY_BLOCK_COUNT);
}

/** 読む。形が違えば ProjectFormatError。 */
export function parseStamp(text: string, path: string | null = null): Stamp {
  const root = parseJsonObject(text, path);
  const format = readInt(root, "format", path, STAMP_FORMAT);
  if (format !== STAMP_FORMAT) throw new ProjectFormatError(`format ${format} には対応していません（${STAMP_FORMAT} だけ）`, path);
  const name = readString(root, "name", path).trim();
  if (name === "") throw new ProjectFormatError("name が空です", path);
  const width = readInt(root, "width", path);
  const height = readInt(root, "height", path);
  if (width < 1 || height < 1 || width > STAMP_MAX_SIDE || height > STAMP_MAX_SIDE) {
    throw new ProjectFormatError(`width と height は 1〜${STAMP_MAX_SIDE} でなければなりません`, path);
  }
  const list = root["cells"];
  if (!Array.isArray(list)) throw new ProjectFormatError("cells は配列でなければなりません", path);
  if (list.length !== width * height) throw new ProjectFormatError(`cells の数（${list.length}）が width × height（${width * height}）と合いません`, path);
  const cells = list.map((raw, i): StampCell => {
    if (raw === null) return null;
    if (!Array.isArray(raw) || raw.length < 2) throw new ProjectFormatError(`cells[${i}] は [ブロック番号, 移動許可] か null でなければなりません`, path);
    const [b, m] = raw as unknown[];
    if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > BLOCK_ID_MASK) {
      throw new ProjectFormatError(`cells[${i}] のブロック番号は 0〜${BLOCK_ID_MASK} でなければなりません`, path);
    }
    if (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m > MOVEMENT_MAX) {
      throw new ProjectFormatError(`cells[${i}] の移動許可は 0〜${MOVEMENT_MAX} でなければなりません`, path);
    }
    return [b, m];
  });
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root)) if (!KNOWN.has(k)) extra[k] = v;
  // secondaryUsed は書いてある値より中身を信じる（手で直したファイルでも判定がずれないように）。
  const declared = readBool(root, "secondaryUsed", path, false);
  return {
    name,
    width,
    height,
    primaryTileset: readPointer(root, "primaryTileset", path),
    secondaryTileset: readPointer(root, "secondaryTileset", path),
    secondaryUsed: declared || stampUsesSecondary(cells),
    withMovements: readBool(root, "withMovements", path, true),
    cells,
    created: readString(root, "created", path),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/** 書く。cells は 1 行（スタンプの横 1 列）ずつ並べる。 */
export function stringifyStamp(stamp: Stamp): string {
  const nl = BOCHI_NEWLINE;
  const lines: string[] = [];
  const field = (k: string, v: unknown) => `  ${JSON.stringify(k)}: ${JSON.stringify(v)}`;
  lines.push(field("format", STAMP_FORMAT));
  lines.push(field("name", stamp.name));
  lines.push(field("width", stamp.width));
  lines.push(field("height", stamp.height));
  lines.push(field("primaryTileset", formatStampPointer(stamp.primaryTileset)));
  lines.push(field("secondaryTileset", formatStampPointer(stamp.secondaryTileset)));
  lines.push(field("secondaryUsed", stamp.secondaryUsed));
  lines.push(field("withMovements", stamp.withMovements));
  const rows: string[] = [];
  for (let y = 0; y < stamp.height; y++) {
    const row = stamp.cells.slice(y * stamp.width, (y + 1) * stamp.width).map((c) => (c === null ? "null" : `[${c[0]}, ${c[1]}]`));
    rows.push(`    ${row.join(", ")}`);
  }
  lines.push(`  "cells": [${nl}${rows.join(`,${nl}`)}${nl}  ]`);
  lines.push(field("created", stamp.created));
  for (const [k, v] of Object.entries(stamp.extra ?? {})) lines.push(field(k, v));
  return `{${nl}${lines.join(`,${nl}`)}${nl}}${nl}`;
}

/**
 * マップのマス（u16。下位 10 ビットがブロック、上位 6 ビットが移動許可）の矩形からスタンプを作る。
 * `values` は左上から行ごと、null は貼らないマス。
 */
export function createStamp(
  name: string,
  width: number,
  height: number,
  values: readonly (number | null)[],
  tilesets: { primary: number; secondary: number },
  created: string = new Date().toISOString(),
  withMovements = true,
): Stamp {
  if (values.length !== width * height) throw new Error(`マスの数（${values.length}）が ${width}×${height} と合いません`);
  const cells = values.map((v): StampCell => (v === null ? null : [v & BLOCK_ID_MASK, (v >>> 10) & MOVEMENT_MAX]));
  return {
    name: name.trim(),
    width,
    height,
    primaryTileset: tilesets.primary >>> 0,
    secondaryTileset: tilesets.secondary >>> 0,
    secondaryUsed: stampUsesSecondary(cells),
    withMovements,
    cells,
    created,
  };
}

/** スタンプのマスをマップのマス（u16）にする。`withMovement` が false なら移動許可を `keepMovement` の値にする。 */
export function stampCellValue(cell: readonly [number, number], withMovement: boolean, keepMovement = 0): number {
  return ((cell[0] & BLOCK_ID_MASK) | (((withMovement ? cell[1] : keepMovement) & MOVEMENT_MAX) << 10)) & 0xffff;
}

/** 今のマップ（タイルセットの組）に貼れるか。 */
export function stampFits(stamp: Pick<Stamp, "primaryTileset" | "secondaryTileset" | "secondaryUsed">, primary: number, secondary: number): boolean {
  if (stamp.primaryTileset >>> 0 !== primary >>> 0) return false;
  return !stamp.secondaryUsed || stamp.secondaryTileset >>> 0 === secondary >>> 0;
}

/** ファイル名に使えない字（Windows の禁止文字と制御文字）。 */
const BAD_CHARS = /[\\/:*?"<>|\u0000-\u001f]/g;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 名前からファイル名の元（拡張子なし）を作る。使えない字は `_`、末尾の点と空白は外す。
 * `taken` に同じ名前（大文字小文字を区別しない）があれば `_2`、`_3`… を足す。
 */
export function stampFileBase(name: string, taken: Iterable<string> = []): string {
  let base = name.trim().replace(BAD_CHARS, "_").replace(/[. ]+$/, "");
  if (base === "" || RESERVED.test(base)) base = `_${base}`;
  if (base.length > 80) base = base.slice(0, 80);
  const used = new Set([...taken].map((t) => t.toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const c = `${base}_${n}`;
    if (!used.has(c.toLowerCase())) return c;
  }
}

/** スタンプのファイルのパス（maps/stamps/<元>.json）。 */
export function stampPath(base: string): string {
  return `${STAMPS_DIR}/${base}.json`;
}

/** スタンプのマスの範囲を確かめる（作るときと読むときの共通）。 */
export function checkStampShape(stamp: Pick<Stamp, "width" | "height" | "cells">): void {
  if (stamp.width < 1 || stamp.height < 1 || stamp.width > STAMP_MAX_SIDE || stamp.height > STAMP_MAX_SIDE) throw new Error("スタンプの大きさが範囲の外です");
  if (stamp.cells.length !== stamp.width * stamp.height) throw new Error("スタンプのマスの数が大きさと合いません");
}
