import type { CommandRecord, JsonObject } from "@zigzagumap/core";
import { jaCommands as t } from "../i18n/ja.commands";

/** 引数の対象のマップ（`bank`・`map` が数なら `3.0` の形。無ければ null）。 */
function mapOf(args: JsonObject): string | null {
  const bank = args["bank"];
  const map = args["map"];
  return typeof bank === "number" && typeof map === "number" ? `${bank}.${map}` : null;
}

/** コマンドの名前の文（表に無ければ名前のまま）。 */
export function commandName(name: string): string {
  return t.names[name] ?? name;
}

/**
 * 履歴の窓（Phase5 #402）の 1 行の文。「ブロックを塗る（3.0）」のように、名前の文と対象のマップ。
 * まとめた操作（group）は、中が 1 つならその文、全部同じ名前なら「ブロックを置く × 3」、違えば「イベントの削除 ほか 2 件」。
 */
export function commandText(record: CommandRecord): string {
  let text = commandName(record.name);
  if (record.name === "group") {
    const inner = record.args["commands"];
    if (Array.isArray(inner) && inner.length > 0) {
      const records = inner as unknown as CommandRecord[];
      const first = commandText({ name: records[0]!.name, args: { ...records[0]!.args, bank: null, map: null } });
      if (records.length === 1) text = first;
      else text = records.every((r) => r.name === records[0]!.name) ? t.groupSame(first, records.length) : t.groupMixed(first, records.length - 1);
    }
  }
  const map = mapOf(record.args);
  return map ? text + t.mapSuffix(map) : text;
}
