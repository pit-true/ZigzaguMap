import type { App } from "../App";
import type { CommandTable } from "./registry";

/**
 * ブロックの使用回数（#235）。`blockUsage` は索引ができるまで待ってから、`block`（省略で選んでいるブロック）の
 * 全マップでの回数、表示中のマップでの回数、移動許可ごとの数、いちばん多い移動許可、移動許可だけ違うマス、
 * 今付けている印（`marks`。マップタブと移動エリアタブ）を返す。
 */
export const blockUsageCommands: CommandTable = {
  blockUsage: async (app: App, req) => {
    const usage = await app.extras.blockUsage.build();
    const map = app.state.map;
    if (!usage || !map) throw new Error("マップが開かれていません");
    const s = app.state.selection;
    const block = typeof req["block"] === "number" ? req["block"] : (s.blocks[0] ?? 0);
    const p = map.doc.primaryTileset;
    const q = map.doc.secondaryTileset;
    const most = usage.mostMovement(block, p, q);
    const grid = map.doc.grid;
    let here = 0;
    const mismatches: { x: number; y: number; movement: number }[] = [];
    for (let i = 0; i < grid.cells.length; i++) {
      const v = grid.cells[i]!;
      if ((v & 0x3ff) !== block) continue;
      here++;
      if (most !== null && v >> 10 !== most) mismatches.push({ x: i % grid.width, y: Math.floor(i / grid.width), movement: v >> 10 });
    }
    return {
      block,
      count: usage.count(block, p, q),
      here,
      movements: Object.fromEntries(usage.movements(block, p, q)),
      mostMovement: most,
      mismatches,
      selectedMovement: app.state.movement,
      marks: { map: app.extras.usageMarks.map.marked.length, movement: app.extras.usageMarks.movement.marked.length },
    };
  },
};
