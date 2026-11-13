import { mapHeaderCodec } from "../../../map/MapHeaderCodec.js";
import { MAP_HEADER_SIZE } from "../../../map/constants.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { parseHexBytes } from "../../EditError.js";
import { argMapId, argString, type Args } from "../../jsonArgs.js";
import { HeaderCommand, type MapArgs } from "../base/MapPartCommand.js";
import { replaceHeader } from "./headerFields.js";

/** 「ヘッダーを生のバイトで変える」の引数。 */
export type SetRawHeaderArgs = MapArgs & {
  /** 28 バイトの 16 進（AdvanceMap の高度なヘッダーの「マップヘッダー」欄。空白は無視）。 */
  header: string;
};

/**
 * 「ヘッダーを生のバイトで変える」コマンド（高度なヘッダーの「保存してマップの再読み込み」）。
 * 0x00〜0x0F のポインタは maps\ では保存時に作り直すので読み捨て、0x10 以降の設定だけを使う。
 */
export class SetRawHeaderCommand extends HeaderCommand<SetRawHeaderArgs> {
  static readonly NAME = "setRawHeader";
  readonly name = SetRawHeaderCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetRawHeaderCommand {
    return new SetRawHeaderCommand({ ...argMapId(args), header: argString(args, "header") });
  }

  protected edit(doc: MapDocument, context: DocumentContext): void {
    const raw = mapHeaderCodec.decode(parseHexBytes("header", this.args.header, MAP_HEADER_SIZE));
    const { layout: _l, events: _e, scripts: _s, connections: _c, ...fields } = raw;
    replaceHeader(doc, fields, context);
  }
}
