import type { Command, TilesetRef } from "@zigzagumap/core";

/**
 * コマンドが変えるタイルセット（引数の `tileset` と `secondary`）。まとめたコマンド（CommandGroup）は中を見る。
 * タイルセットを変えないコマンドなら空。
 */
export function tilesetRefsOf(command: Command | null): TilesetRef[] {
  const out: TilesetRef[] = [];
  const visit = (args: unknown): void => {
    const a = args as { tileset?: unknown; secondary?: unknown; commands?: unknown } | undefined;
    if (typeof a?.tileset === "number" && typeof a.secondary === "boolean") out.push({ pointer: a.tileset >>> 0, secondary: a.secondary });
    if (Array.isArray(a?.commands)) for (const c of a.commands as { args?: unknown }[]) visit(c?.args);
  };
  visit(command?.args);
  return out;
}
