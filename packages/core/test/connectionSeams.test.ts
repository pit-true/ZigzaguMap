import { describe, expect, it } from "vitest";
import { BlockGrid, ConnectionDirection, SEAM_VIEW, findSeamIssues, seamCells, type MapConnection } from "../src/index.js";

function conn(direction: number, offset: number, bank = 3, map = 1): MapConnection {
  return { direction, offset, bank, map, padding: 0 };
}

/** 全マスが `block` の配置（`special` のマスだけ別の番号）。 */
function grid(width: number, height: number, block: number, special: Record<string, number> = {}): BlockGrid {
  const g = new BlockGrid(width, height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) g.setBlock(x, y, special[`${x},${y}`] ?? block);
  return g;
}

describe("接続の境目の点検（#305）", () => {
  it("見える範囲は主マップを横 8・縦 6 マス広げた矩形と相手の重なり", () => {
    expect(SEAM_VIEW).toEqual({ horizontal: 8, vertical: 6 });
    // 上の相手（20×10）: 下から 6 行、横は主マップ（10 幅）の左右 8 マスまで = 26 列のうち相手の幅 20 の範囲（ずれ 0 なら 0〜17）
    const up = seamCells({ width: 10, height: 10 }, conn(ConnectionDirection.Up, 0), { width: 20, height: 10 });
    expect(up.length).toBe(18 * 6);
    expect(Math.min(...up.map((c) => c.y))).toBe(4);
    expect(Math.max(...up.map((c) => c.x))).toBe(17);
    // 右の相手（30×30、ずれ -5）: 左から 8 列、縦は主マップの上下 6 マス（-6〜15）と相手（-5〜24）の重なり = 21 行
    const right = seamCells({ width: 10, height: 10 }, conn(ConnectionDirection.Right, -5), { width: 30, height: 30 });
    expect(right.length).toBe(8 * 21);
    expect(Math.max(...right.map((c) => c.x))).toBe(7);
    // ダイブ・浮上は見えない
    expect(seamCells({ width: 10, height: 10 }, conn(ConnectionDirection.Dive, 0), { width: 10, height: 10 })).toEqual([]);
  });

  it("違う絵になるブロックのマスだけを、主マップの座標で数える", () => {
    const neighbor = grid(10, 10, 1, { "2,9": 700, "3,9": 700, "4,3": 700 });
    const issues = findSeamIssues({ width: 10, height: 10, connections: [conn(ConnectionDirection.Up, 0), conn(ConnectionDirection.Down, 0, 3, 2)] }, (c) =>
      c.map === 1 ? { grid: neighbor, differs: (b) => b >= 640 } : null,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0]!.index).toBe(0);
    expect(issues[0]!.side).toBe("up");
    // (4,3) は下から 7 行目なので見えない
    expect(issues[0]!.cells).toEqual([
      { x: 2, y: -1 },
      { x: 3, y: -1 },
    ]);
  });

  it("崩れるマスが無い接続は結果に入らない", () => {
    const issues = findSeamIssues({ width: 4, height: 4, connections: [conn(ConnectionDirection.Left, 0)] }, () => ({ grid: grid(4, 4, 1), differs: () => false }));
    expect(issues).toEqual([]);
  });
});
