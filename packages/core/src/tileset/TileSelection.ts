/**
 * ブロックエディタのタイルの矩形の選択（Phase5 #393）。DOM に依存しない計算だけを置く。
 *
 * - 選択は幅 × 高さのタイル指定（u16。タイル番号・反転・パレット）の並び（左上から行ごと）。
 * - タイル一覧から選んだ矩形は反転なし・パレットは置くときの今のパレット（`keepPalette` が false）。
 *   8 マスから右ドラッグで拾った矩形は、反転とパレットをそのまま持つ（`keepPalette` が true）。
 * - 左右・上下の反転は、矩形の並び（列・行の順）と各タイルの反転のビットの両方に当てる。
 * - 置く先は、8 マス（4 × 2。左の 2 列が下層、右の 2 列が上層）と 3 層目（2 × 2）の格子。
 *   押した位置を左上にして置き、はみ出た分は置かない。
 */
import { packTileRef, unpackTileRef } from "./blockFormat.js";

/** タイルの矩形の選択。 */
export interface TileSelection {
  readonly width: number;
  readonly height: number;
  /** タイル指定（width × height。左上から行ごと）。 */
  readonly refs: readonly number[];
  /** 各タイルのパレットを使うか（false なら置くときの今のパレットにする）。 */
  readonly keepPalette: boolean;
}

/** 置く先の格子（8 マスか 3 層目）。 */
export interface TileGrid {
  readonly width: number;
  readonly height: number;
  /** 格子の位置 (x, y) のマスの番号（8 マスは 0〜7、3 層目は 8〜11）。 */
  cellAt(x: number, y: number): number;
}

/** 8 マス（4 × 2。左 2 列が下層、右 2 列が上層。マス番号は下層 0〜3・上層 4〜7）。 */
export const BLOCK_GRID: TileGrid = {
  width: 4,
  height: 2,
  cellAt: (x, y) => (x >= 2 ? 4 : 0) + (y >= 1 ? 2 : 0) + (x & 1),
};

/** 3 層目の 4 マス（2 × 2。マス番号 8〜11）。 */
export const THIRD_GRID: TileGrid = {
  width: 2,
  height: 2,
  cellAt: (x, y) => 8 + (y >= 1 ? 2 : 0) + (x & 1),
};

/** マス番号の格子の位置（8 マスか 3 層目の格子の中）。 */
export function cellPosition(cell: number): { grid: TileGrid; x: number; y: number } {
  if (cell >= 8) {
    const c = cell - 8;
    return { grid: THIRD_GRID, x: c & 1, y: c >> 1 };
  }
  return { grid: BLOCK_GRID, x: (cell >= 4 ? 2 : 0) + (cell & 1), y: (cell & 2) >> 1 };
}

/** 1 枚だけの選択（タイル一覧で 1 つ押したとき）。 */
export function singleTile(tile: number): TileSelection {
  return { width: 1, height: 1, refs: [tile & 0x3ff], keepPalette: false };
}

/**
 * タイル一覧（`columns` 列）の 2 点を角にした矩形の選択。`rows` を超える行と `columns` を超える列は含めない。
 * 反転なし、パレットは置くときに決める。
 */
export function sheetSelection(a: { x: number; y: number }, b: { x: number; y: number }, columns: number, rows: number): TileSelection {
  const x0 = clamp(Math.min(a.x, b.x), 0, columns - 1);
  const x1 = clamp(Math.max(a.x, b.x), 0, columns - 1);
  const y0 = clamp(Math.min(a.y, b.y), 0, rows - 1);
  const y1 = clamp(Math.max(a.y, b.y), 0, rows - 1);
  const refs: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) refs.push((y * columns + x) & 0x3ff);
  return { width: x1 - x0 + 1, height: y1 - y0 + 1, refs, keepPalette: false };
}

/** 左右・上下の反転を、矩形の並びと各タイルの反転のビットに当てる。 */
export function flipSelection(selection: TileSelection, hflip: boolean, vflip: boolean): TileSelection {
  if (!hflip && !vflip) return selection;
  const { width, height } = selection;
  const refs: number[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const sx = hflip ? width - 1 - x : x;
      const sy = vflip ? height - 1 - y : y;
      let v = selection.refs[sy * width + sx]!;
      if (hflip) v ^= 0x400;
      if (vflip) v ^= 0x800;
      refs.push(v);
    }
  }
  return { ...selection, refs };
}

/** 置く 1 マス分（マス番号と、置くタイル指定）。 */
export interface PlacedTile {
  readonly cell: number;
  readonly ref: number;
}

/**
 * 選択を、マス `cell` を左上にして置いたときの各マスの値。はみ出た分は入れない。
 * 反転（`hflip`・`vflip`）は選択全体に当て、`keepPalette` でなければパレットを `palette` にする。
 */
export function placeSelection(selection: TileSelection, cell: number, options: { hflip: boolean; vflip: boolean; palette: number }): PlacedTile[] {
  const sel = flipSelection(selection, options.hflip, options.vflip);
  const { grid, x: ox, y: oy } = cellPosition(cell);
  const out: PlacedTile[] = [];
  for (let y = 0; y < sel.height; y++) {
    for (let x = 0; x < sel.width; x++) {
      const gx = ox + x;
      const gy = oy + y;
      if (gx >= grid.width || gy >= grid.height) continue;
      const v = sel.refs[y * sel.width + x]!;
      const ref = sel.keepPalette ? v : packTileRef({ ...unpackTileRef(v), palette: options.palette });
      out.push({ cell: grid.cellAt(gx, gy), ref });
    }
  }
  return out;
}

/**
 * 選択の大きさの範囲（マス `cell` を左上にする）のマスのパレットだけを `palette` にした値（Ctrl＋左クリック）。
 * `read` は今のマスの値。
 */
export function paintPaletteOnly(size: { width: number; height: number }, cell: number, palette: number, read: (cell: number) => number): PlacedTile[] {
  const { grid, x: ox, y: oy } = cellPosition(cell);
  const out: PlacedTile[] = [];
  for (let y = 0; y < size.height; y++) {
    for (let x = 0; x < size.width; x++) {
      const gx = ox + x;
      const gy = oy + y;
      if (gx >= grid.width || gy >= grid.height) continue;
      const c = grid.cellAt(gx, gy);
      out.push({ cell: c, ref: packTileRef({ ...unpackTileRef(read(c)), palette }) });
    }
  }
  return out;
}

/**
 * 8 マスか 3 層目の 2 マスを角にした矩形を拾う（右ドラッグ）。2 マスが別の格子なら、押したマスの格子の中で拾う。
 * 反転とパレットをそのまま持つ。
 */
export function pickSelection(from: number, to: number, read: (cell: number) => number): TileSelection {
  const a = cellPosition(from);
  let b = cellPosition(to);
  if (b.grid !== a.grid) b = a;
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const refs: number[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) refs.push(read(a.grid.cellAt(x, y)) & 0xffff);
  return { width: x1 - x0 + 1, height: y1 - y0 + 1, refs, keepPalette: true };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
