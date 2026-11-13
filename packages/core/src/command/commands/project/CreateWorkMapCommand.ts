import { BlockGrid } from "../../../map/BlockGrid.js";
import { MapDocument } from "../../../model/MapDocument.js";
import { WORK_MAP_BANK } from "../../../model/WorkMap.js";
import type { Command, EditorContext } from "../../Command.js";
import { documentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argInt, argOptInt, argString, compactArgs, type Args } from "../../jsonArgs.js";
import { checkMapSize } from "../layout/mapSize.js";
import { checkTileset } from "../layout/SetTilesetsCommand.js";
import { NEW_MAP_BORDER_SIZE, NEW_MAP_CELL } from "./CreateMapCommand.js";
import { templateHeader } from "./mapCopy.js";

/** 「新規マップの作成」の引数。 */
export type CreateWorkMapArgs = {
  /** 作業用のマップの番号（バンク -1 の何番目か。DocumentContext.nextWorkMapNumber() の値）。 */
  map: number;
  /** マップの名前（空なら未入力）。 */
  name: string;
  /** 幅・高さ（null と 0 以下は未入力）。 */
  width: number | null;
  height: number | null;
  /** タイルセット 1・2 のポインタ値（null は未選択）。 */
  primaryTileset: number | null;
  secondaryTileset: number | null;
  /** ヘッダーを写すマップ（AdvanceMap では作成時に開いていたマップのヘッダーがそのまま残る）。省略時は全部 0。 */
  templateBank?: number;
  templateMap?: number;
};

/**
 * 「新規マップの作成」コマンド（AdvanceMap の TMapForm の「作成」）。
 * 作業用のマップ（バンク -1）を作る。プロジェクトには入らず、出力もしない（マップの追加/挿入でプロジェクトへ写す）。
 * 配置は全マス 0x3001、ボーダーは 2×2 の 0、イベント・接続・マップスクリプトは無し。
 * 確かめる順は AdvanceMap と同じ: 未入力（名前が空、幅・高さが空か 0 以下、タイルセットが未選択）→ 大きさの上限 → タイルセット。
 */
export class CreateWorkMapCommand implements Command<CreateWorkMapArgs> {
  static readonly NAME = "createWorkMap";
  readonly name = CreateWorkMapCommand.NAME;
  private created = false;

  constructor(readonly args: CreateWorkMapArgs) {}

  /** JSON の引数から作る。 */
  static fromJson(args: Args): CreateWorkMapCommand {
    const nullable = (key: string) => (args[key] === null || args[key] === undefined ? null : argInt(args, key));
    return new CreateWorkMapCommand(
      compactArgs({
        map: argInt(args, "map"),
        name: argString(args, "name"),
        width: nullable("width"),
        height: nullable("height"),
        primaryTileset: nullable("primaryTileset"),
        secondaryTileset: nullable("secondaryTileset"),
        templateBank: argOptInt(args, "templateBank"),
        templateMap: argOptInt(args, "templateMap"),
      }) as CreateWorkMapArgs,
    );
  }

  do(context: EditorContext): void {
    const ctx = documentContext(context);
    const { map, name, width, height, primaryTileset, secondaryTileset } = this.args;
    const missing = [
      ["name", name === ""],
      ["width", width === null || width < 1],
      ["height", height === null || height < 1],
      ["primaryTileset", primaryTileset === null],
      ["secondaryTileset", secondaryTileset === null],
    ].flatMap(([k, m]) => (m ? [k as string] : []));
    if (missing.length > 0) throw new EditError(EditErrorCode.FillAllFields, { missing });
    checkMapSize(width!, height!);
    const primary = checkTileset(ctx, primaryTileset!);
    const secondary = checkTileset(ctx, secondaryTileset!);
    const header = templateHeader(ctx, this.args.templateBank, this.args.templateMap);
    const doc = new MapDocument({
      id: { bank: WORK_MAP_BANK, map },
      header,
      grid: new BlockGrid(width!, height!, new Uint16Array(width! * height!).fill(NEW_MAP_CELL)),
      border: new BlockGrid(NEW_MAP_BORDER_SIZE, NEW_MAP_BORDER_SIZE),
      primaryTileset: primary,
      secondaryTileset: secondary,
      mapName: ctx.mapName(header.regionMapSectionId)?.slice() ?? null,
    });
    ctx.putWorkMap(doc, { name, path: null });
    this.created = true;
  }

  undo(context: EditorContext): void {
    if (!this.created) return;
    documentContext(context).removeWorkMap({ bank: WORK_MAP_BANK, map: this.args.map });
    this.created = false;
  }
}
