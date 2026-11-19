import { describe, expect, it } from "vitest";
import { regionZoomArea } from "../src/index.js";

const rect = (x: number, y: number, width = 1, height = 1, page = 0) => ({ page, x, y, width, height });

describe("ミニマップのタウンマップの拡大の範囲（#511、#570）", () => {
  it("既定は 2 倍で、出せる大きさに入るだけのマスを、今の場所を真ん中に出す", () => {
    expect(regionZoomArea(rect(10, 7), 232, 170)).toEqual({ page: 0, x: 4, y: 3, width: 14, height: 10, scale: 2 });
  });

  it("出せる大きさを広げると、見える範囲も広がる（面より大きくはしない）", () => {
    expect(regionZoomArea(rect(10, 7), 320, 240)).toEqual({ page: 0, x: 1, y: 0, width: 20, height: 15, scale: 2 });
    expect(regionZoomArea(rect(10, 7), 2000, 2000)).toEqual({ page: 0, x: 0, y: 0, width: 22, height: 15, scale: 2 });
  });

  it("地名の表の端では、表の外へ出ないようにずらす（まわりの飾りの縁は出さない）", () => {
    expect(regionZoomArea(rect(0, 0), 232, 170)).toMatchObject({ x: 0, y: 0, width: 14, height: 10 });
    expect(regionZoomArea(rect(21, 14, 1, 1, 2), 232, 170)).toMatchObject({ page: 2, x: 8, y: 5, width: 14, height: 10 });
  });

  it("大きな地名が入らなければ 1 倍に下げる", () => {
    expect(regionZoomArea(rect(0, 0, 22, 15), 232, 170)).toEqual({ page: 0, x: 0, y: 0, width: 22, height: 15, scale: 1 });
    expect(regionZoomArea(rect(5, 5, 2, 2), 50, 40)).toMatchObject({ width: 6, height: 5, scale: 1 });
  });

  it("倍率を渡すと、その倍率から始める（整数に丸める）", () => {
    expect(regionZoomArea(rect(10, 7), 232, 170, 1)).toMatchObject({ width: 22, height: 15, scale: 1 });
    expect(regionZoomArea(rect(10, 7), 232, 170, 3.7)).toMatchObject({ width: 9, height: 7, scale: 3 });
  });
});
