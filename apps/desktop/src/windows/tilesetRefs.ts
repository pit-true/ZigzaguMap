import { flattenCommandRecords, type Command, type TilesetRef } from "@zigzagumap/core";

/**
 * コマンドが変えるタイルセット（引数の `tileset` と `secondary`）。まとめたコマンド（CommandGroup）は中を見る。
 * タイルセットを変えないコマンドなら空。
 */
export function tilesetRefsOf(command: Command | null): TilesetRef[] {
  const out: TilesetRef[] = [];
  for (const { args } of flattenCommandRecords(command)) {
    if (typeof args["tileset"] === "number" && typeof args["secondary"] === "boolean") out.push({ pointer: args["tileset"] >>> 0, secondary: args["secondary"] });
  }
  return out;
}
