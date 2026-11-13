import type { MapDocument } from "../../../model/MapDocument.js";
import { checkRange } from "../../EditError.js";
import { argInt, argMapId, argOptInt, type Args } from "../../jsonArgs.js";
import { WildCommand, type MapArgs } from "../base/MapPartCommand.js";
import { DEFAULT_WILD_TIME, checkWildArea, checkWildTime, requireWildArea } from "./wildAreas.js";

/** 「野生の出現率を変える」の引数。 */
export type SetWildRateArgs = MapArgs & {
  /** 時間帯（0 朝、1 昼、2 夕、3 夜。省略時は昼）。 */
  time?: number;
  /** エリア（0 草むら、1 水上、2 岩砕き/木、3 釣り）。 */
  area: number;
  /** 出現率（0〜255）。 */
  rate: number;
};

/**
 * 「野生の出現率を変える」コマンド（出現確率の欄とトラックバー）。データの無いエリアは EditError（wildAreaMissing）。
 * AdvanceMap は範囲外の入力を 0〜255 に丸めるが、丸めは画面側で行い、ここでは範囲外を受け付けない。
 */
export class SetWildRateCommand extends WildCommand<SetWildRateArgs> {
  static readonly NAME = "setWildRate";
  readonly name = SetWildRateCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetWildRateCommand {
    const time = argOptInt(args, "time");
    return new SetWildRateCommand({ ...argMapId(args), ...(time === undefined ? {} : { time }), area: argInt(args, "area"), rate: argInt(args, "rate") });
  }

  protected edit(doc: MapDocument): void {
    const time = checkWildTime(this.args.time ?? DEFAULT_WILD_TIME);
    const area = requireWildArea(doc, time, checkWildArea(this.args.area));
    area.rate = checkRange("rate", this.args.rate, 0, 0xff);
  }
}
