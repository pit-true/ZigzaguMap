import { describe, expect, it } from "vitest";
import { createImage, downscaleImage, downscaleSize } from "../src/index.js";

describe("画像の縮小（ミニマップ。#511）", () => {
  it("長い辺を上限に合わせ、縦横比を保つ。小さい画像は等倍", () => {
    expect(downscaleSize(1600, 1200, 200)).toEqual({ width: 200, height: 150 });
    expect(downscaleSize(320, 3200, 200)).toEqual({ width: 20, height: 200 });
    expect(downscaleSize(100, 50, 200)).toEqual({ width: 100, height: 50 });
    expect(downscaleSize(4000, 1, 200)).toEqual({ width: 200, height: 1 });
    expect(downscaleSize(0, 10, 200)).toEqual({ width: 0, height: 0 });
  });

  it("縮めた 1 画素は、入る元の画素の平均の色", () => {
    const src = createImage(4, 2);
    // 左の 2×2 は赤と黒が半分ずつ、右の 2×2 は青
    const put = (x: number, y: number, rgba: number[]) => src.data.set(rgba, (y * 4 + x) * 4);
    put(0, 0, [255, 0, 0, 255]);
    put(1, 0, [255, 0, 0, 255]);
    put(0, 1, [0, 0, 0, 255]);
    put(1, 1, [0, 0, 0, 255]);
    for (const [x, y] of [[2, 0], [3, 0], [2, 1], [3, 1]] as const) put(x, y, [0, 0, 200, 255]);
    const out = downscaleImage(src, 2);
    expect(out.width).toBe(2);
    expect(out.height).toBe(1);
    expect([...out.data]).toEqual([128, 0, 0, 255, 0, 0, 200, 255]);
    // 元は変えない
    expect(src.data[0]).toBe(255);
  });

  it("上限より小さい画像はそのままの画素", () => {
    const src = createImage(3, 3);
    for (let i = 0; i < src.data.length; i++) src.data[i] = i % 251;
    const out = downscaleImage(src, 200);
    expect(out.width).toBe(3);
    expect([...out.data]).toEqual([...src.data]);
  });
});
