import type { MapDocument } from "../../../model/MapDocument.js";
import { cloneWild } from "../../../model/clone.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argBool, argInt, argMapId, argOptInt, type Args } from "../../jsonArgs.js";
import { WildCommand, type MapArgs } from "../base/MapPartCommand.js";
import { checkWildTime, findWild } from "./wildAreas.js";

/** 「時間帯の野生の表を写す・消す」の引数。 */
export type SetWildTableArgs = MapArgs & {
  /** 作る・消す時間帯（0 朝、1 昼、2 夕、3 夜）。 */
  time: number;
  /** 写す元の時間帯（`remove` が false のとき）。 */
  from?: number;
  /** true なら、その時間帯の表を消す。 */
  remove: boolean;
};

/**
 * 「時間帯の野生の表を写す・消す」コマンド（Phase6 #436。野生ポケモンタブの時間帯のタブ）。
 * - `remove: false`: `from` の時間帯の表を写して `time` の表にする（あれば置き換える）。
 * - `remove: true`: `time` の表を消す（実機ではその時間帯に昼の表を使うようになる）。
 * - 元の表・消す表が無ければ EditError（wildAreaMissing。area は -1）。空の表を作るのは SetWildAreasCommand（`time` つき）。
 */
export class SetWildTableCommand extends WildCommand<SetWildTableArgs> {
  static readonly NAME = "setWildTable";
  readonly name = SetWildTableCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetWildTableCommand {
    const from = argOptInt(args, "from");
    return new SetWildTableCommand({ ...argMapId(args), time: argInt(args, "time"), ...(from === undefined ? {} : { from }), remove: argBool(args, "remove") });
  }

  protected edit(doc: MapDocument): void {
    const time = checkWildTime(this.args.time);
    if (this.args.remove) {
      if (!findWild(doc, time)) throw new EditError(EditErrorCode.WildAreaMissing, { time, area: -1 });
      doc.wild = doc.wild.filter((w) => w.time !== time);
      return;
    }
    const from = checkWildTime(this.args.from ?? time);
    const source = findWild(doc, from);
    if (!source) throw new EditError(EditErrorCode.WildAreaMissing, { time: from, area: -1 });
    const copy = cloneWild([source])[0]!;
    doc.wild = [...doc.wild.filter((w) => w.time !== time), { ...copy, time }].sort((a, b) => a.time - b.time);
  }
}
