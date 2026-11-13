import type { JsonObject } from "../../command/Command.js";
import { EditError, EditErrorCode, checkRange } from "../../command/EditError.js";
import { argInt, type Args } from "../../command/jsonArgs.js";
import { REGION_MAP_LAYERS, isRegionSection } from "../constants.js";
import type { RegionMapContext } from "../RegionMapContext.js";
import { RegionMapCommand } from "./RegionMapCommand.js";

/** 「フラグの保存」の引数。 */
export type SetRegionFlagArgs = {
  /** レイヤー（0: 基本レイヤー、1: トップレイヤー）。 */
  layer: number;
  /** 地名番号（0x58〜0xC5）。 */
  id: number;
  /** 訪問フラグ（0〜0xFFFF。0xFFFF は無し）。 */
  flag: number;
};

/** 地名の人ID（訪問フラグ）を変える（ワールドマップエディターの「フラグの保存」）。 */
export class SetRegionFlagCommand extends RegionMapCommand<SetRegionFlagArgs & JsonObject> {
  static readonly NAME = "setRegionFlag";
  readonly name = SetRegionFlagCommand.NAME;

  static fromJson(args: Args): SetRegionFlagCommand {
    return new SetRegionFlagCommand({ layer: argInt(args, "layer"), id: argInt(args, "id"), flag: argInt(args, "flag") });
  }

  constructor(args: SetRegionFlagArgs) {
    super(args as SetRegionFlagArgs & JsonObject);
  }

  protected apply(context: RegionMapContext): void {
    const { layer, id, flag } = this.args;
    checkRange("layer", layer, 0, REGION_MAP_LAYERS.length - 1);
    if (!isRegionSection(id)) throw new EditError(EditErrorCode.ValueOutOfRange, { field: "id", value: id, min: 0x58, max: 0xc5 });
    checkRange("flag", flag, 0, 0xffff);
    context.regionMap().setFlag(layer, id, flag);
  }
}
