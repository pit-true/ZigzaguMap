import { decodeAmEvents } from "../../../amfile/AmEventFile.js";
import { decodeAmMap, type AmMapData } from "../../../amfile/AmMapFile.js";
import { decodeBase64 } from "../../../binary/base64.js";
import { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapEvents } from "../../../event/types.js";
import { MapDocument } from "../../../model/MapDocument.js";
import { WORK_MAP_BANK } from "../../../model/WorkMap.js";
import type { Command, EditorContext } from "../../Command.js";
import { documentContext, type DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argInt, argOptInt, argString, compactArgs, type Args } from "../../jsonArgs.js";
import { templateHeader } from "./mapCopy.js";

/** 「作成したマップを開く」の引数。 */
export type OpenMapFileArgs = {
  /** 作業用のマップの番号（バンク -1 の何番目か）。 */
  map: number;
  /** 名前（ファイル名から拡張子を除いたもの）。 */
  name: string;
  /** 開いた `.map` のパス（表示と次の保存の初期値用。中身は読まない）。 */
  path?: string;
  /** `.map` の中身（Base64）。 */
  data: string;
  /** 同じ名前の `.evt` の中身（Base64）。無ければ省略（イベント無しで開く）。 */
  events?: string;
  /** ヘッダーを写すマップ（`.map` にはヘッダーが無いので、AdvanceMap と同じく開いていたマップのものを使う）。 */
  templateBank?: number;
  templateMap?: number;
};

/**
 * 「作成したマップを開く」コマンド。AdvanceMap の `.map`（と `.evt`）から作業用のマップ（バンク -1）を作る。
 * タイルセットは AdvanceMap の番号で書かれているので、ベース ROM のタイルセット表でポインタに直す。
 * ファイルの形が不正なら EditError（invalidMapFile）、表に無いタイルセット番号なら EditError（invalidTileset）。
 */
export class OpenMapFileCommand implements Command<OpenMapFileArgs> {
  static readonly NAME = "openMapFile";
  readonly name = OpenMapFileCommand.NAME;
  private created = false;

  constructor(readonly args: OpenMapFileArgs) {}

  /** JSON の引数から作る。 */
  static fromJson(args: Args): OpenMapFileCommand {
    return new OpenMapFileCommand(
      compactArgs({
        map: argInt(args, "map"),
        name: argString(args, "name"),
        path: args["path"] === undefined || args["path"] === null ? undefined : argString(args, "path"),
        data: argString(args, "data"),
        events: args["events"] === undefined || args["events"] === null ? undefined : argString(args, "events"),
        templateBank: argOptInt(args, "templateBank"),
        templateMap: argOptInt(args, "templateMap"),
      }) as OpenMapFileArgs,
    );
  }

  do(context: EditorContext): void {
    const ctx = documentContext(context);
    const data = decode(() => decodeAmMap(decodeBase64(this.args.data)));
    const events: MapEvents | null = this.args.events === undefined ? null : decode(() => decodeAmEvents(decodeBase64(this.args.events!)));
    const primary = tilesetOf(ctx, data.primaryTileset);
    const secondary = tilesetOf(ctx, data.secondaryTileset);
    const header = templateHeader(ctx, this.args.templateBank, this.args.templateMap);
    const doc = new MapDocument({
      id: { bank: WORK_MAP_BANK, map: this.args.map },
      header,
      grid: new BlockGrid(data.width, data.height, data.cells),
      border: new BlockGrid(data.borderWidth, data.borderHeight, data.border),
      primaryTileset: primary,
      secondaryTileset: secondary,
      mapName: ctx.mapName(header.regionMapSectionId)?.slice() ?? null,
      events,
    });
    ctx.putWorkMap(doc, { name: this.args.name, path: this.args.path ?? null });
    this.created = true;
  }

  undo(context: EditorContext): void {
    if (!this.created) return;
    documentContext(context).removeWorkMap({ bank: WORK_MAP_BANK, map: this.args.map });
    this.created = false;
  }
}

/** ファイルを読む（読めなければ EditError invalidMapFile）。 */
function decode<T>(read: () => T): T {
  try {
    return read();
  } catch (e) {
    throw new EditError(EditErrorCode.InvalidMapFile, { reason: e instanceof Error ? e.message : String(e) });
  }
}

/** AdvanceMap のタイルセット番号をポインタ値にする。 */
function tilesetOf(ctx: DocumentContext, index: AmMapData["primaryTileset"]): number {
  const pointer = ctx.tilesetPointer(index);
  if (pointer === null || !ctx.tilesetExists(pointer)) throw new EditError(EditErrorCode.InvalidTileset, { pointer: index });
  return pointer;
}
