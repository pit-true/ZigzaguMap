import { BLOCK_TILE_COUNT } from "../../../tileset/blockFormat.js";
import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { isTripleLayer } from "../../../tileset/tripleLayer.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, type Args } from "../../jsonArgs.js";
import { TilesetCommand, argTileset, type TilesetArgs, type TilesetPart } from "../base/TilesetCommand.js";

/** 「ブロック数を変える」の引数。 */
export type SetBlockCountArgs = TilesetArgs & {
  /** ブロック数（1〜上限。主 640、副 384）。 */
  count: number;
};

/**
 * 「ブロック数を変える」コマンド（ブロックエディタの「ブロック量の追加/変更」）。
 * 増やした分は全部 0、減らした分は末尾から消える。AdvanceMap は上限を超える値を上限に丸めるが、丸めは画面側で行う。
 * 減らして 3 層のブロックが最後になるときは、3 枚目が表の外になるので受け付けない（tripleLayerNoNext）。
 */
export class SetBlockCountCommand extends TilesetCommand<SetBlockCountArgs> {
  static readonly NAME = "setBlockCount";
  readonly name = SetBlockCountCommand.NAME;
  protected readonly parts: readonly TilesetPart[] = ["blocks", "attributes"];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetBlockCountCommand {
    return new SetBlockCountCommand({ ...argTileset(args), count: argInt(args, "count") });
  }

  protected edit(tileset: TilesetDocument): void {
    const count = checkRange("count", this.args.count, 1, tileset.blockCapacity);
    if (count < tileset.blockCount && isTripleLayer(tileset.attributes[count - 1] ?? 0)) {
      throw new EditError(EditErrorCode.TripleLayerNoNext, { index: count - 1, count });
    }
    const blocks = new Uint16Array(count * BLOCK_TILE_COUNT);
    blocks.set(tileset.blocks.subarray(0, Math.min(tileset.blocks.length, blocks.length)));
    const attributes = new Uint32Array(count);
    attributes.set(tileset.attributes.subarray(0, Math.min(tileset.attributes.length, count)));
    tileset.blocks = blocks;
    tileset.attributes = attributes;
  }
}
