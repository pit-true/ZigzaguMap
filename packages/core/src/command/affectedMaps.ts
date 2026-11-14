import type { JsonObject, JsonValue } from "./Command.js";
import { flattenCommandRecords } from "./CommandGroup.js";
import type { MapId } from "../map/types.js";

/** 2 枚以上のマップを 1 つのコマンドで変えるとき、引数に持たせる対象の一覧（`targets: [{bank, map}, ...]`）。 */
export function mapTargets(ids: readonly MapId[]): JsonValue[] {
  return ids.map((id) => ({ bank: id.bank, map: id.map }));
}

function mapIdOf(value: unknown): MapId | null {
  const v = value as { bank?: unknown; map?: unknown } | null;
  if (!v || typeof v !== "object") return null;
  return typeof v.bank === "number" && typeof v.map === "number" ? { bank: v.bank, map: v.map } : null;
}

/**
 * コマンドの記録から、変わったマップの一覧を返す（重なりなし、出てきた順）。
 * `group` の中も平らにして、各コマンドの `bank`・`map` と `targets` を集める。マップを持たないコマンドは何も足さない。
 * 画面側は、これで描き直しと未出力の印を決める（2 枚のマップにまたがる操作でも両方に付くように）。
 */
export function affectedMaps(record: { name: string; args: unknown } | null | undefined): MapId[] {
  const out: MapId[] = [];
  const seen = new Set<string>();
  const add = (id: MapId | null): void => {
    if (!id) return;
    const key = `${id.bank}.${id.map}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(id);
  };
  for (const r of flattenCommandRecords(record)) {
    const args = r.args as JsonObject;
    add(mapIdOf(args));
    const targets = args["targets"];
    if (Array.isArray(targets)) for (const t of targets) add(mapIdOf(t));
  }
  return out;
}
