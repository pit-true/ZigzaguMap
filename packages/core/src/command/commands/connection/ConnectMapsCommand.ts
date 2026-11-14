import { inverseOf, oppositeDirection } from "../../../connection/NeighborLayout.js";
import { ConnectionDirection } from "../../../connection/layout.js";
import { mapTargets } from "../../affectedMaps.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { PairedConnectionsCommand, readTargets, type PairedArgs } from "./PairedConnectionsCommand.js";

/** 「2 枚のマップをつなぐ」の引数。`targetBank`・`targetMap` が相手。 */
export type ConnectMapsArgs = PairedArgs & { direction: number; offset: number; targetBank: number; targetMap: number };

/** ダイブ・浮上の接続か。 */
export function isDiveDirection(direction: number): boolean {
  return direction === ConnectionDirection.Dive || direction === ConnectionDirection.Emerge;
}

/**
 * 「2 枚のマップをつなぐ」コマンド（辺のつまみの右クリック。#230）。自分に接続を 1 つ足し、相手に逆向きの接続（ずれは `-offset`）を足す。
 * 相手がすでに自分を指す逆向きの接続を持っていれば、足さずにずれだけそろえる。
 * ダイブ・浮上は 1 枚に 1 つまでなので、自分か相手がもう持っていればできない（EditError `diveExists`）。
 * 1 回の取り消しで両方が戻る。
 */
export class ConnectMapsCommand extends PairedConnectionsCommand<ConnectMapsArgs> {
  static readonly NAME = "connectMaps";
  readonly name = ConnectMapsCommand.NAME;

  /** 引数を作る。 */
  static of(self: { bank: number; map: number }, direction: number, offset: number, target: { bank: number; map: number }): ConnectMapsCommand {
    return new ConnectMapsCommand({
      bank: self.bank,
      map: self.map,
      direction,
      offset,
      targetBank: target.bank,
      targetMap: target.map,
      targets: mapTargets([self, target]) as PairedArgs["targets"],
    });
  }

  /** JSON の引数から作る。 */
  static fromJson(args: Args): ConnectMapsCommand {
    const self = argMapId(args);
    const target = { bank: argInt(args, "targetBank"), map: argInt(args, "targetMap") };
    return new ConnectMapsCommand({
      ...self,
      direction: argInt(args, "direction"),
      offset: argInt(args, "offset"),
      targetBank: target.bank,
      targetMap: target.map,
      targets: mapTargets(readTargets({ targets: [target] }, self)) as PairedArgs["targets"],
    });
  }

  protected apply(context: DocumentContext): void {
    const { direction, targetBank, targetMap } = this.args;
    checkRange("direction", direction, 1, 6);
    const offset = isDiveDirection(direction) ? 0 : checkRange("offset", this.args.offset, -0x80000000, 0x7fffffff);
    const self = this.mapId;
    const target = { bank: targetBank, map: targetMap };
    if (!context.hasMap(target)) throw new EditError(EditErrorCode.MapNotFound, target);
    const doc = context.document(self);
    const same = self.bank === target.bank && self.map === target.map;
    const other = same ? doc : context.document(target);
    const opposite = oppositeDirection(direction);
    if (isDiveDirection(direction)) {
      if ((doc.connections ?? []).some((c) => c.direction === direction)) throw new EditError(EditErrorCode.DiveExists, { ...self, direction });
      if ((other.connections ?? []).some((c) => c.direction === opposite)) throw new EditError(EditErrorCode.DiveExists, { ...target, direction: opposite });
    }
    (doc.connections ??= []).push({ direction, offset, bank: target.bank, map: target.map, padding: 0 });
    if (same) return;
    const i = inverseOf(other.connections, self, direction);
    if (i !== null) other.connections![i] = { ...other.connections![i]!, offset: 0 - offset };
    else (other.connections ??= []).push({ direction: opposite, offset: 0 - offset, bank: self.bank, map: self.map, padding: 0 });
  }
}
