import { inverseOf } from "../../../connection/NeighborLayout.js";
import { mapTargets } from "../../affectedMaps.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { checkRange } from "../../EditError.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { requireConnection } from "./connectionFields.js";
import { PairedConnectionsCommand, readTargets, type PairedArgs } from "./PairedConnectionsCommand.js";

/** 「接続のずれを変える（相手側もそろえる）」の引数。`targets` は自分と相手（相手をそろえないときは自分だけ）。 */
export type ShiftConnectionArgs = PairedArgs & { index: number; offset: number };

/**
 * 「接続のずれを変える」コマンド（隣の帯の角のつまみ・コネクションマネージャー）。自分の接続の offset を変え、
 * `targets` に相手が入っていれば、相手の、自分を指す逆向きの接続の offset を `-offset` にそろえる。逆の接続が無ければ自分だけ変える。
 * 1 回の取り消しで両方が戻る。
 */
export class ShiftConnectionCommand extends PairedConnectionsCommand<ShiftConnectionArgs> {
  static readonly NAME = "shiftConnection";
  readonly name = ShiftConnectionCommand.NAME;

  /** 引数を作る（相手をそろえるなら `paired`）。 */
  static of(self: { bank: number; map: number }, index: number, offset: number, partner: { bank: number; map: number } | null): ShiftConnectionCommand {
    return new ShiftConnectionCommand({ bank: self.bank, map: self.map, index, offset, targets: mapTargets(partner ? [self, partner] : [self]) as PairedArgs["targets"] });
  }

  /** JSON の引数から作る。 */
  static fromJson(args: Args): ShiftConnectionCommand {
    const self = argMapId(args);
    return new ShiftConnectionCommand({ ...self, index: argInt(args, "index"), offset: argInt(args, "offset"), targets: mapTargets(readTargets(args, self)) as PairedArgs["targets"] });
  }

  protected apply(context: DocumentContext): void {
    const doc = context.document(this.mapId);
    const c = requireConnection(doc, this.args.index);
    const offset = checkRange("offset", this.args.offset, -0x80000000, 0x7fffffff);
    const partner = this.targets.find((t) => (t.bank !== this.args.bank || t.map !== this.args.map) && t.bank === c.bank && t.map === c.map);
    if (partner) {
      const other = context.document(partner);
      const i = inverseOf(other.connections, this.mapId, c.direction, c.offset);
      if (i !== null) other.connections![i] = { ...other.connections![i]!, offset: 0 - offset };
    }
    doc.connections![this.args.index] = { ...c, offset };
  }
}
