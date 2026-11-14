import type { MapConnection } from "../../../connection/types.js";
import type { MapId } from "../../../map/types.js";
import { cloneConnections } from "../../../model/clone.js";
import type { JsonObject } from "../../Command.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { SnapshotCommand } from "../base/SnapshotCommand.js";

/** 2 枚のマップの接続を変えるコマンドの引数（`bank`・`map` が自分、`targets` に自分と相手）。 */
export type PairedArgs = JsonObject & { bank: number; map: number; targets: { bank: number; map: number }[] };

/** 引数の `targets` を読む（無ければ自分だけ）。 */
export function readTargets(args: Record<string, unknown>, self: MapId): MapId[] {
  const list = args["targets"];
  const out: MapId[] = [];
  const add = (id: MapId): void => {
    if (!out.some((o) => o.bank === id.bank && o.map === id.map)) out.push(id);
  };
  add(self);
  if (Array.isArray(list)) {
    for (const t of list) {
      const v = t as { bank?: unknown; map?: unknown } | null;
      if (v && typeof v.bank === "number" && typeof v.map === "number" && Number.isInteger(v.bank) && Number.isInteger(v.map)) add({ bank: v.bank, map: v.map });
    }
  }
  return out;
}

/**
 * 自分と相手（`targets`）の接続をまとめて控えて戻すコマンドの土台。2 枚とも先に読み込んでおくこと。
 * 1 回の取り消しで両方のマップの接続が戻る。
 */
export abstract class PairedConnectionsCommand<A extends PairedArgs> extends SnapshotCommand<A, Map<string, MapConnection[] | null>> {
  /** 自分のマップ。 */
  get mapId(): MapId {
    return { bank: this.args.bank, map: this.args.map };
  }

  /** 対象のマップ（自分が先頭）。 */
  get targets(): MapId[] {
    return readTargets(this.args, this.mapId);
  }

  protected capture(context: DocumentContext): Map<string, MapConnection[] | null> {
    const saved = new Map<string, MapConnection[] | null>();
    for (const id of this.targets) saved.set(`${id.bank}.${id.map}`, cloneConnections(context.document(id).connections));
    return saved;
  }

  protected restore(context: DocumentContext, saved: Map<string, MapConnection[] | null>): void {
    for (const id of this.targets) context.document(id).connections = cloneConnections(saved.get(`${id.bank}.${id.map}`) ?? null);
  }
}
