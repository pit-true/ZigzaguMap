import { describe, expect, it } from "vitest";
import { BlockGrid, THUMBNAIL_SIZE, blockAverageColors, renderThumbnail } from "../src/index.js";

describe("マップ一覧のサムネイル（#315）", () => {
  it("ブロックの平均の色", () => {
    const px = new Uint8ClampedArray(16 * 16 * 4);
    for (let i = 0; i < px.length; i += 4) px.set(i < px.length / 2 ? [200, 0, 0, 255] : [0, 100, 0, 255], i);
    const colors = blockAverageColors({ render: () => px }, 2);
    expect([...colors]).toEqual([100, 50, 0, 100, 50, 0]);
  });

  it("縦横比を保って中央に置き、余りは透明", () => {
    const g = new BlockGrid(48, 24);
    for (let x = 0; x < 48; x++) for (let y = 0; y < 24; y++) g.setBlock(x, y, x < 24 ? 0 : 1);
    const colors = new Uint8Array([255, 0, 0, 0, 0, 255]);
    const img = renderThumbnail(g, colors);
    expect(img.width).toBe(THUMBNAIL_SIZE);
    const at = (x: number, y: number) => [...img.data.slice((y * 48 + x) * 4, (y * 48 + x) * 4 + 4)];
    expect(at(0, 0)).toEqual([0, 0, 0, 0]); // 上の余り
    expect(at(0, 12)).toEqual([255, 0, 0, 255]);
    expect(at(47, 30)).toEqual([0, 0, 255, 255]);
    expect(at(0, 47)).toEqual([0, 0, 0, 0]); // 下の余り
  });

  it("大きいマップは複数のブロックの色を平均する", () => {
    const g = new BlockGrid(96, 96);
    for (let x = 0; x < 96; x++) for (let y = 0; y < 96; y++) g.setBlock(x, y, x % 2);
    const img = renderThumbnail(g, new Uint8Array([200, 0, 0, 0, 0, 200]));
    expect([...img.data.slice(0, 4)]).toEqual([100, 0, 100, 255]);
  });
});
