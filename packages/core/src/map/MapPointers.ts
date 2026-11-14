import { CONNECTION_HEADER_SIZE } from "../connection/layout.js";
import { EVENT_HEADER, EVENT_HEADER_SIZE, PERSON, PERSON_SIZE, SIGN, SIGN_SIZE, TRAP, TRAP_SIZE, WARP_SIZE } from "../event/layout.js";
import { isHiddenItemKind } from "../event/SignCodec.js";
import { MAP_SCRIPT_ENTRY, MAP_SCRIPT_ENTRY_SIZE, MAX_MAP_SCRIPT_ENTRIES } from "../mapscript/layout.js";
import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { MAP_HEADER_SIZE, MAP_LAYOUT_SIZE } from "./constants.js";
import type { MapBankTable } from "./MapBankTable.js";
import { MAP_HEADER } from "./MapHeaderCodec.js";
import type { MapId } from "./types.js";

/** ポインタの種類（一覧の並びと、画面の名前の鍵）。 */
export type MapPointerKind =
  | "header"
  | "layout"
  | "events"
  | "scripts"
  | "connections"
  | "border"
  | "blocks"
  | "primaryTileset"
  | "secondaryTileset"
  | "persons"
  | "warps"
  | "traps"
  | "signs"
  | "personScript"
  | "trapScript"
  | "signScript"
  | "connectionList"
  | "mapScript";

/** マップのポインタ 1 件。 */
export interface MapPointer {
  readonly kind: MapPointerKind;
  /** 何番目か（人・看板・スクリプトタイル・マップスクリプトの番号。ほかは null）。 */
  readonly index: number | null;
  /** ポインタが置かれている ROM の上の位置。 */
  readonly location: number;
  /** ポインタの値（そのまま。0 なら無し）。 */
  readonly value: number;
  /** 値のリトルエンディアンのバイト列。 */
  readonly bytes: readonly number[];
}

/** ROM の上の名前の付いた範囲（参照元の検索で、見つかった場所の名前に使う）。 */
export interface KnownRange {
  readonly start: number;
  readonly end: number;
  readonly kind: KnownRangeKind;
  readonly map: MapId | null;
  /** 何番目か（一覧の中の番号。無ければ null）。 */
  readonly index: number | null;
}

export type KnownRangeKind = "bankTable" | "bankList" | "header" | "layout" | "events" | "persons" | "warps" | "traps" | "signs" | "connections" | "mapScripts";

function bytesOf(value: number): number[] {
  return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, value >>> 24];
}

/** その位置のポインタ（ROM の外なら null）。 */
function readPointer(rom: Rom, location: number, kind: MapPointerKind, index: number | null = null): MapPointer | null {
  if (!rom.inRange(location, 4)) return null;
  const value = rom.u32(location) >>> 0;
  return { kind, index, location, value, bytes: bytesOf(value) };
}

/** ポインタが指す ROM の上の位置（ポインタでなければ null）。 */
function target(rom: Rom, p: MapPointer | null): number | null {
  return p && rom.isPointer(p.value) ? p.value - ROM_BASE : null;
}

/**
 * ベース ROM の上のマップのポインタの一覧（#307。Bochi の MapPointerReport と同じ考え方）。
 * マップの表の場所（バンクの一覧の中）、ヘッダー（フッター・イベント・マップスクリプト・接続）、フッター（ボーダー・配置・
 * タイルセット）、イベントの 4 つの一覧と人・看板・スクリプトタイルのスクリプト、接続の一覧、マップスクリプトの一覧の順。
 * ROM に無いマップ（maps\ だけにある新しいマップ）なら空。読めないところは飛ばす。
 */
export function listMapPointers(rom: Rom, banks: MapBankTable, id: MapId): MapPointer[] {
  const out: MapPointer[] = [];
  const list = banks.offset + id.bank * 4;
  if (!rom.inRange(list, 4) || !rom.isPointer(rom.u32(list))) return out;
  const header = readPointer(rom, rom.u32(list) - ROM_BASE + id.map * 4, "header");
  const h = target(rom, header);
  if (!header || h === null || banks.banks[id.bank]?.[id.map] === undefined) return out;
  out.push(header);
  const push = (p: MapPointer | null): MapPointer | null => {
    if (p) out.push(p);
    return p;
  };
  const layout = push(readPointer(rom, h + MAP_HEADER.layout, "layout"));
  const events = push(readPointer(rom, h + MAP_HEADER.events, "events"));
  const scripts = push(readPointer(rom, h + MAP_HEADER.scripts, "scripts"));
  const connections = push(readPointer(rom, h + MAP_HEADER.connections, "connections"));
  const f = target(rom, layout);
  if (f !== null && rom.inRange(f, MAP_LAYOUT_SIZE)) {
    push(readPointer(rom, f + 0x08, "border"));
    push(readPointer(rom, f + 0x0c, "blocks"));
    push(readPointer(rom, f + 0x10, "primaryTileset"));
    push(readPointer(rom, f + 0x14, "secondaryTileset"));
  }
  const e = target(rom, events);
  if (e !== null && rom.inRange(e, EVENT_HEADER_SIZE)) {
    const counts = { persons: rom.u8(e + EVENT_HEADER.personCount), warps: rom.u8(e + EVENT_HEADER.warpCount), traps: rom.u8(e + EVENT_HEADER.trapCount), signs: rom.u8(e + EVENT_HEADER.signCount) };
    const persons = push(readPointer(rom, e + EVENT_HEADER.persons, "persons"));
    push(readPointer(rom, e + EVENT_HEADER.warps, "warps"));
    const traps = push(readPointer(rom, e + EVENT_HEADER.traps, "traps"));
    const signs = push(readPointer(rom, e + EVENT_HEADER.signs, "signs"));
    const pl = target(rom, persons);
    if (pl !== null) for (let i = 0; i < counts.persons; i++) push(readPointer(rom, pl + i * PERSON_SIZE + PERSON.script, "personScript", i));
    const tl = target(rom, traps);
    if (tl !== null) for (let i = 0; i < counts.traps; i++) push(readPointer(rom, tl + i * TRAP_SIZE + TRAP.script, "trapScript", i));
    const sl = target(rom, signs);
    if (sl !== null) {
      for (let i = 0; i < counts.signs; i++) {
        const at = sl + i * SIGN_SIZE;
        if (rom.inRange(at, SIGN_SIZE) && !isHiddenItemKind(rom.u8(at + SIGN.kind))) push(readPointer(rom, at + SIGN.data, "signScript", i));
      }
    }
  }
  const c = target(rom, connections);
  if (c !== null && rom.inRange(c, CONNECTION_HEADER_SIZE)) push(readPointer(rom, c + 0x04, "connectionList"));
  const s = target(rom, scripts);
  if (s !== null) {
    for (let i = 0; i < MAX_MAP_SCRIPT_ENTRIES && rom.inRange(s + i * MAP_SCRIPT_ENTRY_SIZE, 1); i++) {
      const at = s + i * MAP_SCRIPT_ENTRY_SIZE;
      if (rom.u8(at + MAP_SCRIPT_ENTRY.type) === 0) break;
      push(readPointer(rom, at + MAP_SCRIPT_ENTRY.pointer, "mapScript", i));
    }
  }
  return out;
}

/**
 * ROM の上の、マップの表に関係する名前の付いた範囲（参照元の検索の結果に名前を付けるため）。
 * バンク表、各バンクのヘッダーの一覧、全マップのヘッダー・フッター・イベントヘッダーと 4 つの一覧・接続の一覧・マップスクリプトの一覧。
 */
export function knownMapRanges(rom: Rom, banks: MapBankTable): KnownRange[] {
  const out: KnownRange[] = [{ start: banks.offset, end: banks.offset + banks.bankCount * 4, kind: "bankTable", map: null, index: null }];
  const add = (start: number | null, size: number, kind: KnownRangeKind, map: MapId | null, index: number | null = null): void => {
    if (start !== null && size > 0 && rom.inRange(start, size)) out.push({ start, end: start + size, kind, map, index });
  };
  const ptr = (at: number): number | null => (rom.inRange(at, 4) && rom.isPointer(rom.u32(at)) ? rom.u32(at) - ROM_BASE : null);
  for (let bank = 0; bank < banks.bankCount; bank++) add(ptr(banks.offset + bank * 4), banks.mapCount(bank) * 4, "bankList", { bank, map: 0 }, bank);
  for (const id of banks.ids()) {
    const h = banks.headerOffset(id);
    add(h, MAP_HEADER_SIZE, "header", id);
    if (!rom.inRange(h, MAP_HEADER_SIZE)) continue;
    add(ptr(h + MAP_HEADER.layout), MAP_LAYOUT_SIZE, "layout", id);
    const e = ptr(h + MAP_HEADER.events);
    add(e, EVENT_HEADER_SIZE, "events", id);
    if (e !== null && rom.inRange(e, EVENT_HEADER_SIZE)) {
      add(ptr(e + EVENT_HEADER.persons), rom.u8(e + EVENT_HEADER.personCount) * PERSON_SIZE, "persons", id);
      add(ptr(e + EVENT_HEADER.warps), rom.u8(e + EVENT_HEADER.warpCount) * WARP_SIZE, "warps", id);
      add(ptr(e + EVENT_HEADER.traps), rom.u8(e + EVENT_HEADER.trapCount) * TRAP_SIZE, "traps", id);
      add(ptr(e + EVENT_HEADER.signs), rom.u8(e + EVENT_HEADER.signCount) * SIGN_SIZE, "signs", id);
    }
    const c = ptr(h + MAP_HEADER.connections);
    if (c !== null && rom.inRange(c, CONNECTION_HEADER_SIZE)) add(ptr(c + 0x04), Math.min(rom.u32(c), 16) * 12, "connections", id);
    const s = ptr(h + MAP_HEADER.scripts);
    if (s !== null) {
      let n = 0;
      while (n < MAX_MAP_SCRIPT_ENTRIES && rom.inRange(s + n * MAP_SCRIPT_ENTRY_SIZE, 1) && rom.u8(s + n * MAP_SCRIPT_ENTRY_SIZE) !== 0) n++;
      add(s, n * MAP_SCRIPT_ENTRY_SIZE + 1, "mapScripts", id);
    }
  }
  return out;
}

/**
 * 位置が入っている名前の付いた範囲（小さい範囲を優先。無ければ null）。一覧の中なら、何番目の要素かも返す。
 */
export function rangeAt(ranges: readonly KnownRange[], offset: number): { range: KnownRange; element: number | null; at: number } | null {
  let best: KnownRange | null = null;
  for (const r of ranges) {
    if (offset < r.start || offset >= r.end) continue;
    if (!best || r.end - r.start < best.end - best.start) best = r;
  }
  if (!best) return null;
  const size = ELEMENT_SIZE[best.kind];
  const at = offset - best.start;
  return { range: best, element: size ? Math.floor(at / size) : null, at: size ? at % size : at };
}

/** 一覧の要素の大きさ（要素の番号を出す範囲だけ）。 */
const ELEMENT_SIZE: Partial<Record<KnownRangeKind, number>> = {
  bankTable: 4,
  bankList: 4,
  persons: PERSON_SIZE,
  warps: WARP_SIZE,
  traps: TRAP_SIZE,
  signs: SIGN_SIZE,
  connections: 12,
  mapScripts: MAP_SCRIPT_ENTRY_SIZE,
};
