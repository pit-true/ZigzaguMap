import { MAP_HEADER_SIZE, TILESET_HEADER_SIZE, TILE_BYTES } from "../map/constants.js";
import { MapBankTable } from "../map/MapBankTable.js";
import type { MapId } from "../map/types.js";
import { MapNameTable } from "../name/MapNameTable.js";
import { TextCodec } from "../name/TextCodec.js";
import { ROM_BASE, Rom } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import {
  SOURCE_TOTAL_BLOCKS,
  SOURCE_TOTAL_TILES,
  findMapBankTablePointer,
  findMapNameTablePointer,
  sourceGameOf,
  type SourceGame,
} from "./SourceGame.js";

/** パレットの色数（16 本 × 16 色）。 */
const PALETTE_COLORS = 256;
/** ブロック定義 1 個のバイト数。 */
const BLOCK_BYTES = 16;
/** 幅・高さの上限（壊れた値をはじく）。 */
const MAX_DIMENSION = 0x400;

/** 別の ROM のマップ 1 枚（一覧用）。 */
export interface SourceMapInfo {
  readonly id: MapId;
  /** 地名（FR・LG の日本語版だけ。読めなければ null）。 */
  readonly name: string | null;
  /** 地名番号。 */
  readonly regionMapSectionId: number;
  readonly width: number;
  readonly height: number;
  /** 主・副タイルセットのヘッダーのポインタ値。 */
  readonly primary: number;
  readonly secondary: number;
}

/** 別の ROM のマップの配置とボーダー。 */
export interface SourceLayout {
  readonly width: number;
  readonly height: number;
  /** 配置（下位 10 ビットがブロック番号、上位 6 ビットが移動許可）。 */
  readonly blocks: Uint16Array;
  readonly borderWidth: number;
  readonly borderHeight: number;
  readonly border: Uint16Array;
}

/** 別の ROM から取り出したタイルセット 1 つ（その ROM の形のまま。属性はエメラルドなら u16 の値）。 */
export interface SourceTileset {
  /** ヘッダーのポインタ値。 */
  readonly pointer: number;
  readonly secondary: boolean;
  /** タイル画像が LZ77 圧縮か。 */
  readonly compressed: boolean;
  /** アニメ処理の関数のアドレス（そのままの値。無ければ 0）。 */
  readonly callback: number;
  /** 4bpp タイル（展開済み）。 */
  readonly tiles: Uint8Array;
  /** パレット（BGR555 × 256）。 */
  readonly palettes: Uint16Array;
  /** ブロック定義（1 ブロック 8 個の u16）。 */
  readonly blocks: Uint16Array;
  /** 属性（FR・LG は u32、エメラルドは u16 の値）。 */
  readonly attributes: Uint32Array;
}

/**
 * 移植の元にする別の ROM（読むだけ）。マップの一覧・配置・タイルセットを取り出す。
 * 取り出した値は ROM の配列と共有しない写しなので、使い終わったらこのオブジェクトを捨てれば ROM の配列も GC で消える。
 */
export class TransplantSource {
  readonly game: SourceGame;
  private readonly banks: MapBankTable;
  private readonly names: MapNameTable | null;
  private starts: number[] | null = null;

  private constructor(
    readonly rom: Rom,
    game: SourceGame,
  ) {
    this.game = game;
    const pointer = findMapBankTablePointer(rom);
    if (pointer === null) throw new RomError("マップバンク表が見つかりません");
    this.banks = MapBankTable.read(rom, pointer);
    const namePointer = game.japanese ? findMapNameTablePointer(rom, game) : null;
    this.names = namePointer === null ? null : safe(() => MapNameTable.read(rom, namePointer));
  }

  /** ROM のバイト列から開く。対象外のゲームなら RomError。 */
  static open(bytes: Uint8Array): TransplantSource {
    const rom = new Rom(bytes);
    if (!rom.inRange(0, 0xc0)) throw new RomError("ROM が小さすぎます");
    const code = rom.ascii(0xac, 4);
    const game = sourceGameOf(code);
    if (!game) throw new RomError(`移植の元にできないゲームです: ${code || "(不明)"}`);
    return new TransplantSource(rom, game);
  }

  /** 全マップの一覧（読めないマップは飛ばす）。 */
  maps(): SourceMapInfo[] {
    const out: SourceMapInfo[] = [];
    for (const id of this.banks.ids()) {
      const info = safe(() => this.mapInfo(id));
      if (info) out.push(info);
    }
    return out;
  }

  /** マップ 1 枚の情報。 */
  mapInfo(id: MapId): SourceMapInfo {
    const rom = this.rom;
    const header = this.banks.headerOffset(id);
    rom.check(header, MAP_HEADER_SIZE);
    const layout = rom.pointer(header);
    rom.check(layout, this.game.spec.layoutBytes);
    const width = rom.u32(layout);
    const height = rom.u32(layout + 4);
    if (width === 0 || height === 0 || width > MAX_DIMENSION || height > MAX_DIMENSION) throw new RomError("マップの大きさが不正です");
    const region = rom.u8(header + 0x14);
    return {
      id,
      name: this.names ? safe(() => this.names!.name(region, TextCodec.japanese)) : null,
      regionMapSectionId: region,
      width,
      height,
      primary: rom.u32(layout + 0x10) >>> 0,
      secondary: rom.u32(layout + 0x14) >>> 0,
    };
  }

  /** マップの配置とボーダー（エメラルドのボーダーは 2×2）。 */
  layout(id: MapId): SourceLayout {
    const rom = this.rom;
    const layout = rom.pointer(this.banks.headerOffset(id));
    const width = rom.u32(layout);
    const height = rom.u32(layout + 4);
    const fr = this.game.spec.family === "frlg";
    const borderWidth = fr ? rom.u8(layout + 0x18) : 2;
    const borderHeight = fr ? rom.u8(layout + 0x19) : 2;
    return {
      width,
      height,
      blocks: rom.u16Array(rom.pointer(layout + 0x0c), width * height).slice(),
      borderWidth,
      borderHeight,
      border: rom.u16Array(rom.pointer(layout + 0x08), borderWidth * borderHeight).slice(),
    };
  }

  /**
   * タイルセットを取り出す。タイル数とブロック数は、次のデータ（ほかのタイルセットのデータ）の手前までで決める
   * （TilesetDocument.fromRom と同じ考え方。副は 0xFF で埋まったブロックの手前まで）。
   */
  tileset(pointer: number, secondary: boolean): SourceTileset {
    const rom = this.rom;
    const spec = this.game.spec;
    const at = pointer - ROM_BASE;
    rom.check(at, TILESET_HEADER_SIZE);
    const compressed = rom.u8(at) !== 0;
    const tilesAt = rom.pointer(at + 0x04);
    const palettesAt = rom.pointer(at + 0x08);
    const blocksAt = rom.pointer(at + 0x0c);
    // ヘッダーの 0x10 と 0x14 は、FR・LG が「アニメ処理・属性」、エメラルドが「属性・アニメ処理」の順
    const fields = headerFields(this.game);
    const callback = rom.u32(at + fields.callback) >>> 0;
    const attrValue = rom.u32(at + fields.attributes);
    const attributesAt = rom.isPointer(attrValue) ? attrValue - ROM_BASE : 0;
    const tileCapacity = secondary ? SOURCE_TOTAL_TILES - spec.primaryTiles : spec.primaryTiles;
    const blockCapacity = secondary ? SOURCE_TOTAL_BLOCKS - spec.primaryBlocks : spec.primaryBlocks;
    const own = [tilesAt, palettesAt, blocksAt, attributesAt].filter((v) => v > 0);
    const next = (from: number) => nextStart(this.dataStarts(), own, from, rom.size);

    const raw = compressed ? rom.lz77(tilesAt) : rom.slice(tilesAt, Math.min(rom.size - tilesAt, tileCapacity * TILE_BYTES));
    let tileCount = Math.floor(raw.length / TILE_BYTES);
    if (!compressed) tileCount = Math.min(tileCount, Math.floor((next(tilesAt) - tilesAt) / TILE_BYTES));
    tileCount = Math.max(1, Math.min(tileCount, tileCapacity));
    const tiles = raw.slice(0, tileCount * TILE_BYTES);

    let blockCount = Math.floor((next(blocksAt) - blocksAt) / BLOCK_BYTES);
    if (attributesAt > 0) blockCount = Math.min(blockCount, Math.floor((next(attributesAt) - attributesAt) / spec.attributeBytes));
    if (secondary) {
      for (let i = 0; i < blockCapacity; i++) {
        const o = blocksAt + i * BLOCK_BYTES;
        if (o + BLOCK_BYTES > rom.size || rom.slice(o, BLOCK_BYTES).every((b) => b === 0xff)) {
          blockCount = Math.min(blockCount, i);
          break;
        }
      }
    }
    blockCount = Math.min(blockCapacity, blockCount, Math.floor((rom.size - blocksAt) / BLOCK_BYTES));
    if (blockCount <= 0) blockCount = 1;

    const attributes = new Uint32Array(blockCount);
    if (attributesAt > 0) {
      for (let i = 0; i < blockCount; i++) {
        const o = attributesAt + i * spec.attributeBytes;
        if (!rom.inRange(o, spec.attributeBytes)) break;
        attributes[i] = spec.attributeBytes === 4 ? rom.u32(o) >>> 0 : rom.u16(o);
      }
    }
    return {
      pointer: pointer >>> 0,
      secondary,
      compressed,
      callback,
      tiles,
      palettes: rom.u16Array(palettesAt, PALETTE_COLORS).slice(),
      blocks: rom.u16Array(blocksAt, blockCount * 8).slice(),
      attributes,
    };
  }

  /** `address`（0x08 起点。Thumb のビットは無視）から `length` バイト。ROM の外なら null。 */
  code(address: number, length: number): Uint8Array | null {
    return codeAt(this.rom, address, length);
  }

  /** 全マップが使うタイルセットのデータの開始位置（昇順）。 */
  private dataStarts(): number[] {
    if (this.starts) return this.starts;
    const rom = this.rom;
    const headers = new Set<number>();
    for (const id of this.banks.ids()) {
      const info = safe(() => this.mapInfo(id));
      if (!info) continue;
      for (const p of [info.primary, info.secondary]) if (rom.isPointer(p)) headers.add(p - ROM_BASE);
    }
    const starts = new Set<number>();
    for (const at of headers) {
      if (!rom.inRange(at, TILESET_HEADER_SIZE)) continue;
      starts.add(at);
      for (const field of [0x04, 0x08, 0x0c, headerFields(this.game).attributes]) {
        const value = rom.u32(at + field);
        if (rom.isPointer(value)) starts.add(value - ROM_BASE);
      }
    }
    this.starts = [...starts].sort((a, b) => a - b);
    return this.starts;
  }
}

/** タイルセットのヘッダーの、アニメ処理と属性の位置。 */
function headerFields(game: SourceGame): { callback: number; attributes: number } {
  return game.spec.family === "frlg" ? { callback: 0x10, attributes: 0x14 } : { callback: 0x14, attributes: 0x10 };
}

/** ROM の `address`（0x08 起点。Thumb のビットは無視）から `length` バイト。外なら null。 */
export function codeAt(rom: Rom, address: number, length: number): Uint8Array | null {
  if (!rom.isPointer(address)) return null;
  const at = (address & ~1) - ROM_BASE;
  return rom.inRange(at, length) ? rom.slice(at, length) : null;
}

function nextStart(starts: readonly number[], own: readonly number[], from: number, end: number): number {
  let next = end;
  for (const s of starts) if (s > from && s < next) next = s;
  for (const s of own) if (s > from && s < next) next = s;
  return next;
}

function safe<T>(f: () => T): T | null {
  try {
    return f();
  } catch {
    return null;
  }
}
