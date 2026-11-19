import { BLOCK_ID_MASK, BLOCK_PIXELS, createImage, downscaleImage, encodeBase64, layoutNeighbors, type BlockGrid, type BlockRenderer, type MapDocument, type MapId, type RgbaImage } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { NEIGHBOR_BAND } from "../../app/neighbors/NeighborService";
import { TilesetView } from "../../app/TilesetView";
import { jaConnectionWindow as t } from "../../i18n/ja.connectionWindow";
import type { ConnectionImage, ConnectionPreview, PreviewTarget } from "./protocol";

/** 絵の長い辺の上限（画素。これより大きければ縮める）。 */
export const PREVIEW_MAX_SIDE = 640;
/** 今のマップの枠の色（メインの表示の枠と同じ）。 */
const FRAME_COLOR = [0, 0, 0, 191] as const;
/** 接続先を暗くする割合（メインの表示の隣のマップの帯と同じ。NeighborLayer の NEIGHBOR_SHADE）。 */
const NEIGHBOR_SHADE = 0.3;
/** マップの無い所の色。 */
const EMPTY_COLOR = [64, 64, 64, 255] as const;

type Rect = { x: number; y: number; width: number; height: number };

function union(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, width: Math.max(a.x + a.width, b.x + b.width) - x, height: Math.max(a.y + a.height, b.y + b.height) - y };
}

/** 今のマップのうち、接続の辺から NEIGHBOR_BAND マスの帯（向きが上下左右でなければ null）。 */
function edgeStrip(width: number, height: number, direction: number): Rect | null {
  const d = NEIGHBOR_BAND;
  switch (direction) {
    case 1:
      return { x: 0, y: Math.max(0, height - d), width, height: Math.min(d, height) };
    case 2:
      return { x: 0, y: 0, width, height: Math.min(d, height) };
    case 3:
      return { x: 0, y: 0, width: Math.min(d, width), height };
    case 4:
      return { x: Math.max(0, width - d), y: 0, width: Math.min(d, width), height };
    default:
      return null;
  }
}

/** `grid` の `src` の範囲のブロックを、`out` の (dx, dy) マスの所へ描く（隣のマップの帯と同じ描き方）。 */
function blitBlocks(out: RgbaImage, grid: BlockGrid, src: Rect, renderer: BlockRenderer, dx: number, dy: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const block = grid.cells[(src.y + y) * grid.width + src.x + x]! & BLOCK_ID_MASK;
      renderer.blit(block, out.data, out.width, (dx + x) * BLOCK_PIXELS, (dy + y) * BLOCK_PIXELS);
    }
  }
}

/** `rect`（画素）の中を暗くする（黒を重ねる）。 */
function shade(out: RgbaImage, rect: Rect): void {
  for (let y = Math.max(0, rect.y); y < Math.min(out.height, rect.y + rect.height); y++) {
    for (let x = Math.max(0, rect.x); x < Math.min(out.width, rect.x + rect.width); x++) {
      const i = (y * out.width + x) * 4;
      for (let k = 0; k < 3; k++) out.data[i + k] = Math.round(out.data[i + k]! * (1 - NEIGHBOR_SHADE));
    }
  }
}

function fill(out: RgbaImage, color: readonly number[]): void {
  for (let i = 0; i < out.data.length; i += 4) out.data.set(color, i);
}

/** 1 画素の枠を重ねる（`rect` は画素）。 */
function frame(out: RgbaImage, rect: Rect, color: readonly number[]): void {
  const put = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= out.width || y >= out.height) return;
    const i = (y * out.width + x) * 4;
    const a = color[3]! / 255;
    for (let k = 0; k < 3; k++) out.data[i + k] = Math.round(out.data[i + k]! * (1 - a) + color[k]! * a);
  };
  for (let x = rect.x; x < rect.x + rect.width; x++) {
    put(x, rect.y);
    put(x, rect.y + rect.height - 1);
  }
  for (let y = rect.y + 1; y < rect.y + rect.height - 1; y++) {
    put(rect.x, y);
    put(rect.x + rect.width - 1, y);
  }
}

/** 送る形（base64）にする。 */
function encode(image: RgbaImage): ConnectionImage {
  const d = image.data;
  return { width: image.width, height: image.height, rgba: encodeBase64(new Uint8Array(d.buffer, d.byteOffset, d.byteLength)) };
}

/**
 * 接続先の絵を作る（メイン側。#561）。今のマップの、接続の辺から 8 マスの帯と、接続先のマップの見える部分（メインの表示の隣のマップの帯と
 * 同じ並べ方 `layoutNeighbors` と同じ描き方で、同じく暗くする）を並べ、今のマップの枠を重ねる。時間帯の色は使わない（昼）。レイヤーの表示はメインに合わせる。
 * 大きいマップは長い辺を PREVIEW_MAX_SIDE 画素に縮める。
 */
export async function renderConnectionPreview(state: EditorState, target: PreviewTarget): Promise<ConnectionPreview> {
  const none = (text: string): ConnectionPreview => ({ image: null, region: null, bandAt: null, band: null, cell: BLOCK_PIXELS, text });
  const map = state.map;
  const session = state.session;
  if (!map || !session) return none("");
  const strip = edgeStrip(map.doc.width, map.doc.height, target.direction);
  if (!strip) return none(t.notSide);
  const id: MapId = { bank: target.bank, map: target.map };
  if (!session.catalog.has(id)) return none(t.noMap(target.bank, target.map));
  const other: MapDocument | null = session.project.loaded(id) ?? (await session.project.peek(id).catch(() => null));
  if (!other) return none(t.noMap(target.bank, target.map));
  if (state.map !== map) return none("");
  const layout = layoutNeighbors(
    { width: map.doc.width, height: map.doc.height, connections: [{ direction: target.direction, offset: target.offset, bank: id.bank, map: id.map, padding: 0 }] },
    () => ({ width: other.width, height: other.height }),
    NEIGHBOR_BAND,
  );
  const p = layout.neighbors[0];
  const name = session.catalog.get(id)?.name ?? "";
  const label = t.target(id.bank, id.map, name);
  if (!p) return none(`${label}${t.outside}`);
  // 接続先のタイルセット（今のマップと同じ組ならそのまま、持っていれば使い、無ければ読み取り専用で読んで描いたら捨てる）
  const tilesKey = `${other.primaryTileset >>> 0}:${other.secondaryTileset >>> 0}`;
  let tiles = map.tiles.key === tilesKey ? map.tiles : session.cachedTiles(tilesKey);
  if (!tiles) {
    const ts = await session.project.peekTilesets(other);
    tiles = new TilesetView(tilesKey, ts.primary, ts.secondary);
  }
  if (state.map !== map) return none("");
  const region = union(strip, p.bandAt);
  let image = createImage(region.width * BLOCK_PIXELS, region.height * BLOCK_PIXELS);
  fill(image, EMPTY_COLOR);
  blitBlocks(image, map.doc.grid, strip, map.tiles.mapRenderer(map.doc.header.mapType, null), strip.x - region.x, strip.y - region.y);
  blitBlocks(image, other.grid, p.band, tiles.mapRenderer(other.header.mapType, null), p.bandAt.x - region.x, p.bandAt.y - region.y);
  shade(image, { x: (p.bandAt.x - region.x) * BLOCK_PIXELS, y: (p.bandAt.y - region.y) * BLOCK_PIXELS, width: p.bandAt.width * BLOCK_PIXELS, height: p.bandAt.height * BLOCK_PIXELS });
  // 今のマップの枠（メインの表示と同じ）。帯の外へ出る辺は描かない
  frame(
    image,
    { x: -region.x * BLOCK_PIXELS, y: -region.y * BLOCK_PIXELS, width: map.doc.width * BLOCK_PIXELS, height: map.doc.height * BLOCK_PIXELS },
    FRAME_COLOR,
  );
  let cell = BLOCK_PIXELS;
  if (Math.max(image.width, image.height) > PREVIEW_MAX_SIDE) {
    const small = downscaleImage(image, PREVIEW_MAX_SIDE);
    cell = (BLOCK_PIXELS * small.width) / image.width;
    image = small;
  }
  return { image: encode(image), region, bandAt: p.bandAt, band: p.band, cell, text: label };
}
