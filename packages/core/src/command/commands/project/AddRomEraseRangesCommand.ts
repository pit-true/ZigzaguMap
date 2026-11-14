import type { Command, EditorContext, JsonObject } from "../../Command.js";
import { argEnum, argInt, type Args } from "../../jsonArgs.js";
import {
  ROM_ERASE_TYPES,
  romRangeCovered,
  type RomEraseEventKind,
  type RomEraseProject,
  type RomEraseRange,
  type RomEraseType,
} from "../../../project/RomEraseJson.js";

/** 埋める範囲を記録するコマンドが使う入口。 */
export interface RomEraseContext extends EditorContext {
  /** `maps\rom_erase.json` の範囲。プロジェクトフォルダが無いときは Error。 */
  romErase(): RomEraseProject;
}

/** EditorContext が RomEraseContext か。 */
export function isRomEraseContext(context: EditorContext): context is RomEraseContext {
  return typeof (context as Partial<RomEraseContext>).romErase === "function";
}

/** 既存の入口に `romErase()` を足したものを作る（withEventLabels と同じ作り）。 */
export function withRomErase<T extends EditorContext>(base: T, get: () => RomEraseProject): T & RomEraseContext {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "romErase") return get;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    has(target, prop) {
      return prop === "romErase" || Reflect.has(target, prop);
    },
  }) as T & RomEraseContext;
}

/** 「埋める範囲を記録する」の引数。 */
export type AddRomEraseRangesArgs = {
  ranges: { address: number; length: number; type: RomEraseType; bank: number; map: number; event: RomEraseEventKind; index: number }[];
};

const EVENTS: RomEraseEventKind[] = ["person", "sign", "trap"];

/**
 * ビルドで 0xFF で埋める ROM の範囲を `maps\rom_erase.json` に足す（#220。出力のときに書く）。
 * もう記録した範囲にすっかり含まれる範囲は足さない（同じ範囲の二重登録を防ぐ）。取り消すと足した分が消える。
 */
export class AddRomEraseRangesCommand implements Command<AddRomEraseRangesArgs & JsonObject> {
  static readonly NAME = "addRomEraseRanges";
  readonly name = AddRomEraseRangesCommand.NAME;
  private before: readonly RomEraseRange[] | null = null;

  static fromJson(args: Args): AddRomEraseRangesCommand {
    const list = args["ranges"];
    if (!Array.isArray(list)) throw new TypeError("引数 ranges は配列でなければなりません");
    return new AddRomEraseRangesCommand({
      ranges: list.map((raw) => {
        const o = raw as Args;
        return {
          address: argInt(o, "address"),
          length: argInt(o, "length"),
          type: argEnum(o, "type", ROM_ERASE_TYPES as RomEraseType[]),
          bank: argInt(o, "bank"),
          map: argInt(o, "map"),
          event: argEnum(o, "event", EVENTS),
          index: argInt(o, "index"),
        };
      }),
    });
  }

  readonly args: AddRomEraseRangesArgs & JsonObject;

  constructor(args: AddRomEraseRangesArgs) {
    // 記録用の範囲（RomEraseRange）を渡しても、決まった項目だけを引数に持つ
    this.args = {
      ranges: args.ranges.map((r) => ({ address: r.address, length: r.length, type: r.type, bank: r.bank, map: r.map, event: r.event, index: r.index })),
    } as AddRomEraseRangesArgs & JsonObject;
  }

  do(context: EditorContext): void {
    if (!isRomEraseContext(context)) throw new Error("このコマンドには埋める範囲の記録（romErase()）が必要です");
    const project = context.romErase();
    const before = project.ranges;
    const next = [...before];
    for (const r of this.args.ranges) {
      if (r.address < 0x08000000 || r.length < 1 || r.address + r.length > 0x0a000000) {
        throw new RangeError(`範囲が ROM の外です: 0x${r.address.toString(16)}（${r.length} バイト）`);
      }
      if (!romRangeCovered(next, r)) next.push({ ...r });
    }
    project.setRanges(next);
    this.before = before;
  }

  undo(context: EditorContext): void {
    if (this.before && isRomEraseContext(context)) context.romErase().setRanges(this.before);
  }
}
