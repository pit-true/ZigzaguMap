import { BLOCK_TILE_COUNT } from "../../../tileset/blockFormat.js";
import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argIntArray, type Args } from "../../jsonArgs.js";
import { TilesetCommand, argTileset, type TilesetArgs, type TilesetPart } from "../base/TilesetCommand.js";

/** 「ブロック定義と属性をまとめて置き換える」の引数。 */
export type SetBlockDataArgs = TilesetArgs & {
  /** ブロック定義（1 ブロック 8 個の u16。長さはブロック数 × 8）。 */
  blocks: number[];
  /** 属性（u32。長さがブロック数になる）。 */
  attributes: number[];
};

/**
 * 「ブロック定義と属性をまとめて置き換える」コマンド（ブロックエディタの「ブロック > タイルセット１を開く」で .bvd を読む）。
 * ブロック数も `attributes` の長さに変わる（1〜上限。主 640、副 384）。
 */
export class SetBlockDataCommand extends TilesetCommand<SetBlockDataArgs> {
  static readonly NAME = "setBlockData";
  readonly name = SetBlockDataCommand.NAME;
  protected readonly parts: readonly TilesetPart[] = ["blocks", "attributes"];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetBlockDataCommand {
    return new SetBlockDataCommand({ ...argTileset(args), blocks: argIntArray(args, "blocks"), attributes: argIntArray(args, "attributes") });
  }

  protected edit(tileset: TilesetDocument): void {
    const { blocks, attributes } = this.args;
    const count = checkRange("attributes.length", attributes.length, 1, tileset.blockCapacity);
    if (blocks.length !== count * BLOCK_TILE_COUNT) {
      throw new EditError(EditErrorCode.InvalidRawBytes, { field: "blocks", expected: count * BLOCK_TILE_COUNT * 2 });
    }
    blocks.forEach((v) => checkRange("blocks", v, 0, 0xffff));
    attributes.forEach((v) => checkRange("attributes", v, 0, 0xffffffff));
    tileset.blocks = Uint16Array.from(blocks);
    tileset.attributes = Uint32Array.from(attributes);
  }
}
