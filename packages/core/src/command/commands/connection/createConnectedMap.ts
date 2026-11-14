import { NEW_CONNECTED_MAP_CELL } from "../../../connection/ConnectionSlots.js";
import { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapId } from "../../../map/types.js";
import type { MapDocument } from "../../../model/MapDocument.js";
import type { Command } from "../../Command.js";
import { CommandGroup } from "../../CommandGroup.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { checkRange } from "../../EditError.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { LayoutCommand, type MapArgs } from "../base/MapPartCommand.js";
import { SetBorderCommand } from "../layout/SetBorderCommand.js";
import { CreateMapCommand } from "../project/CreateMapCommand.js";
import { ConnectMapsCommand } from "./ConnectMapsCommand.js";

/** 「配置を同じ値で埋める」の引数。 */
export type FillLayoutArgs = MapArgs & { cell: number };

/** 「配置を同じ値で埋める」コマンド（接続から作った新しいマップの配置をブロック 0 にする）。 */
export class FillLayoutCommand extends LayoutCommand<FillLayoutArgs> {
  static readonly NAME = "fillLayout";
  readonly name = FillLayoutCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): FillLayoutCommand {
    return new FillLayoutCommand({ ...argMapId(args), cell: argInt(args, "cell") });
  }

  protected edit(doc: MapDocument): void {
    const cell = checkRange("cell", this.args.cell, 0, 0xffff);
    doc.grid = new BlockGrid(doc.width, doc.height, new Uint16Array(doc.width * doc.height).fill(cell));
  }
}

/** 接続から新しいマップを作る指定。 */
export interface ConnectedMapPlan {
  /** 今のマップ（ヘッダー・タイルセット・境界を写す元）。 */
  readonly from: MapId;
  /** 新しいマップの番号（バンクの末尾か、新しいバンクのマップ 0）。 */
  readonly target: MapId;
  /** 今のマップから見た接続の向き（1〜6）。 */
  readonly direction: number;
  /** 今のマップから見たずれ。 */
  readonly offset: number;
  readonly width: number;
  readonly height: number;
}

/**
 * 「接続から新しいマップを作ってつなぐ」（辺のつまみの右クリック。#230）を、既存のコマンドの組み合わせで作る（1 回の操作）。
 * 新しいマップはヘッダーを今のマップから写し、タイルセットと境界も同じ、配置は全部ブロック 0（移動許可 0x0C）。両側の接続を作る。
 * 1 回の取り消しで新しいマップも接続も消える。今のマップは読み込んでおくこと。
 */
export function createConnectedMap(context: DocumentContext, plan: ConnectedMapPlan): Command {
  const from = context.document(plan.from);
  const border = from.border;
  return CommandGroup.of([
    new CreateMapCommand({
      bank: plan.target.bank,
      map: plan.target.map,
      width: plan.width,
      height: plan.height,
      primaryTileset: from.primaryTileset >>> 0,
      secondaryTileset: from.secondaryTileset >>> 0,
      templateBank: plan.from.bank,
      templateMap: plan.from.map,
    }),
    new SetBorderCommand({ bank: plan.target.bank, map: plan.target.map, width: border.width, height: border.height, cells: [...border.cells] }),
    new FillLayoutCommand({ bank: plan.target.bank, map: plan.target.map, cell: NEW_CONNECTED_MAP_CELL }),
    ConnectMapsCommand.of(plan.from, plan.direction, plan.offset, plan.target),
  ]);
}
