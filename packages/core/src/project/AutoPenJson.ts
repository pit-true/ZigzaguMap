import { formatHex } from "../binary/bytes.js";
import { BLOCK_ID_MASK, MOVEMENT_MAX } from "../map/constants.js";
import {
  PART_KINDS,
  PART_ROLES,
  allSlotNamesOf,
  gridIsBlank,
  type AutoPenFile,
  type AutoPenPart,
  type AutoPenTilesetInfo,
  type PartCell,
  type PartGrid,
  type PartKind,
  type PartRole,
  type PrimaryRef,
} from "../autopen/types.js";
import { BOCHI_NEWLINE } from "./BochiJson.js";
import { asRecord, parseJsonObject, readArray, readInt, readString, type JsonRecord } from "./jsonRead.js";
import { ProjectFormatError } from "./ProjectFormatError.js";
import { AUTOPEN_DIR } from "./paths.js";

/**
 * 自動ペンのパーツの定義のファイル `maps\autopen\<識別子>.json`（#303。タイルセット 1 つが 1 ファイル。ビルドは読まない）。
 *
 * 形:
 * ```json
 * {
 *   "format": 1,
 *   "tileset": { "kind": "primary", "game": "BPRJ", "headerAddress": "0x298B44", "fingerprint": "…", "blockCount": 640, "name": "BPRJ TS1 0x298B44" },
 *   "parts": [
 *     {
 *       "name": "池",
 *       "kind": "edge",
 *       "role": "water",
 *       "order": 0,
 *       "slots": {
 *         "NW": { "width": 1, "height": 1, "cells": [
 *           [282, 4]
 *         ] }
 *       }
 *     }
 *   ]
 * }
 * ```
 * - `kind` は `fill`（面）・`edge`（縁つき）・`piece`（部品）・`repeat`（くり返し）。`role` は `ground` など 10 種類。
 * - マスは `[ブロック番号, 移動許可]`。ブロック番号は 0x280 以上が副タイルセット（スタンプと同じ番号の付け方）。
 *   移動許可が null なら決めていない（描くときは使用回数でいちばん多い値）。空きのマスは null。
 * - 主と副の両方のブロックを使うパーツは副のファイルに入れ、`primary`（どの主タイルセットと組か）を持つ。
 * - 知らない項目は書き戻しても残す。書くときは 2 空白の字下げと CRLF（maps\ の JSON にそろえる）。
 */

export const AUTOPEN_FORMAT = 1;
/** 枠の 1 辺の上限。 */
export const PART_GRID_MAX_SIDE = 255;

const FILE_KNOWN = new Set(["format", "tileset", "parts"]);
const PART_KNOWN = new Set(["name", "kind", "role", "order", "slots", "primary"]);

/** タイルセットの識別子（ファイル名の元。maps\tilesets のフォルダ名と同じ `primary_298B44` の形）。 */
export function autoPenFileBase(info: Pick<AutoPenTilesetInfo, "secondary" | "headerAddress">): string {
  return `${info.secondary ? "secondary" : "primary"}_${formatHex(info.headerAddress >>> 0, 6)}`;
}

/** パーツの定義のファイルのパス。 */
export function autoPenPath(base: string): string {
  return `${AUTOPEN_DIR}/${base}.json`;
}

function readAddress(obj: JsonRecord, key: string, path: string | null, fallback: number): number {
  const v = obj[key];
  if (v === undefined || v === null) return fallback;
  if (typeof v === "number" && Number.isInteger(v)) return v;
  if (typeof v === "string" && /^0x[0-9a-f]{1,8}$/i.test(v)) return Number.parseInt(v.slice(2), 16);
  throw new ProjectFormatError(`${key} は 0x で始まる 16 進の文字列でなければなりません`, path);
}

function formatAddress(n: number): string | null {
  return n < 0 ? null : `0x${formatHex(n >>> 0, 6)}`;
}

function readTileset(raw: unknown, path: string | null): AutoPenTilesetInfo {
  const t = asRecord(raw, "tileset", path);
  const kind = readString(t, "kind", path);
  if (kind !== "primary" && kind !== "secondary") throw new ProjectFormatError("tileset.kind は primary か secondary でなければなりません", path);
  return {
    secondary: kind === "secondary",
    game: readString(t, "game", path),
    headerAddress: readAddress(t, "headerAddress", path, -1),
    fingerprint: readString(t, "fingerprint", path),
    blockCount: readInt(t, "blockCount", path, 0),
    name: readString(t, "name", path),
  };
}

function readCell(raw: unknown, where: string, path: string | null): PartCell | null {
  if (raw === null) return null;
  if (!Array.isArray(raw) || raw.length < 2) throw new ProjectFormatError(`${where} は [ブロック番号, 移動許可] か null でなければなりません`, path);
  const [b, m] = raw as unknown[];
  if (typeof b !== "number" || !Number.isInteger(b) || b < 0 || b > BLOCK_ID_MASK) throw new ProjectFormatError(`${where} のブロック番号は 0〜${BLOCK_ID_MASK} でなければなりません`, path);
  if (m !== null && (typeof m !== "number" || !Number.isInteger(m) || m < 0 || m > MOVEMENT_MAX)) {
    throw new ProjectFormatError(`${where} の移動許可は 0〜${MOVEMENT_MAX} か null でなければなりません`, path);
  }
  return { block: b, movement: m as number | null };
}

function readGrid(raw: unknown, where: string, path: string | null): PartGrid {
  const g = asRecord(raw, where, path);
  const width = readInt(g, "width", path);
  const height = readInt(g, "height", path);
  if (width < 1 || height < 1 || width > PART_GRID_MAX_SIDE || height > PART_GRID_MAX_SIDE) {
    throw new ProjectFormatError(`${where} の width と height は 1〜${PART_GRID_MAX_SIDE} でなければなりません`, path);
  }
  const list = readArray(g, "cells", path);
  if (list.length !== width * height) throw new ProjectFormatError(`${where} の cells の数（${list.length}）が width × height（${width * height}）と合いません`, path);
  return { width, height, cells: list.map((c, i) => readCell(c, `${where}.cells[${i}]`, path)) };
}

function readPrimary(raw: unknown, path: string | null): PrimaryRef {
  const p = asRecord(raw, "primary", path);
  return { fingerprint: readString(p, "fingerprint", path), game: readString(p, "game", path), headerAddress: readAddress(p, "headerAddress", path, -1) };
}

function readPart(raw: unknown, index: number, path: string | null): AutoPenPart {
  const where = `parts[${index}]`;
  const p = asRecord(raw, where, path);
  const name = readString(p, "name", path).trim();
  if (name === "") throw new ProjectFormatError(`${where}.name が空です`, path);
  const kind = readString(p, "kind", path) as PartKind;
  if (!PART_KINDS.includes(kind)) throw new ProjectFormatError(`${where}.kind は ${PART_KINDS.join("・")} のどれかでなければなりません`, path);
  const role = readString(p, "role", path, "other") as PartRole;
  if (!PART_ROLES.includes(role)) throw new ProjectFormatError(`${where}.role は ${PART_ROLES.join("・")} のどれかでなければなりません`, path);
  const slotsRaw = p["slots"] === undefined ? {} : asRecord(p["slots"], `${where}.slots`, path);
  const allowed = new Set(allSlotNamesOf(kind));
  const slots: Record<string, PartGrid> = {};
  for (const [k, v] of Object.entries(slotsRaw)) {
    if (!allowed.has(k)) throw new ProjectFormatError(`${where}.slots の ${k} は ${kind} の枠ではありません`, path);
    slots[k] = readGrid(v, `${where}.slots.${k}`, path);
  }
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(p)) if (!PART_KNOWN.has(k)) extra[k] = v;
  return {
    name,
    kind,
    role,
    order: readInt(p, "order", path, index),
    slots,
    ...(p["primary"] !== undefined && p["primary"] !== null ? { primary: readPrimary(p["primary"], path) } : {}),
    ...(Object.keys(extra).length > 0 ? { extra } : {}),
  };
}

/** 読む。形が違えば ProjectFormatError。 */
export function parseAutoPenFile(text: string, path: string | null = null): AutoPenFile {
  const root = parseJsonObject(text, path);
  const format = readInt(root, "format", path, AUTOPEN_FORMAT);
  if (format !== AUTOPEN_FORMAT) throw new ProjectFormatError(`format ${format} には対応していません（${AUTOPEN_FORMAT} だけ）`, path);
  const tileset = readTileset(root["tileset"], path);
  const parts = readArray(root, "parts", path).map((p, i) => readPart(p, i, path));
  const extra: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(root)) if (!FILE_KNOWN.has(k)) extra[k] = v;
  return { tileset, parts, ...(Object.keys(extra).length > 0 ? { extra } : {}) };
}

/** 書く。枠のマスは 1 行（枠の横 1 列）ずつ並べる。空の枠は書かない。 */
export function stringifyAutoPenFile(file: AutoPenFile): string {
  const nl = BOCHI_NEWLINE;
  const t = file.tileset;
  const j = JSON.stringify;
  const lines: string[] = [];
  lines.push(`  "format": ${AUTOPEN_FORMAT}`);
  lines.push(
    `  "tileset": { "kind": ${j(t.secondary ? "secondary" : "primary")}, "game": ${j(t.game)}, "headerAddress": ${j(formatAddress(t.headerAddress))}, ` +
      `"fingerprint": ${j(t.fingerprint)}, "blockCount": ${t.blockCount}, "name": ${j(t.name)} }`,
  );
  const parts = file.parts.map((part) => {
    const fields: string[] = [];
    const f = (k: string, v: unknown) => `      ${j(k)}: ${j(v)}`;
    fields.push(f("name", part.name), f("kind", part.kind), f("role", part.role), f("order", part.order));
    if (part.primary) {
      const p = part.primary;
      fields.push(`      "primary": { "fingerprint": ${j(p.fingerprint)}, "game": ${j(p.game)}, "headerAddress": ${j(formatAddress(p.headerAddress))} }`);
    }
    const slots: string[] = [];
    for (const name of allSlotNamesOf(part.kind)) {
      const g = part.slots[name];
      if (!g || gridIsBlank(g)) continue;
      const rows: string[] = [];
      for (let y = 0; y < g.height; y++) {
        const row = g.cells.slice(y * g.width, (y + 1) * g.width).map((c) => (c === null ? "null" : `[${c.block}, ${c.movement === null ? "null" : c.movement}]`));
        rows.push(`          ${row.join(", ")}`);
      }
      slots.push(`        ${j(name)}: { "width": ${g.width}, "height": ${g.height}, "cells": [${nl}${rows.join(`,${nl}`)}${nl}        ] }`);
    }
    fields.push(slots.length === 0 ? `      "slots": {}` : `      "slots": {${nl}${slots.join(`,${nl}`)}${nl}      }`);
    for (const [k, v] of Object.entries(part.extra ?? {})) fields.push(f(k, v));
    return `    {${nl}${fields.join(`,${nl}`)}${nl}    }`;
  });
  lines.push(parts.length === 0 ? `  "parts": []` : `  "parts": [${nl}${parts.join(`,${nl}`)}${nl}  ]`);
  for (const [k, v] of Object.entries(file.extra ?? {})) lines.push(`  ${j(k)}: ${j(v)}`);
  return `{${nl}${lines.join(`,${nl}`)}${nl}}${nl}`;
}
