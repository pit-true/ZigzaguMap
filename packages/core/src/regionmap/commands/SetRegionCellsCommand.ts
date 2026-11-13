import type { JsonObject } from "../../command/Command.js";
import { EditError, EditErrorCode, checkRange } from "../../command/EditError.js";
import { argInt, type Args } from "../../command/jsonArgs.js";
import { REGION_MAP_HEIGHT, REGION_MAP_LAYERS, REGION_MAP_PAGES, REGION_MAP_WIDTH } from "../constants.js";
import type { RegionMapContext } from "../RegionMapContext.js";
import { RegionMapCommand } from "./RegionMapCommand.js";

/** マス 1 つの書き換え。 */
export type RegionCellWrite = { x: number; y: number; value: number };

/** 「マップの保存」の引数。 */
export type SetRegionCellsArgs = {
  /** 面（0: カントー、1: 1〜3のしま、2: 4〜5のしま、3: 6〜7のしま）。 */
  page: number;
  /** レイヤー（0: 基本レイヤー、1: トップレイヤー）。 */
  layer: number;
  cells: RegionCellWrite[];
};

/** 地名の配置のマスを書き換える（ワールドマップエディターの「マップの保存」）。 */
export class SetRegionCellsCommand extends RegionMapCommand<SetRegionCellsArgs & JsonObject> {
  static readonly NAME = "setRegionCells";
  readonly name = SetRegionCellsCommand.NAME;

  static fromJson(args: Args): SetRegionCellsCommand {
    const cells = args["cells"];
    if (!Array.isArray(cells)) throw new TypeError("引数 cells は配列でなければなりません");
    return new SetRegionCellsCommand({
      page: argInt(args, "page"),
      layer: argInt(args, "layer"),
      cells: cells.map((c: unknown) => {
        const o = (c ?? {}) as Args;
        return { x: argInt(o, "x"), y: argInt(o, "y"), value: argInt(o, "value") };
      }),
    });
  }

  constructor(args: SetRegionCellsArgs) {
    super(args as SetRegionCellsArgs & JsonObject);
  }

  protected apply(context: RegionMapContext): void {
    const { page, layer, cells } = this.args;
    checkRange("page", page, 0, REGION_MAP_PAGES.length - 1);
    checkRange("layer", layer, 0, REGION_MAP_LAYERS.length - 1);
    if (cells.length === 0) throw new EditError(EditErrorCode.FillAllFields, { missing: ["cells"] });
    for (const c of cells) {
      checkRange("x", c.x, 0, REGION_MAP_WIDTH - 1);
      checkRange("y", c.y, 0, REGION_MAP_HEIGHT - 1);
      checkRange("value", c.value, 0, 255);
    }
    const doc = context.regionMap();
    for (const c of cells) doc.setCell(page, layer, c.x, c.y, c.value);
  }
}
