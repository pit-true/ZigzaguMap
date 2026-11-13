import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { checkRange } from "../../EditError.js";
import { argIntArray, type Args } from "../../jsonArgs.js";
import { TilesetCommand, argTileset, type TilesetArgs, type TilesetPart } from "../base/TilesetCommand.js";

/** 「ブロックのパレット参照先を一括で変える」の引数。 */
export type RemapBlockPalettesArgs = TilesetArgs & {
  /** 元のパレット番号 → 新しいパレット番号（16 個。AdvanceMap の画面は 0〜14 の 15 行で、15 はそのまま）。 */
  mapping: number[];
};

/**
 * 「ブロックのパレット参照先を一括で変える」コマンド（パレット > ブロックのパレット参照先の一括変更）。
 * タイルセットの全ブロックのタイル指定のパレット番号（ビット 12〜15）を `mapping` で置き換える。
 */
export class RemapBlockPalettesCommand extends TilesetCommand<RemapBlockPalettesArgs> {
  static readonly NAME = "remapBlockPalettes";
  readonly name = RemapBlockPalettesCommand.NAME;
  protected readonly parts: readonly TilesetPart[] = ["blocks"];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): RemapBlockPalettesCommand {
    return new RemapBlockPalettesCommand({ ...argTileset(args), mapping: argIntArray(args, "mapping") });
  }

  protected edit(tileset: TilesetDocument): void {
    const mapping = this.args.mapping;
    checkRange("mapping.length", mapping.length, 15, 16);
    mapping.forEach((p) => checkRange("mapping", p, 0, 15));
    const table = [...mapping, ...(mapping.length === 15 ? [15] : [])];
    for (let i = 0; i < tileset.blocks.length; i++) {
      const v = tileset.blocks[i]!;
      tileset.blocks[i] = (v & 0x0fff) | (table[v >> 12]! << 12);
    }
  }
}
