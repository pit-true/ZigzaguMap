import type { MapDocument } from "../../../model/MapDocument.js";
import { checkRange } from "../../EditError.js";
import { argInt, argMapId, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { WildCommand, type MapArgs } from "../base/MapPartCommand.js";
import { DEFAULT_WILD_TIME, checkWildArea, checkWildTime, requireWildArea } from "./wildAreas.js";

/** 「野生のスロットを変える」の引数。省略した項目は変えない。 */
export type SetWildSlotArgs = MapArgs & {
  time?: number;
  area: number;
  /** スロットの番号（草むら 0〜11、水上・岩砕き 0〜4、釣り 0〜9）。 */
  slot: number;
  /** 最低 Lv（0〜255）。 */
  minLevel?: number;
  /** 最高 Lv（0〜255）。 */
  maxLevel?: number;
  /** 種族番号（0〜0xFFFF。0 は「選択してください」）。 */
  species?: number;
};

/**
 * 「野生のスロットを変える」コマンド（Pokemon1〜12 の Lv の欄と種族のコンボ）。
 * AdvanceMap と同じく最低と最高の大小は確かめない。
 */
export class SetWildSlotCommand extends WildCommand<SetWildSlotArgs> {
  static readonly NAME = "setWildSlot";
  readonly name = SetWildSlotCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetWildSlotCommand {
    return new SetWildSlotCommand(
      compactArgs({
        ...argMapId(args),
        time: argOptInt(args, "time"),
        area: argInt(args, "area"),
        slot: argInt(args, "slot"),
        minLevel: argOptInt(args, "minLevel"),
        maxLevel: argOptInt(args, "maxLevel"),
        species: argOptInt(args, "species"),
      }) as SetWildSlotArgs,
    );
  }

  protected edit(doc: MapDocument): void {
    const { minLevel, maxLevel, species } = this.args;
    const time = checkWildTime(this.args.time ?? DEFAULT_WILD_TIME);
    const area = requireWildArea(doc, time, checkWildArea(this.args.area));
    const index = checkRange("slot", this.args.slot, 0, area.slots.length - 1);
    const slot = area.slots[index]!;
    area.slots[index] = {
      minLevel: minLevel === undefined ? slot.minLevel : checkRange("minLevel", minLevel, 0, 0xff),
      maxLevel: maxLevel === undefined ? slot.maxLevel : checkRange("maxLevel", maxLevel, 0, 0xff),
      species: species === undefined ? slot.species : checkRange("species", species, 0, 0xffff),
    };
  }
}
