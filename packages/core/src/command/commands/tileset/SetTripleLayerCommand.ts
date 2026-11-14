import { BLOCK_TILE_COUNT } from "../../../tileset/blockFormat.js";
import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { isTripleLayer, thirdLayerLocal } from "../../../tileset/tripleLayer.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, argIntArray, compactArgs, type Args } from "../../jsonArgs.js";
import { TilesetCommand, argTileset, type TilesetArgs, type TilesetPart } from "../base/TilesetCommand.js";
import { checkBlockIndex } from "./SetBlockCommand.js";

/** 3 枚目のタイル指定の数（次のブロックの下層 4 個）。 */
export const THIRD_LAYER_TILE_COUNT = 4;

/** 「ブロックを 3 層にする・やめる」の引数。 */
export type SetTripleLayerArgs = TilesetArgs & {
  /** タイルセットの中のブロック番号 N（副タイルセットも 0 から）。 */
  block: number;
  /** N のタイル指定 8 個（省略で変えない）。 */
  tiles?: number[];
  /** N の属性（u32）。ビット 28〜30 が 3 なら 3 層にする。 */
  attribute: number;
  /** 3 枚目のタイル指定 4 個（N+1 の下層。省略で変えない）。3 層にしないときは使わない。 */
  third?: number[];
};

/**
 * 「ブロックを 3 層にする・やめる」コマンド（ブロックエディタの「変更を保存」で、3 層が絡むとき）。
 *
 * - 3 層にするとき: N の 8 タイルと属性、N+1 の下層 4 タイル（3 枚目）を書き、N+1 の属性を 0、上層 4 タイルを 0 にする
 *   （Bochi と同じ片付け。#319 の Q2 の推奨）。N+1 は単独では置けなくなるので、失う物は無い。
 * - N が表の最後のブロック（主の 639 番、副の最後の番号）なら 3 層にできない（#319 の Q1 の推奨）。
 * - 3 層にしないとき: N だけを書く（N+1 には触れない）。
 * N と N+1 の変更は 1 回のコマンド（1 回の Ctrl+Z で両方戻る）。
 */
export class SetTripleLayerCommand extends TilesetCommand<SetTripleLayerArgs> {
  static readonly NAME = "setTripleLayer";
  readonly name = SetTripleLayerCommand.NAME;
  protected readonly parts: readonly TilesetPart[] = ["blocks", "attributes"];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetTripleLayerCommand {
    return new SetTripleLayerCommand(
      compactArgs({
        ...argTileset(args),
        block: argInt(args, "block"),
        tiles: args["tiles"] === undefined ? undefined : argIntArray(args, "tiles"),
        attribute: argInt(args, "attribute"),
        third: args["third"] === undefined ? undefined : argIntArray(args, "third"),
      }) as SetTripleLayerArgs,
    );
  }

  protected edit(tileset: TilesetDocument): void {
    const { tiles, attribute, third } = this.args;
    const block = checkBlockIndex(tileset, this.args.block);
    checkRange("attribute", attribute, 0, 0xffffffff);
    checkTiles("tiles", tiles, BLOCK_TILE_COUNT);
    const triple = isTripleLayer(attribute);
    const next = triple ? thirdLayerLocal(tileset, block) : null;
    if (triple) {
      if (next === null || next >= tileset.blockCount) throw new EditError(EditErrorCode.TripleLayerNoNext, { index: block, count: tileset.blockCount });
      checkTiles("third", third, THIRD_LAYER_TILE_COUNT);
    }
    if (tiles !== undefined) tileset.blocks.set(tiles, block * BLOCK_TILE_COUNT);
    tileset.attributes[block] = attribute >>> 0;
    if (next === null) return;
    const base = next * BLOCK_TILE_COUNT;
    if (third !== undefined) tileset.blocks.set(third, base);
    tileset.blocks.fill(0, base + THIRD_LAYER_TILE_COUNT, base + BLOCK_TILE_COUNT);
    tileset.attributes[next] = 0;
  }
}

function checkTiles(field: string, values: readonly number[] | undefined, count: number): void {
  if (values === undefined) return;
  if (values.length !== count) throw new EditError(EditErrorCode.InvalidRawBytes, { field, expected: count * 2 });
  values.forEach((v) => checkRange(field, v, 0, 0xffff));
}
