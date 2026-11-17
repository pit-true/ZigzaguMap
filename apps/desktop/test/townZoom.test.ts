import { describe, expect, it } from "vitest";
import { townZoomArea } from "../src/windows/minimap/TownZoom";

const frame = (x: number, y: number, width = 1, height = 1, page = 0) => ({ rect: { page, x, y, width, height }, source: "rom" as const });

describe("ミニマップのタウンマップの拡大の範囲（#511）", () => {
  it("1 マスの地名は、そのマスを真ん中に 7×5 マスを 4 倍", () => {
    expect(townZoomArea(frame(10, 7))).toEqual({ page: 0, x: 7, y: 5, width: 7, height: 5, scale: 4 });
  });

  it("タウンマップの端では、外へ出ないようにずらす", () => {
    expect(townZoomArea(frame(0, 0))).toMatchObject({ x: 0, y: 0, width: 7, height: 5 });
    expect(townZoomArea(frame(21, 14, 1, 1, 2))).toMatchObject({ page: 2, x: 15, y: 10, width: 7, height: 5 });
  });

  it("大きな地名は 1 マスずつ広げ、224×160 に収まるよう倍率を下げる", () => {
    const a = townZoomArea(frame(3, 2, 8, 4));
    expect(a).toMatchObject({ width: 10, height: 6, scale: 2 });
    expect(a.x).toBe(2);
    expect(a.y).toBe(1);
    expect(townZoomArea(frame(0, 0, 22, 15)).scale).toBe(1);
  });
});
