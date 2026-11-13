import { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapHeaderFields } from "../../../map/MapHeaderCodec.js";
import type { MapId } from "../../../map/types.js";
import { MapDocument } from "../../../model/MapDocument.js";
import type { Command, EditorContext } from "../../Command.js";
import { documentContext, type DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argInt, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { checkMapSize } from "../layout/mapSize.js";
import { checkTileset } from "../layout/SetTilesetsCommand.js";

/** 新規マップの配置の初期値（AdvanceMap と同じ 0x3001 = ブロック 1・移動許可 0x0C）。 */
export const NEW_MAP_CELL = 0x3001;
/** 新規マップのボーダーの大きさ（2×2、中身は 0 = 黒）。 */
export const NEW_MAP_BORDER_SIZE = 2;
/** 1 バンクのマップ数の上限（ビルド側と同じく番号は 0〜254）。 */
export const MAX_MAPS_PER_BANK = 255;
/** バンク数の上限。 */
export const MAX_BANKS = 256;

/** 「新しいマップを作る」の引数。 */
export type CreateMapArgs = {
  /** 置くバンク。既存のバンクなら末尾、バンク数と同じ番号なら新しいバンク。 */
  bank: number;
  /** 置くマップ番号（既存のバンクではマップ数と同じ番号、新しいバンクでは 0）。 */
  map: number;
  /** 幅・高さ・タイルセット。null は未入力（AdvanceMap の「すべて記入してください」）。 */
  width: number | null;
  height: number | null;
  primaryTileset: number | null;
  secondaryTileset: number | null;
  /** ヘッダー（音楽・マップ名 ID など）を写すマップ（AdvanceMap では作成時に開いていたマップ）。省略時は全部 0。 */
  templateBank?: number;
  templateMap?: number;
};

/**
 * 「新しいマップを作る」コマンド（新規マップの作成 + マップの追加/挿入の「ダミーマップ数の変更」「バンク番号の追加」）。
 * 配置は全マス 0x3001、ボーダーは 2×2 の 0、イベント・接続・マップスクリプト・野生は無し（AdvanceMap と同じ）。
 * 置けるのは既存のバンクの末尾か、最後のバンクの次の新しいバンクのマップ 0 だけ（ビルド側の map_project.py の制約）。
 */
export class CreateMapCommand implements Command<CreateMapArgs> {
  static readonly NAME = "createMap";
  readonly name = CreateMapCommand.NAME;
  private created = false;

  constructor(readonly args: CreateMapArgs) {}

  /** JSON の引数から作る。 */
  static fromJson(args: Args): CreateMapCommand {
    const nullable = (key: string) => (args[key] === null || args[key] === undefined ? null : argInt(args, key));
    return new CreateMapCommand(
      compactArgs({
        bank: argInt(args, "bank"),
        map: argInt(args, "map"),
        width: nullable("width"),
        height: nullable("height"),
        primaryTileset: nullable("primaryTileset"),
        secondaryTileset: nullable("secondaryTileset"),
        templateBank: argOptInt(args, "templateBank"),
        templateMap: argOptInt(args, "templateMap"),
      }) as CreateMapArgs,
    );
  }

  /** 次に置けるマップの番号（既存のバンクの末尾）と新しいバンクの番号。 */
  static nextSlots(context: DocumentContext): { appendTo: MapId[]; newBank: MapId } {
    const counts = context.bankCounts();
    return {
      appendTo: counts.flatMap((n, bank) => (n < MAX_MAPS_PER_BANK ? [{ bank, map: n }] : [])),
      newBank: { bank: counts.length, map: 0 },
    };
  }

  do(context: EditorContext): void {
    const ctx = documentContext(context);
    const { bank, map, width, height, primaryTileset, secondaryTileset } = this.args;
    const missing = Object.entries({ width, height, primaryTileset, secondaryTileset }).filter(([, v]) => v === null).map(([k]) => k);
    if (missing.length > 0) throw new EditError(EditErrorCode.FillAllFields, { missing });
    checkMapSize(width!, height!);
    const primary = checkTileset(ctx, primaryTileset!);
    const secondary = checkTileset(ctx, secondaryTileset!);
    checkSlot(ctx, bank, map);
    const header = this.templateHeader(ctx);
    const doc = new MapDocument({
      id: { bank, map },
      header,
      grid: new BlockGrid(width!, height!, new Uint16Array(width! * height!).fill(NEW_MAP_CELL)),
      border: new BlockGrid(NEW_MAP_BORDER_SIZE, NEW_MAP_BORDER_SIZE),
      primaryTileset: primary,
      secondaryTileset: secondary,
      mapName: ctx.mapName(header.regionMapSectionId)?.slice() ?? null,
    });
    ctx.addMap(doc);
    this.created = true;
  }

  undo(context: EditorContext): void {
    if (!this.created) return;
    documentContext(context).removeMap({ bank: this.args.bank, map: this.args.map });
    this.created = false;
  }

  private templateHeader(ctx: DocumentContext): MapHeaderFields {
    const { templateBank, templateMap } = this.args;
    if (templateBank !== undefined && templateMap !== undefined) {
      const id = { bank: templateBank, map: templateMap };
      if (!ctx.hasMap(id)) throw new EditError(EditErrorCode.MapNotFound, id);
      return { ...ctx.document(id).header };
    }
    return { music: 0, layoutId: 0, regionMapSectionId: 0, cave: 0, weather: 0, mapType: 0, bikingAllowed: 0, flags: 0, floorNum: 0, battleType: 0 };
  }
}

/** 置ける番号か確かめる（既存のバンクの末尾か、新しいバンクのマップ 0）。 */
function checkSlot(ctx: DocumentContext, bank: number, map: number): void {
  if (ctx.hasMap({ bank, map })) throw new EditError(EditErrorCode.MapExists, { bank, map });
  const counts = ctx.bankCounts();
  if (!Number.isInteger(bank) || bank < 0 || bank > counts.length || bank >= MAX_BANKS) {
    throw new EditError(EditErrorCode.BankSkip, { bank, expected: counts.length });
  }
  const expected = bank === counts.length ? 0 : counts[bank]!;
  if (map !== expected || expected >= MAX_MAPS_PER_BANK) throw new EditError(EditErrorCode.MapSlotNotAppend, { bank, map, expected });
}
