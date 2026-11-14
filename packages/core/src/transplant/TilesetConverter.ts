import {
  BLOCK_ID_MASK,
  MOVEMENT_MASK,
  PRIMARY_BLOCK_COUNT,
  PRIMARY_PALETTE_COUNT,
  PRIMARY_TILE_COUNT,
  TILESET_HEADER_SIZE,
  TILE_BYTES,
  TOTAL_BLOCK_COUNT,
  TOTAL_PALETTE_COUNT,
  TOTAL_TILE_COUNT,
} from "../map/constants.js";
import { TILES_PER_ROW } from "../tileset/TileImage.js";
import { emeraldAttributeToFr } from "./behaviorTable.js";
import type { SourceGameSpec } from "./SourceGame.js";
import type { SourceLayout, SourceTileset } from "./TransplantSource.js";

/** 取り込む側（主だけ・副だけ・両方）。 */
export type TransplantParts = "primary" | "secondary" | "both";

/** FR の形にしたタイルセット 1 つ（TilesetDocument.createNew に渡せる中身）。 */
export interface ConvertedTileset {
  readonly secondary: boolean;
  readonly compressed: boolean;
  /** ヘッダー 24 バイト（ポインタの部分は 0。アニメ処理は残すときだけ）。 */
  readonly header: Uint8Array;
  /** 4bpp タイル（16 の倍数のタイル数）。 */
  readonly tiles: Uint8Array;
  readonly palettes: Uint16Array;
  readonly blocks: Uint16Array;
  readonly attributes: Uint32Array;
}

/** 変換で変わったこと（取り込む前に一覧で見せる）。 */
export interface TransplantReport {
  /** 元の ROM の系統。 */
  readonly family: SourceGameSpec["family"];
  /** 上限を超えたので、使われているものだけに詰めたタイルの数（詰めなければ 0）。 */
  readonly packedTiles: number;
  /** 詰めて捨てたタイルの数。 */
  readonly droppedTiles: number;
  /** 上限を超えたので、配置で使われているものだけに詰めたブロックの数（詰めなければ 0）。 */
  readonly packedBlocks: number;
  /** 詰めて捨てたブロックの数。 */
  readonly droppedBlocks: number;
  /** FR に無いので 0 にしたエメラルドの挙動（昇順）。 */
  readonly unknownBehaviors: readonly number[];
  /** 動かしたパレット（元の番号 → FR の番号）。 */
  readonly movedPalettes: readonly { readonly from: number; readonly to: number }[];
  /** 入りきらないので、似た色のパレットにまとめた元のパレット（元の番号 → まとめた先の FR の番号）。 */
  readonly mergedPalettes: readonly { readonly from: number; readonly to: number }[];
  /** アニメ処理を残したか（主・副。取り込まない側と、元から無いときは null）。 */
  readonly callbackKept: { readonly primary: boolean | null; readonly secondary: boolean | null };
}

/** 変換の結果。 */
export interface TransplantConversion {
  readonly primary: ConvertedTileset | null;
  readonly secondary: ConvertedTileset | null;
  /** 元の配置のマス（ブロック番号＋移動許可）を FR のマスにする。捨てたブロックは 0。 */
  readonly cell: (value: number) => number;
  readonly report: TransplantReport;
}

/** 変換の入力。 */
export interface TransplantInput {
  readonly spec: SourceGameSpec;
  /** 元のマップの主・副タイルセット（片方だけ取り込むときも、パレットの使われ方を見るので両方渡す）。 */
  readonly primary: SourceTileset;
  readonly secondary: SourceTileset;
  readonly parts: TransplantParts;
  /** 元のマップの配置とボーダー（ブロックを詰めるときに使われているものを見る）。 */
  readonly layout: SourceLayout | null;
  /** アニメ処理を残すか（取り込み先のベース ROM の同じアドレスに同じ処理があるか。#319 の Q11）。 */
  readonly keepCallback: (callback: number) => boolean;
}

/**
 * 別の ROM のタイルセットを FR の形にする（#309）。
 * - FR・LG から: そのまま写す（3 層のブロックもそのまま）。
 * - エメラルドから: 副のタイル番号（512 → 640）、パレットの本数（主 6・副 7 → 主 7・副 6）、属性（2 バイト → 4 バイト）を直し、
 *   副のタイルとブロックが FR の上限（384）を超えるときは使われているものだけに詰める。
 */
export function convertTilesets(input: TransplantInput): TransplantConversion {
  return input.spec.family === "frlg" ? copyFrlg(input) : convertEmerald(input);
}

// ---- FR・LG から ----

function copyFrlg(input: TransplantInput): TransplantConversion {
  const withPrimary = input.parts !== "secondary";
  const withSecondary = input.parts !== "primary";
  const primary = withPrimary ? frTileset(input.primary, false, input.primary.blocks, input.primary.attributes, input.primary.palettes, input.primary.tiles, input.keepCallback) : null;
  const secondary = withSecondary ? frTileset(input.secondary, true, input.secondary.blocks, input.secondary.attributes, input.secondary.palettes, input.secondary.tiles, input.keepCallback) : null;
  return {
    primary: primary?.tileset ?? null,
    secondary: secondary?.tileset ?? null,
    cell: (v) => v,
    report: {
      family: "frlg",
      packedTiles: 0,
      droppedTiles: 0,
      packedBlocks: 0,
      droppedBlocks: 0,
      unknownBehaviors: [],
      movedPalettes: [],
      mergedPalettes: [],
      callbackKept: { primary: primary?.callbackKept ?? null, secondary: secondary?.callbackKept ?? null },
    },
  };
}

// ---- エメラルドから ----

function convertEmerald(input: TransplantInput): TransplantConversion {
  const { spec, parts } = input;
  const withPrimary = parts !== "secondary";
  const withSecondary = parts !== "primary";
  const secPalFirst = spec.primaryPalettes; // 6

  // 副のブロック: FR の上限を超えるなら、配置で使われているものだけに詰める
  const secSourceCount = input.secondary.attributes.length;
  const secCapacity = TOTAL_BLOCK_COUNT - PRIMARY_BLOCK_COUNT;
  let blockKeep: number[] = range(secSourceCount);
  let packedBlocks = 0;
  if (withSecondary && secSourceCount > secCapacity) {
    const used = new Set<number>();
    if (input.layout) {
      for (const v of [...input.layout.blocks, ...input.layout.border]) {
        const b = v & BLOCK_ID_MASK;
        if (b >= spec.primaryBlocks && b - spec.primaryBlocks < secSourceCount) used.add(b - spec.primaryBlocks);
      }
    }
    blockKeep = [...used].sort((a, b) => a - b).slice(0, secCapacity);
    packedBlocks = blockKeep.length;
  }
  const blockMap = new Map<number, number>(blockKeep.map((b, i) => [b, i]));
  const droppedBlocks = withSecondary ? secSourceCount - blockKeep.length : 0;

  // パレット: 主 0〜5 はそのまま。副 6〜12 は、両方なら 6 を FR の主の 6 番へ（番号はそのまま）。副だけなら 6 本に収める。
  const secBlocks = gather(input.secondary.blocks, blockKeep);
  const usage = paletteUsage([...(withPrimary ? [input.primary.blocks] : []), secBlocks]);
  const palMap = range(16);
  const moved: { from: number; to: number }[] = [];
  const merged: { from: number; to: number }[] = [];
  if (parts === "secondary") {
    const used = range(TOTAL_PALETTE_COUNT - secPalFirst).map((i) => secPalFirst + i).filter((p) => usage[p]! > 0);
    const slots = range(TOTAL_PALETTE_COUNT - PRIMARY_PALETTE_COUNT).map((i) => PRIMARY_PALETTE_COUNT + i); // 7〜12
    // 7〜12 の番号は同じ番号へ、6 番（と入りきらないもの）は空いている番号へ
    const free = slots.filter((s) => !used.includes(s));
    for (const p of used) {
      if (p >= PRIMARY_PALETTE_COUNT) continue;
      const to = free.shift();
      if (to !== undefined) {
        palMap[p] = to;
        moved.push({ from: p, to });
      } else {
        const to2 = nearestPalette(input.secondary.palettes, p, used.filter((q) => q !== p));
        palMap[p] = to2;
        merged.push({ from: p, to: to2 });
      }
    }
  }

  // 副のタイル: 512 → 640 へずらす。上限（384）を超えるなら使われているものだけに詰める
  const secTileCount = input.secondary.tiles.length / TILE_BYTES;
  const tileCapacity = TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT;
  let tileMap: Map<number, number> | null = null;
  let packedTiles = 0;
  let droppedTiles = 0;
  if (withSecondary && secTileCount > tileCapacity) {
    const used = new Set<number>();
    for (const blocks of [secBlocks, ...(withPrimary ? [input.primary.blocks] : [])]) {
      for (const ref of blocks) {
        const t = ref & 0x3ff;
        if (t >= spec.primaryTiles && t - spec.primaryTiles < secTileCount) used.add(t - spec.primaryTiles);
      }
    }
    const keep = [...used].sort((a, b) => a - b).slice(0, tileCapacity);
    tileMap = new Map(keep.map((t, i) => [t, i]));
    packedTiles = keep.length;
    droppedTiles = secTileCount - keep.length;
  }
  const ref = (value: number): number => {
    const t = value & 0x3ff;
    const flips = value & 0x0c00;
    const pal = palMap[(value >> 12) & 0xf]!;
    let tile = t;
    if (t >= spec.primaryTiles) {
      const local = t - spec.primaryTiles;
      const mapped = tileMap ? tileMap.get(local) : local;
      tile = mapped === undefined ? 0 : PRIMARY_TILE_COUNT + mapped;
    }
    return (tile & 0x3ff) | flips | (pal << 12);
  };

  const unknown = new Set<number>();
  const attrs = (values: Uint32Array, keep: readonly number[]): Uint32Array =>
    Uint32Array.from(keep, (i) => {
      const c = emeraldAttributeToFr(values[i] ?? 0);
      if (c.unknownBehavior !== null) unknown.add(c.unknownBehavior);
      return c.value;
    });

  let primary: { tileset: ConvertedTileset; callbackKept: boolean | null } | null = null;
  if (withPrimary) {
    const palettes = input.primary.palettes.slice();
    // 両方のときは、エメラルドの副の 6 番を FR の主の 6 番へ
    if (parts === "both") palettes.set(input.secondary.palettes.subarray(secPalFirst * 16, secPalFirst * 16 + 16), secPalFirst * 16);
    const blocks = input.primary.blocks.map(ref);
    primary = frTileset(input.primary, false, blocks, attrs(input.primary.attributes, range(input.primary.attributes.length)), palettes, input.primary.tiles, () => false);
  }
  let secondary: { tileset: ConvertedTileset; callbackKept: boolean | null } | null = null;
  if (withSecondary) {
    const palettes = new Uint16Array(256);
    palettes.set(input.secondary.palettes);
    // 動かしたパレットは、動かした先の番号へ色を写す（まとめたものは写さない）
    for (const { from, to } of moved) palettes.set(input.secondary.palettes.subarray(from * 16, from * 16 + 16), to * 16);
    let tiles = input.secondary.tiles;
    if (tileMap) {
      tiles = new Uint8Array(tileMap.size * TILE_BYTES);
      for (const [from, to] of tileMap) tiles.set(input.secondary.tiles.subarray(from * TILE_BYTES, from * TILE_BYTES + TILE_BYTES), to * TILE_BYTES);
    } else if (secTileCount > tileCapacity) {
      tiles = tiles.subarray(0, tileCapacity * TILE_BYTES);
    }
    const blocks = secBlocks.map(ref);
    secondary = frTileset(input.secondary, true, blocks, attrs(input.secondary.attributes, blockKeep), palettes, tiles, () => false);
  }

  return {
    primary: primary?.tileset ?? null,
    secondary: secondary?.tileset ?? null,
    cell: (v) => {
      const b = v & BLOCK_ID_MASK;
      const movement = v & MOVEMENT_MASK;
      if (b < spec.primaryBlocks) return movement | b;
      const mapped = blockMap.get(b - spec.primaryBlocks);
      return mapped === undefined ? movement : movement | (PRIMARY_BLOCK_COUNT + mapped);
    },
    report: {
      family: "emerald",
      packedTiles,
      droppedTiles,
      packedBlocks,
      droppedBlocks,
      unknownBehaviors: [...unknown].sort((a, b) => a - b),
      movedPalettes: moved,
      mergedPalettes: merged,
      callbackKept: {
        primary: withPrimary && input.primary.callback !== 0 ? false : null,
        secondary: withSecondary && input.secondary.callback !== 0 ? false : null,
      },
    },
  };
}

// ---- 共通 ----

/** FR の形のタイルセットを組み立てる（タイルは 16 の倍数に切り上げ、上限で切る）。 */
function frTileset(
  source: SourceTileset,
  secondary: boolean,
  blocks: Uint16Array,
  attributes: Uint32Array,
  palettes: Uint16Array,
  tiles: Uint8Array,
  keepCallback: (callback: number) => boolean,
): { tileset: ConvertedTileset; callbackKept: boolean | null } {
  const tileCapacity = secondary ? TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT : PRIMARY_TILE_COUNT;
  const blockCapacity = secondary ? TOTAL_BLOCK_COUNT - PRIMARY_BLOCK_COUNT : PRIMARY_BLOCK_COUNT;
  const tileCount = Math.min(tileCapacity, Math.max(1, Math.ceil(tiles.length / TILE_BYTES)));
  const rows = Math.ceil(tileCount / TILES_PER_ROW);
  const outTiles = new Uint8Array(rows * TILES_PER_ROW * TILE_BYTES);
  outTiles.set(tiles.subarray(0, Math.min(tiles.length, tileCount * TILE_BYTES)));
  const blockCount = Math.min(blockCapacity, attributes.length);
  const header = new Uint8Array(TILESET_HEADER_SIZE);
  header[0] = source.compressed ? 1 : 0;
  header[1] = secondary ? 1 : 0;
  const kept = source.callback !== 0 && keepCallback(source.callback);
  if (kept) new DataView(header.buffer).setUint32(0x10, source.callback, true);
  return {
    tileset: {
      secondary,
      compressed: source.compressed,
      header,
      tiles: outTiles,
      palettes: Uint16Array.from(palettes.subarray(0, 256)),
      blocks: blocks.slice(0, blockCount * 8),
      attributes: attributes.slice(0, blockCount),
    },
    callbackKept: source.callback === 0 ? null : kept,
  };
}

/** パレットごとの、ブロックのタイル指定での使われ方の数（0〜15）。 */
function paletteUsage(blockLists: readonly Uint16Array[]): number[] {
  const usage = new Array<number>(16).fill(0);
  for (const blocks of blockLists) for (const v of blocks) usage[(v >> 12) & 0xf]!++;
  return usage;
}

/** `p` に色がいちばん近いパレットの番号（候補 `others` の中から）。 */
function nearestPalette(palettes: Uint16Array, p: number, others: readonly number[]): number {
  let best = others[0] ?? p;
  let bestDistance = Infinity;
  for (const q of others) {
    let d = 0;
    for (let c = 1; c < 16; c++) d += colorDistance(palettes[p * 16 + c]!, palettes[q * 16 + c]!);
    if (d < bestDistance) {
      bestDistance = d;
      best = q;
    }
  }
  return best;
}

function colorDistance(a: number, b: number): number {
  const dr = (a & 0x1f) - (b & 0x1f);
  const dg = ((a >> 5) & 0x1f) - ((b >> 5) & 0x1f);
  const db = ((a >> 10) & 0x1f) - ((b >> 10) & 0x1f);
  return dr * dr + dg * dg + db * db;
}

function gather(blocks: Uint16Array, keep: readonly number[]): Uint16Array {
  const out = new Uint16Array(keep.length * 8);
  keep.forEach((b, i) => out.set(blocks.subarray(b * 8, b * 8 + 8), i * 8));
  return out;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}
