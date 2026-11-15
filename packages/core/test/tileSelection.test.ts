import { describe, expect, it } from "vitest";
import { cellPosition, flipSelection, paintPaletteOnly, pickSelection, placeSelection, sheetSelection, singleTile } from "../src/index.js";

const ref = (tile: number, h = false, v = false, palette = 0) => tile | (h ? 0x400 : 0) | (v ? 0x800 : 0) | (palette << 12);

describe("タイルの矩形の選択（#393）", () => {
  it("タイル一覧の 2 点から矩形を作る（逆向きのドラッグも同じ）", () => {
    const s = sheetSelection({ x: 3, y: 2 }, { x: 2, y: 1 }, 16, 64);
    expect(s.width).toBe(2);
    expect(s.height).toBe(2);
    expect(s.refs).toEqual([0x12, 0x13, 0x22, 0x23]);
    expect(s.keepPalette).toBe(false);
  });
  it("左右の反転は列の順と各タイルのビット、上下は行の順とビット", () => {
    const s = sheetSelection({ x: 0, y: 0 }, { x: 1, y: 1 }, 16, 64);
    expect(flipSelection(s, true, false).refs).toEqual([ref(1, true), ref(0, true), ref(0x11, true), ref(0x10, true)]);
    expect(flipSelection(s, false, true).refs).toEqual([ref(0x10, false, true), ref(0x11, false, true), ref(0, false, true), ref(1, false, true)]);
    expect(flipSelection(s, true, true).refs).toEqual([ref(0x11, true, true), ref(0x10, true, true), ref(1, true, true), ref(0, true, true)]);
    // 反転済みのタイルをもう一度反転すると戻る
    expect(flipSelection(flipSelection(s, true, true), true, true).refs).toEqual(s.refs);
  });
  it("2×2 を 8 マスの左上（下層）に 1 回で置く。パレットは今のもの", () => {
    const s = sheetSelection({ x: 4, y: 0 }, { x: 5, y: 1 }, 16, 64);
    const placed = placeSelection(s, 0, { hflip: false, vflip: false, palette: 3 });
    expect(placed).toEqual([
      { cell: 0, ref: ref(4, false, false, 3) },
      { cell: 1, ref: ref(5, false, false, 3) },
      { cell: 2, ref: ref(0x14, false, false, 3) },
      { cell: 3, ref: ref(0x15, false, false, 3) },
    ]);
  });
  it("4×2 は下層と上層にまたがり、はみ出た分は置かない", () => {
    const s = sheetSelection({ x: 0, y: 0 }, { x: 3, y: 1 }, 16, 64);
    expect(placeSelection(s, 0, { hflip: false, vflip: false, palette: 0 }).map((p) => p.cell)).toEqual([0, 1, 4, 5, 2, 3, 6, 7]);
    // 下層の右下（マス 3）から置くと、右へ 1 列（上層の左下 = マス 6）だけ入る
    expect(placeSelection(s, 3, { hflip: false, vflip: false, palette: 0 }).map((p) => p.cell)).toEqual([3, 6, 7]);
    // 上層の右上（マス 5）から: 1 列 × 2 行
    expect(placeSelection(s, 5, { hflip: false, vflip: false, palette: 0 })).toEqual([
      { cell: 5, ref: 0 },
      { cell: 7, ref: 0x10 },
    ]);
  });
  it("3 層目の格子にも置け、8 マスへははみ出さない", () => {
    const s = sheetSelection({ x: 0, y: 0 }, { x: 2, y: 2 }, 16, 64);
    expect(placeSelection(s, 8, { hflip: false, vflip: false, palette: 1 }).map((p) => p.cell)).toEqual([8, 9, 10, 11]);
  });
  it("反転した矩形を置くと、並びもビットも反転する", () => {
    const s = sheetSelection({ x: 0, y: 0 }, { x: 1, y: 1 }, 16, 64);
    const placed = placeSelection(s, 0, { hflip: true, vflip: false, palette: 2 });
    expect(placed.map((p) => p.ref)).toEqual([ref(1, true, false, 2), ref(0, true, false, 2), ref(0x11, true, false, 2), ref(0x10, true, false, 2)]);
  });
  it("1 枚の選択は今の 1 枚ずつの置き方と同じ", () => {
    expect(placeSelection(singleTile(0x2a), 6, { hflip: true, vflip: true, palette: 9 })).toEqual([{ cell: 6, ref: ref(0x2a, true, true, 9) }]);
  });
  it("右ドラッグで拾った矩形は反転とパレットを持ち、置くと同じ値になる", () => {
    const cells = [ref(1, true, false, 2), ref(2), ref(3, false, true, 5), ref(4), ref(5), ref(6), ref(7), ref(8)];
    const read = (c: number) => cells[c]!;
    const s = pickSelection(3, 0, read);
    expect(s).toEqual({ width: 2, height: 2, refs: [cells[0], cells[1], cells[2], cells[3]], keepPalette: true });
    expect(placeSelection(s, 4, { hflip: false, vflip: false, palette: 0 })).toEqual([
      { cell: 4, ref: cells[0] },
      { cell: 5, ref: cells[1] },
      { cell: 6, ref: cells[2] },
      { cell: 7, ref: cells[3] },
    ]);
    // 下層と上層をまたいで拾う（マス 1 → マス 6 は 2 × 2: 1・4・3・6）
    expect(pickSelection(1, 6, read).refs).toEqual([cells[1], cells[4], cells[3], cells[6]]);
    // 別の格子（3 層目）で離したら押したマスだけ
    expect(pickSelection(2, 9, read).refs).toEqual([cells[2]]);
  });
  it("パレットだけ塗る（タイルと反転はそのまま）", () => {
    const cells = [ref(1, true, false, 2), ref(2, false, true, 4)];
    expect(paintPaletteOnly({ width: 1, height: 1 }, 1, 7, (c) => cells[c]!)).toEqual([{ cell: 1, ref: ref(2, false, true, 7) }]);
  });
  it("マス番号と格子の位置", () => {
    expect(cellPosition(5)).toMatchObject({ x: 3, y: 0 });
    expect(cellPosition(6)).toMatchObject({ x: 2, y: 1 });
    expect(cellPosition(11)).toMatchObject({ x: 1, y: 1 });
  });
});
