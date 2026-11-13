import type { JsonObject } from "../../command/Command.js";
import { documentContext } from "../../command/DocumentContext.js";
import { EditError, EditErrorCode, checkRange } from "../../command/EditError.js";
import { argInt, argOptInt, argOptString, type Args } from "../../command/jsonArgs.js";
import { MAP_NAME_MAX_BYTES, hasMapName } from "../../name/MapNameTable.js";
import { HEAL_LOCATION_COUNT, isRegionSection } from "../constants.js";
import type { RegionMapContext } from "../RegionMapContext.js";
import { RegionMapCommand } from "./RegionMapCommand.js";

/** 「ポジションの保存」の引数。省略した項目は変えない。 */
export type SetRegionSectionArgs = {
  /** 地名番号（0x58〜0xC5）。 */
  id: number;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  /** 名前（マップ名表を書き換える。同じ地名番号の全マップの名前が変わる）。 */
  name?: string;
  /** 空を飛ぶの行き先（0x58〜0xC3 だけ）。 */
  flyBank?: number;
  flyMap?: number;
  flyHeal?: number;
  /** 飛び先（回復地点）の番号と中身（1〜20）。 */
  healIndex?: number;
  healBank?: number;
  healMap?: number;
  healX?: number;
  healY?: number;
};

const S16: [number, number] = [-0x8000, 0x7fff];

/**
 * 地名 1 つの位置・大きさ・名前・空を飛ぶの行き先・飛び先を変える（ワールドマップエディターの「ポジションの保存」）。
 * 名前を変えるときは DocumentContext（マップ名の編集）も要る。
 */
export class SetRegionSectionCommand extends RegionMapCommand<SetRegionSectionArgs & JsonObject> {
  static readonly NAME = "setRegionSection";
  readonly name = SetRegionSectionCommand.NAME;
  private nameBefore: { value: Uint8Array | null } | null = null;

  static fromJson(args: Args): SetRegionSectionCommand {
    const out: SetRegionSectionArgs = { id: argInt(args, "id") };
    for (const key of ["x", "y", "width", "height", "flyBank", "flyMap", "flyHeal", "healIndex", "healBank", "healMap", "healX", "healY"] as const) {
      const v = argOptInt(args, key);
      if (v !== undefined) out[key] = v;
    }
    const name = argOptString(args, "name");
    if (name !== undefined) out.name = name;
    return new SetRegionSectionCommand(out);
  }

  constructor(args: SetRegionSectionArgs) {
    super(args as SetRegionSectionArgs & JsonObject);
  }

  protected apply(context: RegionMapContext): void {
    const a = this.args;
    const doc = context.regionMap();
    if (!isRegionSection(a.id)) throw new EditError(EditErrorCode.ValueOutOfRange, { field: "id", value: a.id, min: 0x58, max: 0xc5 });
    const section = doc.section(a.id)!;
    if (a.x !== undefined) section.x = checkRange("x", a.x, ...S16);
    if (a.y !== undefined) section.y = checkRange("y", a.y, ...S16);
    if (a.width !== undefined) section.width = checkRange("width", a.width, 0, 0xffff);
    if (a.height !== undefined) section.height = checkRange("height", a.height, 0, 0xffff);

    const flyGiven = a.flyBank !== undefined || a.flyMap !== undefined || a.flyHeal !== undefined;
    const fly = doc.flyDestination(a.id);
    if (flyGiven && !fly) throw new EditError(EditErrorCode.FieldNotApplicable, { field: "fly" });
    if (fly) {
      if (a.flyBank !== undefined) fly.bank = checkRange("flyBank", a.flyBank, 0, 255);
      if (a.flyMap !== undefined) fly.map = checkRange("flyMap", a.flyMap, 0, 255);
      if (a.flyHeal !== undefined) fly.heal = checkRange("flyHeal", a.flyHeal, 0, 255);
    }

    const healGiven = a.healBank !== undefined || a.healMap !== undefined || a.healX !== undefined || a.healY !== undefined;
    let heal = null;
    if (healGiven) {
      if (a.healIndex === undefined) throw new EditError(EditErrorCode.FillAllFields, { missing: ["healIndex"] });
      checkRange("healIndex", a.healIndex, 1, HEAL_LOCATION_COUNT);
      heal = doc.healLocation(a.healIndex)!;
      if (a.healBank !== undefined) heal.bank = checkRange("healBank", a.healBank, 0, 255);
      if (a.healMap !== undefined) heal.map = checkRange("healMap", a.healMap, 0, 255);
      if (a.healX !== undefined) heal.x = checkRange("healX", a.healX, ...S16);
      if (a.healY !== undefined) heal.y = checkRange("healY", a.healY, ...S16);
    }

    let nameBytes: Uint8Array | null = null;
    if (a.name !== undefined) {
      const ctx = documentContext(context);
      if (!hasMapName(a.id)) throw new EditError(EditErrorCode.NoMapName, { regionId: a.id });
      const invalid = ctx.textCodec.firstInvalidChar(a.name);
      if (invalid !== null) throw new EditError(EditErrorCode.MapNameInvalidChar, { char: invalid });
      nameBytes = ctx.textCodec.encode(a.name);
      if (nameBytes.length > MAP_NAME_MAX_BYTES) throw new EditError(EditErrorCode.MapNameTooLong, { length: nameBytes.length, max: MAP_NAME_MAX_BYTES });
    }

    // ここから変える（確認はすべて済んでいる）。
    doc.setSection(a.id, section);
    if (fly) doc.setFlyDestination(a.id, fly);
    if (heal) doc.setHealLocation(a.healIndex!, heal);
    if (nameBytes) {
      const ctx = documentContext(context);
      const current = ctx.mapName(a.id);
      if (!current || !bytesSame(current, nameBytes)) {
        this.nameBefore = { value: ctx.mapNameEdit(a.id) };
        ctx.setMapNameEdit(a.id, nameBytes);
      }
    }
  }

  protected override beforeRestore(context: RegionMapContext): void {
    if (this.nameBefore) documentContext(context).setMapNameEdit(this.args.id, this.nameBefore.value);
  }
}

function bytesSame(a: Uint8Array, b: Uint8Array): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
