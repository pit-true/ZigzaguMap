import { REGION_MAP_CELL_PIXELS, REGION_MAP_HEIGHT, REGION_MAP_WIDTH } from "./constants.js";

/** 地名の表のマスの範囲（面の番号つき）。 */
export interface RegionCellRect {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** ミニマップのタウンマップに出す範囲（地名の表のマス）と倍率。 */
export interface RegionZoomArea extends RegionCellRect {
  readonly scale: number;
}

/** 既定の倍率（ドットをにじませないよう整数倍）。 */
export const REGION_ZOOM_SCALE = 2;

/**
 * ミニマップのタウンマップの拡大（#511、#570）の出す範囲。今の場所の枠 `rect` を真ん中に、出せる大きさ `availWidth`×`availHeight`（画素）に
 * 入るだけのマスを、`scale` 倍（既定 2 倍）で出す。枠より上下左右に 1 マス以上は広く取り、入らなければ倍率を 1 まで下げる。
 * 範囲は地名の表（22×15 マス）の外へ出ないようにずらし、表より大きくはしない（表のまわりの飾りの縁は出さない。見比べて、縁の白と黒が目立ったため）。
 */
export function regionZoomArea(rect: RegionCellRect, availWidth: number, availHeight: number, scale = REGION_ZOOM_SCALE): RegionZoomArea {
  const needW = Math.min(REGION_MAP_WIDTH, rect.width + 2);
  const needH = Math.min(REGION_MAP_HEIGHT, rect.height + 2);
  let k = Math.max(1, Math.floor(scale));
  const fits = (s: number): boolean => Math.floor(availWidth / (REGION_MAP_CELL_PIXELS * s)) >= needW && Math.floor(availHeight / (REGION_MAP_CELL_PIXELS * s)) >= needH;
  while (k > 1 && !fits(k)) k--;
  const cell = REGION_MAP_CELL_PIXELS * k;
  const width = Math.min(REGION_MAP_WIDTH, Math.max(needW, Math.floor(availWidth / cell)));
  const height = Math.min(REGION_MAP_HEIGHT, Math.max(needH, Math.floor(availHeight / cell)));
  // 枠を真ん中に置き、地名の表の中に収める
  const x = Math.min(REGION_MAP_WIDTH - width, Math.max(0, Math.round(rect.x + rect.width / 2 - width / 2)));
  const y = Math.min(REGION_MAP_HEIGHT - height, Math.max(0, Math.round(rect.y + rect.height / 2 - height / 2)));
  return { page: rect.page, x, y, width, height, scale: k };
}
