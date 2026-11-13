import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { checkRange } from "../../EditError.js";
import { argInt, argIntArray, argOptInt, type Args } from "../../jsonArgs.js";
import { TilesetCommand, argTileset, type TilesetArgs, type TilesetPart } from "../base/TilesetCommand.js";

/** 「パレットの色を変える」の引数。 */
export type SetPaletteColorsArgs = TilesetArgs & {
  /** パレットの番号（0〜15。主タイルセットは 0〜6、副は 7〜12 を使う。AdvanceMap の Palette0〜12）。 */
  palette: number;
  /** 最初の色の番号（0〜15。省略時 0）。 */
  start?: number;
  /** 色（BGR555、0〜0x7FFF）。`start` から順に書く。 */
  colors: number[];
};

/**
 * 「パレットの色を変える」コマンド（パレットエディタの色の変更と「パレットの変更をROMに上書きする」、
 * パレットファイルを開く）。1 色だけなら `colors` に 1 つ、.pal の読み込みなら 16 色を渡す。
 */
export class SetPaletteColorsCommand extends TilesetCommand<SetPaletteColorsArgs> {
  static readonly NAME = "setPaletteColors";
  readonly name = SetPaletteColorsCommand.NAME;
  protected readonly parts: readonly TilesetPart[] = ["palettes"];

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetPaletteColorsCommand {
    const start = argOptInt(args, "start");
    return new SetPaletteColorsCommand({
      ...argTileset(args),
      palette: argInt(args, "palette"),
      ...(start === undefined ? {} : { start }),
      colors: argIntArray(args, "colors"),
    });
  }

  protected edit(tileset: TilesetDocument): void {
    const palette = checkRange("palette", this.args.palette, 0, 15);
    const start = checkRange("start", this.args.start ?? 0, 0, 15);
    checkRange("colors.length", this.args.colors.length, 1, 16 - start);
    this.args.colors.forEach((c) => checkRange("colors", c, 0, 0x7fff));
    tileset.palettes.set(this.args.colors, palette * 16 + start);
  }
}
