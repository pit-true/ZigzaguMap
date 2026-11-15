import { describe, expect, it } from "vitest";
import { DEFAULT_GRID_STYLE, dashPattern, gridLinePositions, isDefaultGridStyle, normalizeGridStyle } from "../src/ui/map/gridStyle";
import { movementHex, parseMovementHex } from "../src/ui/map/MovementValueField";
import { PLAYER_VIEW, PLAYER_VIEW_ORIGIN } from "../src/ui/map/CursorLayer";

describe("グリッドの設定（#391）", () => {
  it("壊れた値・範囲の外は直し、既定は今までの見た目", () => {
    expect(normalizeGridStyle(undefined)).toEqual(DEFAULT_GRID_STYLE);
    expect(isDefaultGridStyle(normalizeGridStyle({}))).toBe(true);
    expect(normalizeGridStyle({ width: 0, height: 100, offsetX: 5, offsetY: -1, color: "red", line: "wave" })).toEqual({
      width: 1,
      height: 64,
      offsetX: 0,
      offsetY: 63,
      color: "#000000",
      line: "solid",
    });
    expect(normalizeGridStyle({ width: 4, height: 2, offsetX: 6, offsetY: 1, color: "#FF00aa", line: "dotted" })).toEqual({
      width: 4,
      height: 2,
      offsetX: 2,
      offsetY: 1,
      color: "#ff00aa",
      line: "dotted",
    });
  });

  it("線の位置は、ずらしから線の間ごと", () => {
    expect(gridLinePositions(100, 16, 1, 0)).toEqual([0, 16, 32, 48, 64, 80, 96]);
    expect(gridLinePositions(100, 16, 2, 1)).toEqual([16, 48, 80]);
    expect(gridLinePositions(64, 32, 1, 0)).toEqual([0, 32]);
  });

  it("線の形ごとの描く長さと空ける長さ", () => {
    expect(dashPattern("solid", 1).off).toBe(0);
    expect(dashPattern("dashed", 2)).toEqual({ on: 8, off: 6 });
    expect(dashPattern("dotted", 1)).toEqual({ on: 1, off: 1 });
  });
});

describe("移動許可の数値の欄（#391）", () => {
  it("16 進 2 桁（00〜3F）だけ受け付ける", () => {
    expect(parseMovementHex("1a")).toBe(0x1a);
    expect(parseMovementHex(" 3F ")).toBe(0x3f);
    expect(parseMovementHex("4")).toBe(4);
    expect(parseMovementHex("40")).toBeNull();
    expect(parseMovementHex("g1")).toBeNull();
    expect(parseMovementHex("")).toBeNull();
    expect(movementHex(5)).toBe("05");
    expect(movementHex(0x3c)).toBe("3C");
  });
});

describe("プレイヤーの視界の枠（#391・Q7）", () => {
  it("ゲームの画面と同じ 15×10 マスで、主人公の位置は枠の中", () => {
    expect(PLAYER_VIEW).toEqual({ width: 15, height: 10 });
    expect(PLAYER_VIEW_ORIGIN.x).toBeLessThan(PLAYER_VIEW.width);
    expect(PLAYER_VIEW_ORIGIN.y).toBeLessThan(PLAYER_VIEW.height);
  });
});
