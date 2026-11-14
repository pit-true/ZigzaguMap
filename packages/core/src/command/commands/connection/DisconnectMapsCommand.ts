import { inverseOf } from "../../../connection/NeighborLayout.js";
import { mapTargets } from "../../affectedMaps.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { requireConnection } from "./connectionFields.js";
import { PairedConnectionsCommand, readTargets, type PairedArgs } from "./PairedConnectionsCommand.js";

/** 「接続を消す（相手の逆の接続も）」の引数。 */
export type DisconnectMapsArgs = PairedArgs & { index: number };

/**
 * 「接続を消す」コマンド（辺のつまみの右クリック。#230）。自分の接続を消し、`targets` に相手が入っていれば、
 * 相手の、自分を指す逆向きの接続も消す。1 回の取り消しで両方が戻る。
 */
export class DisconnectMapsCommand extends PairedConnectionsCommand<DisconnectMapsArgs> {
  static readonly NAME = "disconnectMaps";
  readonly name = DisconnectMapsCommand.NAME;

  /** 引数を作る（相手の逆の接続も消すなら `partner`）。 */
  static of(self: { bank: number; map: number }, index: number, partner: { bank: number; map: number } | null): DisconnectMapsCommand {
    return new DisconnectMapsCommand({ bank: self.bank, map: self.map, index, targets: mapTargets(partner ? [self, partner] : [self]) as PairedArgs["targets"] });
  }

  /** JSON の引数から作る。 */
  static fromJson(args: Args): DisconnectMapsCommand {
    const self = argMapId(args);
    return new DisconnectMapsCommand({ ...self, index: argInt(args, "index"), targets: mapTargets(readTargets(args, self)) as PairedArgs["targets"] });
  }

  protected apply(context: DocumentContext): void {
    const doc = context.document(this.mapId);
    const c = requireConnection(doc, this.args.index);
    const partner = this.targets.find((t) => (t.bank !== this.args.bank || t.map !== this.args.map) && t.bank === c.bank && t.map === c.map);
    const other = partner ? context.document(partner) : null;
    doc.connections!.splice(this.args.index, 1);
    if (!other) return;
    const i = inverseOf(other.connections, this.mapId, c.direction, c.offset);
    if (i !== null) other.connections!.splice(i, 1);
  }
}
