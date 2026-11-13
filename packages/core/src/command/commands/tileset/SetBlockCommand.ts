import { BLOCK_TILE_COUNT } from "../../../tileset/blockFormat.js";
import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, argIntArray, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { TilesetCommand, argTileset, type TilesetArgs, type TilesetPart } from "../base/TilesetCommand.js";

/** 「ブロックを変える」の引数。省略した部分は変えない。 */
export type SetBlockArgs = TilesetArgs & {
  /** タイルセットの中のブロック番号（副タイルセットも 0 から）。 */
  block: number;
  /** タイル指定 8 個（下層の左上・右上・左下・右下、上層の同じ順。各 u16 = タイル番号・反転・パレット。packTileRef で作る）。 */
  tiles?: number[];
  /** 属性（u32。AdvanceMap の 4 欄は attributeFromBytes で作る）。 */
  attribute?: number;
};

/** ブロック番号を確かめる。 */
export function checkBlockIndex(tileset: TilesetDocument, block: number): number {
  if (!Number.isInteger(block) || block < 0 || block >= tileset.blockCount) {
    throw new EditError(EditErrorCode.BlockIndexOutOfRange, { index: block, count: tileset.blockCount });
  }
  return block;
}

/** 「ブロックを変える」コマンド（ブロックエディタの「変更を保存」。8 タイルと属性 4 バイト）。 */
export class SetBlockCommand extends TilesetCommand<SetBlockArgs> {
  static readonly NAME = "setBlock";
  readonly name = SetBlockCommand.NAME;
  protected readonly parts: readonly TilesetPart[] = ["blocks", "attributes"];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetBlockCommand {
    return new SetBlockCommand(
      compactArgs({
        ...argTileset(args),
        block: argInt(args, "block"),
        tiles: args["tiles"] === undefined ? undefined : argIntArray(args, "tiles"),
        attribute: argOptInt(args, "attribute"),
      }) as SetBlockArgs,
    );
  }

  protected edit(tileset: TilesetDocument): void {
    const { tiles, attribute } = this.args;
    const block = checkBlockIndex(tileset, this.args.block);
    if (tiles !== undefined) {
      if (tiles.length !== BLOCK_TILE_COUNT) throw new EditError(EditErrorCode.InvalidRawBytes, { field: "tiles", expected: BLOCK_TILE_COUNT * 2 });
      tiles.forEach((v) => checkRange("tiles", v, 0, 0xffff));
    }
    if (attribute !== undefined) checkRange("attribute", attribute, 0, 0xffffffff);
    if (tiles !== undefined) tileset.blocks.set(tiles, block * BLOCK_TILE_COUNT);
    if (attribute !== undefined) tileset.attributes[block] = attribute;
  }
}
