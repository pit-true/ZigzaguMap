import type { FlyPosition } from "../../../fly/types.js";
import type { JsonObject } from "../../Command.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argFieldMap, argInt, type Args } from "../../jsonArgs.js";
import { SnapshotCommand } from "../base/SnapshotCommand.js";

/** 項目ごとの範囲。 */
const FLY_FIELDS: Readonly<Record<keyof FlyPosition, number>> = { bank: 0xff, map: 0xff, x: 0xffff, y: 0xffff, unknown: 0xffff };

/** 「フライトポジションを変える」の引数。 */
export type SetFlyPositionArgs = JsonObject & {
  /** 表の何番目か。 */
  index: number;
  /** 項目名 → 値（bank / map / x / y / unknown）。 */
  fields: { [field: string]: number };
};

/**
 * 「フライトポジションを変える」コマンド（AdvanceMap のイベントタブの「フライトポジション」）。
 * バンク・マップを変えると、そのマップのフライトポジションではなくなる（AdvanceMap の注意文のとおり）。
 * 表はタウンマップの飛び先と同じ ROM の表で、出力では maps\regionmap.json の HealLocations に書く。
 */
export class SetFlyPositionCommand extends SnapshotCommand<SetFlyPositionArgs, FlyPosition> {
  static readonly NAME = "setFlyPosition";
  readonly name = SetFlyPositionCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetFlyPositionCommand {
    const fields = argFieldMap(args, "fields");
    for (const [k, v] of Object.entries(fields)) if (typeof v !== "number") throw new TypeError(`引数 fields.${k} は整数でなければなりません`);
    return new SetFlyPositionCommand({ index: argInt(args, "index"), fields: fields as Record<string, number> });
  }

  protected capture(context: DocumentContext): FlyPosition {
    return { ...this.entry(context) };
  }

  protected apply(context: DocumentContext): void {
    const entry = this.entry(context);
    const values = Object.entries(this.args.fields).map(([field, value]) => {
      const max = Object.prototype.hasOwnProperty.call(FLY_FIELDS, field) ? FLY_FIELDS[field as keyof FlyPosition] : undefined;
      if (max === undefined) throw new EditError(EditErrorCode.UnknownField, { field });
      return [field, checkRange(field, value, 0, max)] as const;
    });
    for (const [field, value] of values) entry[field as keyof FlyPosition] = value;
  }

  protected restore(context: DocumentContext, saved: FlyPosition): void {
    Object.assign(this.entry(context), saved);
  }

  private entry(context: DocumentContext): FlyPosition {
    const list = context.flyPositions;
    const { index } = this.args;
    const entry = Number.isInteger(index) ? list[index] : undefined;
    if (!entry) throw new EditError(EditErrorCode.FlyIndexOutOfRange, { index, count: list.length });
    return entry;
  }
}
