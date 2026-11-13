import { decodeBase64 } from "../../../binary/base64.js";
import { TILE_BYTES } from "../../../map/constants.js";
import { TILES_PER_ROW } from "../../../tileset/TileImage.js";
import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, argString, type Args } from "../../jsonArgs.js";
import { TilesetCommand, argTileset, type TilesetArgs, type TilesetPart } from "../base/TilesetCommand.js";

/** 「タイル画像を書き換える」の引数。 */
export type SetTilesArgs = TilesetArgs & {
  /** 最初のタイル番号（タイルセットの中の番号）。 */
  start: number;
  /** 4bpp タイル（1 枚 32 バイト）の base64。PNG からは decodeTilesPng で作る。 */
  data: string;
};

/**
 * 「タイル画像を書き換える」コマンド（タイルセット画像の読み込み）。`start` から順に書く。
 * 今のタイル数を超える分は、上限（主 640、副 384）までタイル数を増やす（16 枚単位に切り上げ、空きは色 0）。
 */
export class SetTilesCommand extends TilesetCommand<SetTilesArgs> {
  static readonly NAME = "setTiles";
  readonly name = SetTilesCommand.NAME;
  protected readonly parts: readonly TilesetPart[] = ["tiles"];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetTilesCommand {
    return new SetTilesCommand({ ...argTileset(args), start: argInt(args, "start"), data: argString(args, "data") });
  }

  protected edit(tileset: TilesetDocument): void {
    let data: Uint8Array;
    try {
      data = decodeBase64(this.args.data);
    } catch {
      throw new EditError(EditErrorCode.InvalidImage, { reason: "base64" });
    }
    if (data.length === 0 || data.length % TILE_BYTES !== 0) throw new EditError(EditErrorCode.InvalidImage, { reason: "length" });
    const start = checkRange("start", this.args.start, 0, tileset.tileCapacity - 1);
    const end = start + data.length / TILE_BYTES;
    if (end > tileset.tileCapacity) throw new EditError(EditErrorCode.TileIndexOutOfRange, { index: end - 1, count: tileset.tileCapacity });
    if (end > tileset.tileCount) {
      const grown = new Uint8Array(Math.min(tileset.tileCapacity, Math.ceil(end / TILES_PER_ROW) * TILES_PER_ROW) * TILE_BYTES);
      grown.set(tileset.tiles);
      tileset.tiles = grown;
    }
    tileset.tiles.set(data, start * TILE_BYTES);
  }
}
