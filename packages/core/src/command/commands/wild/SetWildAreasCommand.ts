import type { MapDocument } from "../../../model/MapDocument.js";
import { WILD_AREA_COUNT } from "../../../wild/layout.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argBoolArray, argMapId, argOptInt, type Args } from "../../jsonArgs.js";
import { WildCommand, type MapArgs } from "../base/MapPartCommand.js";
import { DEFAULT_WILD_TIME, checkWildTime, findWild, newWildArea } from "./wildAreas.js";

/** 「野生のエリアを選ぶ」の引数。 */
export type SetWildAreasArgs = MapArgs & {
  time?: number;
  /** 使うエリア（草むら・水上・岩砕き/木・釣りの 4 つ）。 */
  areas: boolean[];
};

/**
 * 「野生のエリアを選ぶ」コマンド（「野生ポケモンの追加」「タイプの追加」のダイアログの OK）。
 * - チェックしたエリアのうちデータの無いものを、初期値（出現率 0、Lv 1〜1、種族 0）で作る。既にあるものはそのまま。
 * - チェックを外したエリアのデータは消す（AdvanceMap で既存のエリアのチェックを外したときの動作は未確認）。
 * - その時間帯の野生が無いマップでは作る。
 * - 何もチェックしていなければ EditError（wildAddCanceled。「野生ポケモンの出現データの追加/変更を中止しました！」）。
 */
export class SetWildAreasCommand extends WildCommand<SetWildAreasArgs> {
  static readonly NAME = "setWildAreas";
  readonly name = SetWildAreasCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetWildAreasCommand {
    const time = argOptInt(args, "time");
    return new SetWildAreasCommand({ ...argMapId(args), ...(time === undefined ? {} : { time }), areas: argBoolArray(args, "areas") });
  }

  protected edit(doc: MapDocument): void {
    const time = checkWildTime(this.args.time ?? DEFAULT_WILD_TIME);
    const wanted = this.args.areas;
    if (wanted.length !== WILD_AREA_COUNT) throw new TypeError(`引数 areas は ${WILD_AREA_COUNT} 個でなければなりません`);
    if (!wanted.some((v) => v)) throw new EditError(EditErrorCode.WildAddCanceled);
    let wild = findWild(doc, time);
    if (!wild) {
      wild = { time, areas: Array.from({ length: WILD_AREA_COUNT }, () => ({ rate: 0, slots: [] })) };
      doc.wild.push(wild);
      doc.wild.sort((a, b) => a.time - b.time);
    }
    wild.areas = wild.areas.map((a, i) => {
      if (!wanted[i]) return { rate: 0, slots: [] };
      return a.slots.length > 0 ? a : newWildArea(i);
    });
  }
}
