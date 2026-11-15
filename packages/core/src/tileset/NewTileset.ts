/**
 * 新しい空のタイルセット（ブロックエディタの 画像 > 新しいタイルセット…。Phase5 #397、#407 の Q9）。DOM に依存しない計算だけを置く。
 *
 * 中身は別の ROM からの移植と同じ形（`addTilesetArgs` に渡すもの）にして、`addTileset` と `setTilesets` の 1 回の組で加える。
 * 出力は `"New": true` の `maps\tilesets\<主か副>_<ROM の外の位置>\`（ビルドの `_place_tilesets` が置く）。
 */
import type { Command } from "../command/Command.js";
import { CommandGroup } from "../command/CommandGroup.js";
import type { DocumentContext } from "../command/DocumentContext.js";
import { SetTilesetsCommand } from "../command/commands/layout/SetTilesetsCommand.js";
import { AddTilesetCommand, addTilesetArgs } from "../command/commands/tileset/AddTilesetCommand.js";
import { PRIMARY_BLOCK_COUNT, PRIMARY_TILE_COUNT, TILESET_HEADER_SIZE, TILE_BYTES, TOTAL_BLOCK_COUNT, TOTAL_TILE_COUNT } from "../map/constants.js";
import type { MapId } from "../map/types.js";
import { ROM_BASE } from "../rom/Rom.js";
import { BLOCK_TILE_COUNT } from "./blockFormat.js";
import { TILES_PER_ROW } from "./TileImage.js";

/** 写しの元（今のタイルセット）。 */
export interface NewTilesetSource {
  readonly header: Uint8Array;
  readonly compressed: boolean;
  readonly tiles: Uint8Array;
  readonly palettes: Uint16Array;
  readonly blocks: Uint16Array;
  readonly attributes: Uint32Array;
}

/** 新しいタイルセットの選び方。 */
export interface NewTilesetOptions {
  readonly secondary: boolean;
  /** タイル数（16 の倍数に切り上げる）。 */
  readonly tileCount: number;
  /** ブロック数。 */
  readonly blockCount: number;
  /** 今のタイルセットの写しにするなら元。空なら null（タイル・ブロック・属性・パレットはどれも 0）。 */
  readonly copyFrom: NewTilesetSource | null;
  /** 空のときの圧縮（写しなら元に合わせる）。 */
  readonly compressed: boolean;
}

/** 作ったタイルセットの中身（`addTilesetArgs` の第 2 引数）。 */
export interface NewTilesetContent {
  readonly secondary: boolean;
  readonly compressed: boolean;
  readonly header: Uint8Array;
  readonly tiles: Uint8Array;
  readonly palettes: Uint16Array;
  readonly blocks: Uint16Array;
  readonly attributes: Uint32Array;
}

/** タイル数・ブロック数の上限（主 640・640、副 384・384）。 */
export function newTilesetLimits(secondary: boolean): { tiles: number; blocks: number } {
  return secondary
    ? { tiles: TOTAL_TILE_COUNT - PRIMARY_TILE_COUNT, blocks: TOTAL_BLOCK_COUNT - PRIMARY_BLOCK_COUNT }
    : { tiles: PRIMARY_TILE_COUNT, blocks: PRIMARY_BLOCK_COUNT };
}

/**
 * 新しいタイルセットの中身を作る。数は 1 から上限までに収め、タイルは 16 の倍数に切り上げる（上限も 16 の倍数）。
 * 写しは、タイル・ブロック・属性を新しい数に合わせて切るか 0 で埋め、パレットとヘッダー（アニメの処理の位置も）をそのまま使う。
 */
export function newTilesetContent(o: NewTilesetOptions): NewTilesetContent {
  const limits = newTilesetLimits(o.secondary);
  const tileCount = Math.min(limits.tiles, Math.ceil(clamp(o.tileCount, 1, limits.tiles) / TILES_PER_ROW) * TILES_PER_ROW);
  const blockCount = clamp(o.blockCount, 1, limits.blocks);
  const tiles = new Uint8Array(tileCount * TILE_BYTES);
  const palettes = new Uint16Array(256);
  const blocks = new Uint16Array(blockCount * BLOCK_TILE_COUNT);
  const attributes = new Uint32Array(blockCount);
  const header = new Uint8Array(TILESET_HEADER_SIZE);
  const src = o.copyFrom;
  const compressed = src ? src.compressed : o.compressed;
  if (src) {
    tiles.set(src.tiles.subarray(0, Math.min(src.tiles.length, tiles.length)));
    palettes.set(src.palettes.subarray(0, 256));
    blocks.set(src.blocks.subarray(0, Math.min(src.blocks.length, blocks.length)));
    attributes.set(src.attributes.subarray(0, Math.min(src.attributes.length, attributes.length)));
    header.set(src.header.subarray(0, TILESET_HEADER_SIZE));
  }
  header[0] = compressed ? 1 : 0;
  header[1] = o.secondary ? 1 : 0;
  return { secondary: o.secondary, compressed, header, tiles, palettes, blocks, attributes };
}

/** 新しいタイルセットのコマンドの指定。 */
export interface NewTilesetPlan {
  /** 組を付け替えるマップ（読み込んでおくこと）。 */
  readonly target: MapId;
  readonly secondary: boolean;
  readonly tileCount: number;
  readonly blockCount: number;
  /** 今のマップのタイルセット（主か副の同じほう）の写しにするか（false なら空）。 */
  readonly copy: boolean;
}

/**
 * 新しいタイルセットを加えて、`target` の組を付け替える 1 回の操作（`addTileset` と `setTilesets` の組）。
 * 位置は移植と同じ ROM の外の位置（`newTilesetAddress`）。1 回の取り消しで両方戻る。
 */
export function newTilesetCommand(context: DocumentContext, plan: NewTilesetPlan): { command: Command; pointer: number; content: NewTilesetContent } {
  const doc = context.document(plan.target);
  const current = context.tileset({ pointer: (plan.secondary ? doc.secondaryTileset : doc.primaryTileset) >>> 0, secondary: plan.secondary });
  const content = newTilesetContent({
    secondary: plan.secondary,
    tileCount: plan.tileCount,
    blockCount: plan.blockCount,
    copyFrom: plan.copy ? current : null,
    compressed: current.compressed,
  });
  const at = context.newTilesetAddress(0);
  const pointer = (ROM_BASE + at) >>> 0;
  const map = { bank: plan.target.bank, map: plan.target.map };
  const command = CommandGroup.of([
    new AddTilesetCommand(addTilesetArgs(at, content)),
    new SetTilesetsCommand({ ...map, ...(plan.secondary ? { secondary: pointer } : { primary: pointer }) }),
  ]);
  return { command, pointer, content };
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(Number.isFinite(n) ? n : min)));
}
