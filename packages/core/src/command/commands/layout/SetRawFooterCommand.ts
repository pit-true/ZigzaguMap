import { mapFooterCodec } from "../../../map/MapHeaderCodec.js";
import { MAP_LAYOUT_SIZE } from "../../../map/constants.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { checkRange, parseHexBytes } from "../../EditError.js";
import { argMapId, argString, type Args } from "../../jsonArgs.js";
import { LayoutCommand, type MapArgs } from "../base/MapPartCommand.js";
import { checkMapSize, reflowGrid, resizeGrid } from "./mapSize.js";
import { checkTileset } from "./SetTilesetsCommand.js";

/** 「フッターを生のバイトで変える」の引数。 */
export type SetRawFooterArgs = MapArgs & {
  /** 28 バイトの 16 進（AdvanceMap の高度なヘッダーの「マップフッター」欄。空白は無視）。 */
  footer: string;
};

/**
 * 「フッターを生のバイトで変える」コマンド（高度なヘッダーの「マップデータ」の「保存してマップの再読み込み」）。
 * 幅・高さ（配置のデータを新しい幅で折り返して読む。増えたマスは 0）、主・副タイルセットのポインタ、ボーダーの幅・高さ、0x1A〜0x1B を使う。
 * ボーダーと配置のポインタは maps\ では保存時に作り直すので読み捨てる。
 */
export class SetRawFooterCommand extends LayoutCommand<SetRawFooterArgs> {
  static readonly NAME = "setRawFooter";
  readonly name = SetRawFooterCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetRawFooterCommand {
    return new SetRawFooterCommand({ ...argMapId(args), footer: argString(args, "footer") });
  }

  protected edit(doc: MapDocument, context: DocumentContext): void {
    const f = mapFooterCodec.decode(parseHexBytes("footer", this.args.footer, MAP_LAYOUT_SIZE));
    checkMapSize(f.width, f.height);
    checkRange("borderWidth", f.borderWidth, 1, 0xff);
    checkRange("borderHeight", f.borderHeight, 1, 0xff);
    const primary = f.primaryTileset === doc.primaryTileset ? f.primaryTileset : checkTileset(context, f.primaryTileset);
    const secondary = f.secondaryTileset === doc.secondaryTileset ? f.secondaryTileset : checkTileset(context, f.secondaryTileset);
    // AdvanceMap と同じく、配置のデータはそのままで新しい幅で折り返して読む（マップサイズの変更のような左上基準の伸縮ではない）
    if (f.width !== doc.width || f.height !== doc.height) doc.grid = reflowGrid(doc.grid, f.width, f.height);
    if (f.borderWidth !== doc.border.width || f.borderHeight !== doc.border.height) {
      doc.border = resizeGrid(doc.border, f.borderWidth, f.borderHeight);
    }
    doc.primaryTileset = primary;
    doc.secondaryTileset = secondary;
    doc.footerPadding = f.padding;
  }
}
