import { decodeBase64, encodeBase64 } from "../../../binary/base64.js";
import { TILESET_HEADER_SIZE, TILE_BYTES } from "../../../map/constants.js";
import { BLOCK_TILE_COUNT } from "../../../tileset/blockFormat.js";
import { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { TILES_PER_ROW } from "../../../tileset/TileImage.js";
import type { Command, EditorContext, JsonObject } from "../../Command.js";
import { documentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argBool, argInt, argIntArray, argString, type Args } from "../../jsonArgs.js";

/** 「新しいタイルセットを加える」の引数（中身はすべて JSON に書ける形）。 */
export type AddTilesetArgs = JsonObject & {
  /** ヘッダーの位置（maps\tilesets のフォルダ名。DocumentContext.newTilesetAddress）。 */
  headerAddress: number;
  secondary: boolean;
  compressed: boolean;
  /** ヘッダー 24 バイト（base64。ポインタの部分は無視する）。 */
  header: string;
  /** 4bpp タイル（base64。16 タイルの倍数）。 */
  tiles: string;
  /** パレット（BGR555 × 256）。 */
  palettes: number[];
  /** ブロック定義（u16 リトルエンディアンの base64）。 */
  blocks: string;
  /** 属性（u32 リトルエンディアンの base64）。 */
  attributes: string;
};

/** 中身から引数を作る。 */
export function addTilesetArgs(
  headerAddress: number,
  t: { secondary: boolean; compressed: boolean; header: Uint8Array; tiles: Uint8Array; palettes: Uint16Array; blocks: Uint16Array; attributes: Uint32Array },
): AddTilesetArgs {
  return {
    headerAddress,
    secondary: t.secondary,
    compressed: t.compressed,
    header: encodeBase64(t.header),
    tiles: encodeBase64(t.tiles),
    palettes: [...t.palettes],
    blocks: encodeBase64(new Uint8Array(t.blocks.buffer, t.blocks.byteOffset, t.blocks.byteLength).slice()),
    attributes: encodeBase64(new Uint8Array(t.attributes.buffer, t.attributes.byteOffset, t.attributes.byteLength).slice()),
  };
}

/**
 * 「新しいタイルセットを加える」コマンド（別の ROM からの移植。#309・#314）。取り消すと加えたタイルセットも消える
 * （書き出し済みなら次の出力でファイルを消す）。マップの組の付け替えは setLayout か setTilesets で行う。
 */
export class AddTilesetCommand implements Command<AddTilesetArgs> {
  static readonly NAME = "addTileset";
  readonly name = AddTilesetCommand.NAME;

  constructor(readonly args: AddTilesetArgs) {}

  /** JSON の引数から作る。 */
  static fromJson(args: Args): AddTilesetCommand {
    return new AddTilesetCommand({
      headerAddress: argInt(args, "headerAddress"),
      secondary: argBool(args, "secondary"),
      compressed: argBool(args, "compressed"),
      header: argString(args, "header"),
      tiles: argString(args, "tiles"),
      palettes: argIntArray(args, "palettes"),
      blocks: argString(args, "blocks"),
      attributes: argString(args, "attributes"),
    });
  }

  /** 加えるタイルセットの指し方。 */
  get ref(): { pointer: number; secondary: boolean } {
    return { pointer: (0x08000000 + this.args.headerAddress) >>> 0, secondary: this.args.secondary };
  }

  do(context: EditorContext): void {
    const a = this.args;
    checkRange("headerAddress", a.headerAddress, 0, 0x1ffffe8);
    const header = decodeBase64(a.header);
    if (header.length !== TILESET_HEADER_SIZE) throw new EditError(EditErrorCode.InvalidRawBytes, { field: "header", expected: TILESET_HEADER_SIZE });
    const tiles = decodeBase64(a.tiles);
    if (tiles.length === 0 || tiles.length % (TILES_PER_ROW * TILE_BYTES) !== 0) throw new EditError(EditErrorCode.InvalidRawBytes, { field: "tiles", expected: TILES_PER_ROW * TILE_BYTES });
    if (a.palettes.length !== 256) throw new EditError(EditErrorCode.InvalidRawBytes, { field: "palettes", expected: 512 });
    a.palettes.forEach((c) => checkRange("palettes", c, 0, 0x7fff));
    const blockBytes = decodeBase64(a.blocks);
    const attrBytes = decodeBase64(a.attributes);
    const count = attrBytes.length / 4;
    if (!Number.isInteger(count) || count < 1 || blockBytes.length !== count * BLOCK_TILE_COUNT * 2) {
      throw new EditError(EditErrorCode.InvalidRawBytes, { field: "blocks", expected: count * BLOCK_TILE_COUNT * 2 });
    }
    const blocks = new Uint16Array(count * BLOCK_TILE_COUNT);
    for (let i = 0; i < blocks.length; i++) blocks[i] = blockBytes[i * 2]! | (blockBytes[i * 2 + 1]! << 8);
    const attributes = new Uint32Array(count);
    for (let i = 0; i < count; i++) attributes[i] = (attrBytes[i * 4]! | (attrBytes[i * 4 + 1]! << 8) | (attrBytes[i * 4 + 2]! << 16) | (attrBytes[i * 4 + 3]! << 24)) >>> 0;
    const doc = TilesetDocument.createNew({
      secondary: a.secondary,
      headerAddress: a.headerAddress,
      header,
      compressed: a.compressed,
      tiles,
      palettes: Uint16Array.from(a.palettes),
      blocks,
      attributes,
    });
    if (doc.blockCount > doc.blockCapacity) throw new EditError(EditErrorCode.ValueOutOfRange, { field: "blocks", value: doc.blockCount, min: 1, max: doc.blockCapacity });
    if (doc.tileCount > doc.tileCapacity) throw new EditError(EditErrorCode.ValueOutOfRange, { field: "tiles", value: doc.tileCount, min: 1, max: doc.tileCapacity });
    documentContext(context).addTileset(doc);
  }

  undo(context: EditorContext): void {
    documentContext(context).removeTileset(this.ref);
  }
}
