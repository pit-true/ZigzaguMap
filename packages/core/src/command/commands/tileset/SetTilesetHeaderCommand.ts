import { TILESET_HEADER_SIZE } from "../../../map/constants.js";
import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { parseHexBytes } from "../../EditError.js";
import { argString, type Args } from "../../jsonArgs.js";
import { TilesetCommand, argTileset, type TilesetArgs, type TilesetPart } from "../base/TilesetCommand.js";

/** ヘッダーのうちポインタの部分（画像・パレット・ブロック・属性）。 */
const POINTER_FIELDS = [0x04, 0x08, 0x0c, 0x14] as const;

/** 「タイルセットのヘッダーを生のバイトで変える」の引数。 */
export type SetTilesetHeaderArgs = TilesetArgs & {
  /** 24 バイトの 16 進（高度なヘッダーの「タイルセット1 / 2」欄）。 */
  header: string;
};

/**
 * 「タイルセットのヘッダーを生のバイトで変える」コマンド（高度なヘッダーの「タイルセットデータ」）。
 * 圧縮フラグ（0x00）、副フラグ（0x01）、0x02〜0x03、アニメーション関数（0x10）を使う。
 * 画像・パレット・ブロック・属性のポインタは maps\ ではビルド時に作り直すので読み捨てる。
 */
export class SetTilesetHeaderCommand extends TilesetCommand<SetTilesetHeaderArgs> {
  static readonly NAME = "setTilesetHeader";
  readonly name = SetTilesetHeaderCommand.NAME;
  protected readonly parts: readonly TilesetPart[] = ["header"];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetTilesetHeaderCommand {
    return new SetTilesetHeaderCommand({ ...argTileset(args), header: argString(args, "header") });
  }

  protected edit(tileset: TilesetDocument): void {
    const header = parseHexBytes("header", this.args.header, TILESET_HEADER_SIZE);
    for (const field of POINTER_FIELDS) header.fill(0, field, field + 4);
    tileset.header = header;
    tileset.compressed = header[0] !== 0;
  }
}
