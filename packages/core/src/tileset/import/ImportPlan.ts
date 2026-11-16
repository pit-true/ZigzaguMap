/**
 * 画像からタイルとブロックを作る（Phase6 #442）: 書き込む前の「計画」。DOM に依存しない。
 *
 * 色の面（ImportImage）→ パレットの割り当て（PaletteAssigner。選べば減色）→ タイルの色番号と重複の除去（TileDeduper）
 * → 新しいタイルの置き場所 → ブロック（BlockBuilder）と置く番号、の順に決め、数（使う数 / 空き / 上限）と問題の一覧、
 * 書き込む中身（タイル・パレット・ブロック・属性の新しい配列）を返す。設定を変えるたびに作り直す。
 *
 * 空きのタイル: 全部 0 で、どのブロックからも指されていないもの（主の 0 番は使わない）。主のタイルは同じ主を使う全部の組の
 * 副のブロックからも数える。副へ入れるときは、ドアのアニメが一時的に使う副の最後の 8 タイル（通し番号 1016〜1023）を
 * 既定で空けておく（Phase6 の調査 B）。
 */
import { PRIMARY_BLOCK_COUNT, PRIMARY_PALETTE_COUNT, PRIMARY_TILE_COUNT, TILE_BYTES, TOTAL_BLOCK_COUNT, TOTAL_PALETTE_COUNT, TOTAL_TILE_COUNT } from "../../map/constants.js";
import { BLOCK_TILE_COUNT, packTileRef } from "../blockFormat.js";
import { TILES_PER_ROW } from "../TileImage.js";
import { buildBlocks, placeBlocks, type BaseBlock, type BuiltBlock, type ImportLayerMode, type PlacementProblem } from "./BlockBuilder.js";
import { TRANSPARENT, isTransparentTile, splitTiles, type ImportLayers } from "./ImportImage.js";
import { assignPalettes, indexTile, reduceToFit, type PaletteAssignment, type PaletteGroup, type PaletteSlotInput } from "./PaletteAssigner.js";
import { TileDeduper, type ExistingTiles } from "./TileDeduper.js";

/** ドアのアニメが使う副のタイル（タイルセットの中の番号 376〜383。通し番号 1016〜1023）。 */
export const DOOR_TILE_START = TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT - 8;

/** タイルセット 1 つの中身（計画は書き換えない）。 */
export interface ImportTable {
  /** 4bpp のタイル（1 枚 32 バイト）。 */
  readonly tiles: Uint8Array;
  /** パレット（BGR555 × 256。主は 0〜6、副は 7〜12 を使う）。 */
  readonly palettes: ArrayLike<number>;
  readonly blocks: Uint16Array;
  readonly attributes: Uint32Array;
}

/** 書く先。 */
export interface ImportTarget {
  /** 副タイルセットへ書くか。 */
  readonly secondary: boolean;
  /** 新しいタイルセットを作るか（中身は空から作る。今の組の反対側はそのまま使う）。 */
  readonly isNew: boolean;
}

/** 計画の設定。 */
export interface ImportOptions {
  /** 反転で同じになるタイルをまとめる（既定 true）。 */
  readonly useFlip?: boolean;
  /** 今あるタイルを使い回す（既定 true）。 */
  readonly reuseExisting?: boolean;
  /** 全部が透明のマスはブロックにしない（既定 true）。 */
  readonly skipEmpty?: boolean;
  /** 同じマスは 1 つのブロックにする（既定 true）。 */
  readonly mergeSame?: boolean;
  /** 1 枚の画像の重ね方（既定 picture）。 */
  readonly mode?: ImportLayerMode;
  /** 2 枚の画像で、上のレイヤーもプレイヤーの下に描く（既定 false）。 */
  readonly upperBehind?: boolean;
  /** 下地ブロックの通し番号（重ね方が under・over のとき。無ければ null）。 */
  readonly baseBlock?: number | null;
  /** 本が足りなければ減色する（既定 false。画面は警告の窓で聞いてから true にする）。 */
  readonly reduce?: boolean;
  /** 使わない本の番号。 */
  readonly excludedPalettes?: readonly number[];
  /** 副へ入れるとき、ドアのアニメの 8 タイルを空ける（既定 true）。 */
  readonly reserveDoorTiles?: boolean;
  /** 手で決めた置き場所（ブロックの番号 → タイルセットの中の番号。#446）。 */
  readonly placement?: ReadonlyMap<number, number>;
  /** 使っているブロックの置き換えを許す（手で決めた置き場所だけ。既定 false）。 */
  readonly allowReplace?: boolean;
}

/** 計画の材料。 */
export interface ImportInput {
  readonly layers: ImportLayers;
  readonly target: ImportTarget;
  /** 表示中のマップの主と副。 */
  readonly primary: ImportTable;
  readonly secondary: ImportTable;
  /** 通し番号のブロックのマップ・ボーダーでの使用回数（今の組。無ければ 0）。 */
  readonly blockUsed?: (block: number) => number;
  /** 同じ主を使うほかの組の副のブロック（主のタイルと本の使用に数える）。 */
  readonly otherSecondaryBlocks?: readonly Uint16Array[];
  readonly options?: ImportOptions;
}

/** 問題の種類（error は書き込めない、note は知らせるだけ）。 */
export type ImportProblemCode =
  | "palettesShort"
  | "overColorTiles"
  | "tilesShort"
  | "blocksShort"
  | "noBlocks"
  | "baseSecondary"
  | "baseMissing"
  | "placementInvalid"
  | "padded"
  | "doorTiles"
  | "baseUpper"
  | "reduced"
  | "replaced";

/** 問題 1 つ。 */
export interface ImportProblem {
  readonly level: "error" | "note";
  readonly code: ImportProblemCode;
  readonly params: Readonly<Record<string, number | string>>;
}

/** 使う数 / 空き / 上限。 */
export interface ImportMeter {
  readonly needed: number;
  readonly free: number;
  readonly capacity: number;
}

/** 書き込む中身（書く先のタイルセットの新しい配列）。 */
export interface ImportResult {
  readonly tiles: Uint8Array;
  readonly palettes: Uint16Array;
  readonly blocks: Uint16Array;
  readonly attributes: Uint32Array;
  /** 書き換えたタイルの範囲（タイルセットの中の番号、[start, end)。無ければ null）。 */
  readonly tileRange: readonly [number, number] | null;
  /** 色を書いた本。 */
  readonly changedPalettes: readonly number[];
  /** 置いたブロック（タイルセットの中の番号。3 層は N だけ）。 */
  readonly placedBlocks: readonly number[];
}

/** 計画。 */
export interface ImportPlan {
  /** 書き込めるか（error の問題が無い）。 */
  readonly ok: boolean;
  readonly problems: readonly ImportProblem[];
  /** 本が足りない（画面は「減色する / キャンセル」を聞く）。 */
  readonly paletteShortage: boolean;
  readonly tiles: ImportMeter & { readonly created: number; readonly reused: number; readonly merged: number; readonly flipped: number; readonly before: number; readonly after: number };
  readonly blocks: ImportMeter & { readonly skipped: number; readonly merged: number; readonly replaced: number; readonly before: number; readonly after: number; readonly unplaced: number };
  readonly palettes: ImportMeter & { readonly fixedUsed: readonly number[]; readonly opened: readonly number[]; readonly overColorTiles: number; readonly groups: readonly PaletteGroup[]; readonly colorCount: number; readonly usedSlots: readonly number[]; readonly tileCounts: Readonly<Record<number, number>> };
  /** 減色した結果（減色しなければ null）。 */
  readonly reduction: { readonly changedPixels: number; readonly colorsBefore: number; readonly colorsAfter: number } | null;
  /** 減色した後の色の面（プレビュー用。減色しなければ null）。 */
  readonly reducedLayers: readonly Uint16Array[] | null;
  /** マスの数（16×16）。 */
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** マスごとのブロックの番号（BuiltBlock の番号。ブロックにしないマスは -1）。 */
  readonly cellBlocks: Int32Array;
  /** 作るブロック（まとめた後）。 */
  readonly built: readonly BuiltBlock[];
  /** ブロックごとの置く番号（タイルセットの中の番号。置けなければ -1）。 */
  readonly locals: Int32Array;
  /** 置き場所を探した表（#446 の画面が置ける・置けないを判定するのに使う）。 */
  readonly table: { readonly base: number; readonly capacity: number; readonly blocks: Uint16Array; readonly attributes: Uint32Array; readonly secondary: boolean };
  /** 書き込む中身（ok のときだけ）。 */
  readonly result: ImportResult | null;
  /** マスごとの通し番号（スタンプ用。ブロックにしないマスは -1）。 */
  readonly stampCells: Int32Array;
  /** 最初に置いたブロックの通し番号。 */
  readonly firstBlock: number | null;
  /** 作るのにかかった時間（ミリ秒）。 */
  readonly ms: number;
}

/** 新しいタイルセットの最初の中身（主は 0 番のタイルとブロックを空けて持つ）。 */
function emptyTable(secondary: boolean): ImportTable {
  return {
    tiles: new Uint8Array(secondary ? 0 : TILES_PER_ROW * TILE_BYTES),
    palettes: new Uint16Array(256),
    blocks: new Uint16Array(secondary ? 0 : BLOCK_TILE_COUNT),
    attributes: new Uint32Array(secondary ? 0 : 1),
  };
}

function tileIsZero(tiles: Uint8Array, local: number): boolean {
  const start = local * TILE_BYTES;
  if (start + TILE_BYTES > tiles.length) return true;
  for (let i = 0; i < TILE_BYTES; i++) if (tiles[start + i] !== 0) return false;
  return true;
}

/** 計画を作る。 */
export function planImport(input: ImportInput): ImportPlan {
  const t0 = now();
  const o = input.options ?? {};
  const { layers, target } = input;
  const secondary = target.secondary;
  const problems: ImportProblem[] = [];
  const error = (code: ImportProblemCode, params: Record<string, number | string> = {}): void => void problems.push({ level: "error", code, params });
  const note = (code: ImportProblemCode, params: Record<string, number | string> = {}): void => void problems.push({ level: "note", code, params });

  const own = target.isNew ? emptyTable(secondary) : secondary ? input.secondary : input.primary;
  const primary = secondary ? input.primary : own;
  const second = secondary ? own : input.secondary;
  const used = target.isNew ? () => 0 : (input.blockUsed ?? (() => 0));
  const others = target.isNew || secondary ? [] : (input.otherSecondaryBlocks ?? []);
  const tileBase = secondary ? PRIMARY_TILE_COUNT : 0;
  const blockBase = secondary ? PRIMARY_BLOCK_COUNT : 0;
  const tileCapacity = secondary ? TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT : PRIMARY_TILE_COUNT;
  const blockCapacity = secondary ? TOTAL_BLOCK_COUNT - PRIMARY_BLOCK_COUNT : PRIMARY_BLOCK_COUNT;
  const paletteRange = secondary ? [PRIMARY_PALETTE_COUNT, TOTAL_PALETTE_COUNT] : [0, PRIMARY_PALETTE_COUNT];

  if (layers.padded) note("padded", { width: layers.sourceWidth, height: layers.sourceHeight, toWidth: layers.width, toHeight: layers.height });

  // ---- どのブロックからも指されているタイルと本（書く先の表と、組になる表） ----
  const referencing: Uint16Array[] = [primary.blocks, second.blocks, ...others];
  const usedTiles = new Uint8Array(TOTAL_TILE_COUNT);
  const usedPalettes = new Uint8Array(16);
  for (const blocks of referencing) {
    const onlyPrimary = blocks !== primary.blocks && blocks !== second.blocks;
    for (const v of blocks) {
      const tile = v & 0x3ff;
      if (!onlyPrimary || tile < PRIMARY_TILE_COUNT) usedTiles[tile] = 1;
      const pal = (v >> 12) & 0xf;
      if (!onlyPrimary || pal < PRIMARY_PALETTE_COUNT) usedPalettes[pal] = 1;
    }
  }

  // ---- 下地ブロック ----
  const mode = layers.layers.length === 1 ? (o.mode ?? "picture") : "picture";
  let base: BaseBlock | null = null;
  if (layers.layers.length === 1 && mode !== "picture" && o.baseBlock !== null && o.baseBlock !== undefined) {
    const b = o.baseBlock;
    const table = b < PRIMARY_BLOCK_COUNT ? primary : second;
    const local = b < PRIMARY_BLOCK_COUNT ? b : b - PRIMARY_BLOCK_COUNT;
    if (local >= table.attributes.length) error("baseMissing", { block: b });
    else {
      const tiles = [...table.blocks.subarray(local * BLOCK_TILE_COUNT, local * BLOCK_TILE_COUNT + BLOCK_TILE_COUNT)];
      const lower = tiles.slice(0, 4);
      if (!secondary && (b >= PRIMARY_BLOCK_COUNT || lower.some((v) => (v & 0x3ff) >= PRIMARY_TILE_COUNT || (v >> 12) >= PRIMARY_PALETTE_COUNT))) error("baseSecondary", { block: b });
      const upperDrawn = tiles.slice(4).some((v) => {
        const tile = v & 0x3ff;
        return tile < PRIMARY_TILE_COUNT ? !tileIsZero(primary.tiles, tile) : !tileIsZero(second.tiles, tile - PRIMARY_TILE_COUNT);
      });
      if (upperDrawn) note("baseUpper", { block: b });
      base = { tiles: lower, attribute: table.attributes[local] ?? 0 };
    }
  }

  // ---- パレット ----
  const excluded = new Set(o.excludedPalettes ?? []);
  const slots: PaletteSlotInput[] = [];
  const colorsOf = (table: ImportTable, p: number): number[] => Array.from({ length: 16 }, (_, i) => Number(table.palettes[p * 16 + i] ?? 0) & 0x7fff);
  if (secondary) for (let p = 0; p < PRIMARY_PALETTE_COUNT; p++) slots.push({ index: p, colors: colorsOf(primary, p), free: false });
  for (let p = paletteRange[0]!; p < paletteRange[1]!; p++) {
    if (excluded.has(p)) continue;
    slots.push({ index: p, colors: colorsOf(own, p), free: target.isNew || !usedPalettes[p] });
  }
  const zeroColor = target.isNew ? (layers.transparentColor ?? 0) : undefined;
  const assignOptions = zeroColor === undefined ? {} : { zeroColor };
  const tilesX = layers.width / 8;
  const tilesPerLayer = tilesX * (layers.height / 8);
  let tiles = layers.layers.flatMap((l) => splitTiles(l, layers.width, layers.height));
  let assignment: PaletteAssignment = assignPalettes(tiles, slots, assignOptions);
  let reduction: ImportPlan["reduction"] = null;
  let reducedLayers: Uint16Array[] | null = null;
  const paletteShortage = !assignment.ok;
  if (!assignment.ok && o.reduce) {
    const r = reduceToFit(tiles, slots, assignOptions);
    tiles = r.tiles;
    assignment = r.assignment;
    reduction = { changedPixels: r.changedPixels, colorsBefore: r.colorsBefore, colorsAfter: r.colorsAfter };
    reducedLayers = layers.layers.map((_, li) => joinTiles(tiles.slice(li * tilesPerLayer, (li + 1) * tilesPerLayer), layers.width, layers.height));
    if (assignment.ok) note("reduced", { changed: r.changedPixels, before: r.colorsBefore, after: r.colorsAfter });
  }
  const freePalettes = slots.filter((s) => s.free).length;
  const paletteMeter = {
    needed: assignment.needed,
    free: freePalettes,
    capacity: paletteRange[1]! - paletteRange[0]!,
    fixedUsed: assignment.fixedUsed,
    opened: assignment.opened,
    overColorTiles: assignment.overColorTiles,
    groups: assignment.groups,
    colorCount: assignment.colorCount,
    tileCounts: countByPalette(assignment.tilePalettes),
    usedSlots: [...Array(16).keys()].filter((p) => p >= paletteRange[0]! && p < paletteRange[1]! && !target.isNew && usedPalettes[p]),
  };
  const cellsWide = layers.width / 16;
  const cellsHigh = layers.height / 16;
  const cellCount = cellsWide * cellsHigh;
  const emptyTable0 = { base: blockBase, capacity: blockCapacity, blocks: own.blocks, attributes: own.attributes, secondary };
  if (!assignment.ok) {
    if (assignment.overColorTiles > 0) error("overColorTiles", { count: assignment.overColorTiles });
    if (assignment.needed > freePalettes) error("palettesShort", { needed: assignment.needed, free: freePalettes, short: assignment.needed - freePalettes, atLeast: assignment.neededAtLeast ? 1 : 0 });
    return {
      ok: false,
      problems,
      paletteShortage,
      tiles: { needed: 0, free: 0, capacity: tileCapacity, created: 0, reused: 0, merged: 0, flipped: 0, before: own.tiles.length / TILE_BYTES, after: own.tiles.length / TILE_BYTES },
      blocks: { needed: 0, free: 0, capacity: blockCapacity, skipped: 0, merged: 0, replaced: 0, before: own.attributes.length, after: own.attributes.length, unplaced: 0 },
      palettes: paletteMeter,
      reduction,
      reducedLayers,
      cellsWide,
      cellsHigh,
      cellBlocks: new Int32Array(cellCount).fill(-1),
      built: [],
      locals: new Int32Array(0),
      table: emptyTable0,
      result: null,
      stampCells: new Int32Array(cellCount).fill(-1),
      firstBlock: null,
      ms: elapsed(t0),
    };
  }

  // ---- 色番号と重複の除去 ----
  const existing: ExistingTiles[] = [];
  if (secondary) existing.push({ base: 0, tiles: primary.tiles });
  existing.push({ base: tileBase, tiles: own.tiles });
  const dedupe = new TileDeduper(existing, { useFlip: o.useFlip ?? true, reuseExisting: o.reuseExisting ?? true });
  const palettes = new Map<number, ArrayLike<number>>();
  for (const s of slots) palettes.set(s.index, s.colors);
  for (const [p, colors] of assignment.palettes) palettes.set(p, colors);
  const blankIndices = new Uint8Array(64);
  const matches = tiles.map((t, i) => {
    const p = assignment.tilePalettes[i]!;
    const indices = p < 0 ? blankIndices : indexTile(t, palettes.get(p)!);
    return { match: dedupe.add(indices), palette: Math.max(0, p) };
  });
  const blankMatch = dedupe.add(blankIndices);

  // ---- 新しいタイルの置き場所 ----
  const reserveDoor = secondary && (o.reserveDoorTiles ?? true);
  const ownTileCount = own.tiles.length / TILE_BYTES;
  const freeTiles: number[] = [];
  for (let l = 0; l < tileCapacity; l++) {
    if (!secondary && l === 0) continue;
    if (reserveDoor && l >= DOOR_TILE_START) continue;
    if (l < ownTileCount && (!tileIsZero(own.tiles, l) || usedTiles[tileBase + l] || dedupe.usedExisting.has(tileBase + l))) continue;
    freeTiles.push(l);
  }
  const created = dedupe.createdTiles.length;
  if (reserveDoor) note("doorTiles", { from: PRIMARY_TILE_COUNT + DOOR_TILE_START, to: TOTAL_TILE_COUNT - 1 });
  const stats = dedupe.stats;
  const tileLocal = (m: { existing: number | null; created: number | null }): number => (m.existing !== null ? m.existing : tileBase + (freeTiles[m.created!] ?? 0));
  if (created > freeTiles.length) error("tilesShort", { needed: created, free: freeTiles.length, short: created - freeTiles.length });

  // ---- ブロック ----
  const refOf = (i: number): number => {
    const m = matches[i]!;
    const ref = packTileRef({ tile: tileLocal(m.match), hflip: m.match.hflip, vflip: m.match.vflip, palette: isTransparentTile(tiles[i]!) ? 0 : m.palette });
    // 置き場所の無い新しいタイルは、ブロックの数え方が変わらないよう、ほかと重ならない値にする（書き込まない）
    return m.match.created !== null && m.match.created >= freeTiles.length ? ref + (m.match.created + 1) * 0x10000 : ref;
  };
  const blank = packTileRef({ tile: tileLocal(blankMatch), hflip: blankMatch.hflip, vflip: blankMatch.vflip, palette: 0 });
  const refs: number[][][] = layers.layers.map(() => []);
  const empty: boolean[] = [];
  for (let cy = 0; cy < cellsHigh; cy++) {
    for (let cx = 0; cx < cellsWide; cx++) {
      let allEmpty = true;
      layers.layers.forEach((_, li) => {
        const at = (x: number, y: number): number => li * tilesPerLayer + (cy * 2 + y) * tilesX + cx * 2 + x;
        const four = [at(0, 0), at(1, 0), at(0, 1), at(1, 1)];
        if (four.some((i) => !isTransparentTile(tiles[i]!))) allEmpty = false;
        refs[li]!.push(four.map(refOf));
      });
      empty.push(allEmpty);
    }
  }
  const built = buildBlocks(refs, empty, blank, { skipEmpty: o.skipEmpty ?? true, mergeSame: o.mergeSame ?? true, mode, upperBehind: o.upperBehind ?? false, base });
  if (built.blocks.length === 0) error("noBlocks");
  const placementTable = { blocks: own.blocks, attributes: own.attributes, capacity: blockCapacity, base: blockBase, used };
  const placement = placeBlocks(placementTable, built.blocks, o.placement, o.allowReplace ?? false);
  for (const inv of placement.invalid) error("placementInvalid", { block: inv.block, local: inv.local, problem: inv.problem satisfies PlacementProblem });
  const neededBlocks = built.blocks.reduce((n, b) => n + (b.third ? 2 : 1), 0);
  if (placement.unplaced > 0) error("blocksShort", { needed: neededBlocks, free: placement.free, short: placement.unplaced });
  if (placement.replaced > 0) note("replaced", { count: placement.replaced });

  const ok = !problems.some((p) => p.level === "error");
  let maxTile = -1;
  for (let k = 0; k < created; k++) maxTile = Math.max(maxTile, freeTiles[k] ?? -1);
  const tilesAfter = Math.max(ownTileCount, maxTile < 0 ? 0 : Math.ceil((maxTile + 1) / TILES_PER_ROW) * TILES_PER_ROW, target.isNew ? TILES_PER_ROW : 0);
  let maxBlock = -1;
  built.blocks.forEach((b, i) => {
    const l = placement.locals[i]!;
    if (l >= 0) maxBlock = Math.max(maxBlock, l + (b.third ? 1 : 0));
  });
  const blocksAfter = Math.max(own.attributes.length, maxBlock + 1, 1);

  let result: ImportResult | null = null;
  const stampCells = new Int32Array(cellCount).fill(-1);
  let firstBlock: number | null = null;
  if (ok) {
    const outTiles = new Uint8Array(Math.min(tileCapacity, tilesAfter) * TILE_BYTES);
    outTiles.set(own.tiles.subarray(0, Math.min(own.tiles.length, outTiles.length)));
    let lo = Infinity;
    let hi = -1;
    dedupe.createdTiles.forEach((bytes, k) => {
      const l = freeTiles[k]!;
      outTiles.set(bytes, l * TILE_BYTES);
      lo = Math.min(lo, l);
      hi = Math.max(hi, l + 1);
    });
    const outPalettes = Uint16Array.from({ length: 256 }, (_, i) => Number(own.palettes[i] ?? 0) & 0xffff);
    const changedPalettes: number[] = [];
    for (const [p, colors] of assignment.palettes) {
      const before = outPalettes.slice(p * 16, p * 16 + 16);
      outPalettes.set(colors, p * 16);
      if (target.isNew || before.some((c, i) => c !== colors[i])) changedPalettes.push(p);
    }
    const outBlocks = new Uint16Array(blocksAfter * BLOCK_TILE_COUNT);
    outBlocks.set(own.blocks.subarray(0, Math.min(own.blocks.length, outBlocks.length)));
    const outAttributes = new Uint32Array(blocksAfter);
    outAttributes.set(own.attributes.subarray(0, Math.min(own.attributes.length, blocksAfter)));
    const placed: number[] = [];
    built.blocks.forEach((b, i) => {
      const l = placement.locals[i]!;
      outBlocks.set(b.tiles, l * BLOCK_TILE_COUNT);
      outAttributes[l] = b.attribute >>> 0;
      if (b.third) {
        outBlocks.set([...b.third, 0, 0, 0, 0], (l + 1) * BLOCK_TILE_COUNT);
        outAttributes[l + 1] = 0;
      }
      placed.push(l);
      for (const c of b.cells) stampCells[c] = blockBase + l;
    });
    firstBlock = placed.length > 0 ? blockBase + Math.min(...placed) : null;
    result = {
      tiles: outTiles,
      palettes: outPalettes,
      blocks: outBlocks,
      attributes: outAttributes,
      tileRange: hi < 0 ? null : [lo, hi],
      changedPalettes: changedPalettes.sort((a, b) => a - b),
      placedBlocks: placed,
    };
  }

  return {
    ok,
    problems,
    paletteShortage,
    tiles: { needed: created, free: freeTiles.length, capacity: tileCapacity, created, reused: stats.reused, merged: stats.merged, flipped: stats.flipped, before: ownTileCount, after: tilesAfter },
    blocks: {
      needed: neededBlocks,
      free: placement.free,
      capacity: blockCapacity,
      skipped: built.skipped,
      merged: built.merged,
      replaced: placement.replaced,
      before: own.attributes.length,
      after: blocksAfter,
      unplaced: placement.unplaced,
    },
    palettes: paletteMeter,
    reduction,
    reducedLayers,
    cellsWide,
    cellsHigh,
    cellBlocks: built.cellBlocks,
    built: built.blocks,
    locals: placement.locals,
    table: emptyTable0,
    result,
    stampCells,
    firstBlock,
    ms: elapsed(t0),
  };
}

function elapsed(t0: number): number {
  return Math.round((now() - t0) * 10) / 10;
}

/** 今の時刻（ミリ秒。core は DOM の型を持たないので globalThis から引く）。 */
function now(): number {
  return (globalThis as { performance?: { now(): number } }).performance?.now() ?? Date.now();
}

/** 本ごとのタイルの数（本の番号 → 数。透明だけのタイルと決まらなかったタイルは数えない）。 */
function countByPalette(tilePalettes: Int16Array): Record<number, number> {
  const out: Record<number, number> = {};
  for (const p of tilePalettes) if (p >= 0) out[p] = (out[p] ?? 0) + 1;
  return out;
}

/** タイル（左上から行ごと）を色の面に戻す。 */
function joinTiles(tiles: readonly Uint16Array[], width: number, height: number): Uint16Array {
  const out = new Uint16Array(width * height).fill(TRANSPARENT);
  const tx = width / 8;
  tiles.forEach((t, i) => {
    const x0 = (i % tx) * 8;
    const y0 = Math.floor(i / tx) * 8;
    for (let y = 0; y < 8; y++) out.set(t.subarray(y * 8, y * 8 + 8), (y0 + y) * width + x0);
  });
  return out;
}
