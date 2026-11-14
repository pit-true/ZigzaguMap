import {
  BLOCK_ID_MASK,
  BLOCK_PIXELS,
  createImage,
  layoutNeighbors,
  type BlockGrid,
  type MapDocument,
  type MapId,
  type NeighborLayoutResult,
  type NeighborPlacement,
  type NeighborRange,
} from "@zigzagumap/core";
import { tilesetRefsOf } from "../../windows/tilesetRefs";
import type { EditorState } from "../EditorState";
import type { NeighborView } from "../Settings";
import { TilesetView } from "../TilesetView";
import { timings } from "../timings";
import { scheduleIdleGc } from "../../util/idleGc";

/** 境界から見せる帯の幅（マス）。実機で境界に立ったとき向こう側に見えるのが 7〜8 ブロック（research.md 4.2）。 */
export const NEIGHBOR_BAND = 8;
/** 帯の画像を何枚まで持つか。 */
const BAND_CACHE_SIZE = 16;
/** 読み取り専用で読んだ隣のマップを何枚まで持つか。 */
const PEEK_CACHE_SIZE = 16;

/** 帯 1 枚（隣のマップの見せる部分の画像）。 */
export interface NeighborBand {
  readonly placement: NeighborPlacement;
  /** 帯の画像（等倍。隣のマップの `placement.band` の部分）。 */
  readonly bitmap: ImageBitmap;
  /** 隣のマップの配置（移動許可の重ね描きに使う。読み取り専用）。 */
  readonly grid: BlockGrid;
}

/** 表示中のマップの隣の帯の一式。 */
export interface NeighborFrame {
  readonly main: MapId;
  readonly layout: NeighborLayoutResult;
  readonly bands: readonly NeighborBand[];
}

/** 設定の値から見せる範囲（off なら undefined）。 */
export function neighborRange(view: NeighborView): NeighborRange | undefined {
  if (view === "off") return undefined;
  return view === "all" ? null : NEIGHBOR_BAND;
}

/** 帯の中のブロック番号の要約（変わったかどうかを見るため。FNV-1a）。 */
function bandHash(grid: BlockGrid, band: { x: number; y: number; width: number; height: number }): number {
  let h = 0x811c9dc5;
  for (let y = band.y; y < band.y + band.height; y++) {
    for (let x = band.x; x < band.x + band.width; x++) {
      h ^= grid.cells[y * grid.width + x]! & BLOCK_ID_MASK;
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

/**
 * 隣のマップの帯を読み込み、画像にして持つ（3 つのタブの NeighborLayer が同じものを描く）。
 * - 主マップを出したあと（`map` の知らせのあと）に、待ち時間で読む。主マップの切り替えの時間には入らない。
 * - 隣のマップは、編集していなければ読み取り専用で読み（`CfruProject.peek`）、DocumentStore に入れない。
 * - 帯の画像は「マップ・タイルセット・帯の範囲・帯の中のブロック」を鍵に 16 枚まで持つ。主マップと違うタイルセットの組は、
 *   描いたら捨てる（ブロックの画像のキャッシュを持ち続けない）。
 * - 隣が変わったら（`otherMaps`、タイルセットの編集、接続の変更）描き直す。終わったら `neighbors` で知らせる。
 */
export class NeighborService {
  /** 今の帯（無ければ null）。 */
  frame: NeighborFrame | null = null;
  /** 今のマップの帯を描き終えたか。 */
  done = true;
  /** マップを切り替えてから帯を描き終えるまでの時間（ミリ秒）。 */
  lastMs = 0;
  /** 帯を描くのにかかった時間（主マップを出してから。ミリ秒）。 */
  lastBuildMs = 0;
  private readonly bands = new Map<string, ImageBitmap>();
  private readonly peeked = new Map<string, MapDocument>();
  /** タイルセットを編集した回数（帯の画像の鍵に入れる）。 */
  private tilesetGeneration = 0;
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private unsubscribeBus: (() => void) | null = null;
  private lastView: NeighborView;
  /** 帯を作ったときの主マップの大きさと接続。 */
  private builtSignature = "";

  constructor(private readonly state: EditorState) {
    this.lastView = state.settings.data.neighborView;
    state.on("session", () => this.resetSession());
    state.on("map", () => this.schedule(true));
    state.on("otherMaps", () => {
      const f = this.frame;
      if (f && state.changedMaps.some((id) => f.bands.some((b) => b.placement.id.bank === id.bank && b.placement.id.map === id.map))) this.schedule(false);
    });
    // 主マップの接続・大きさが変わったとき（コネクションマネージャー・リサイズ）も並べ直す（描くたびには作り直さない）
    state.on("cells", () => {
      if (this.mainSignature() !== this.builtSignature) this.schedule(false);
    });
    state.on("view", () => {
      const view = state.settings.data.neighborView;
      if (view === this.lastView) return;
      this.lastView = view;
      this.schedule(false);
    });
  }

  /** 次の待ち時間で帯を作り直す。`switched` はマップを切り替えたとき（時間を測る）。 */
  schedule(switched: boolean): void {
    const token = ++this.token;
    const started = switched ? performance.now() : null;
    this.done = false;
    if (switched) {
      // 前のマップの帯はすぐ消す（余白はそのまま残し、新しい帯ができたら付け替える）
      this.frame = this.frame ? { ...this.frame, bands: [] } : null;
      this.state.emit("neighbors");
    }
    if (this.timer) clearTimeout(this.timer);
    // 主マップを描いて表示したあとに読む（同じタスクの中では描かない）
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.build(token, started).catch(() => {
        if (token === this.token) this.finish(null, started);
      });
    }, 0);
  }

  /** 待っている作り直しを、今すぐ終わらせる（自動操作の `neighbors.state` の `wait` 用）。 */
  async settle(timeoutMs = 5000): Promise<void> {
    const t0 = performance.now();
    while (!this.done && performance.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 10));
  }

  /** 主マップの大きさと接続（変わったら並べ直す）。 */
  private mainSignature(): string {
    const doc = this.state.map?.doc;
    if (!doc) return "";
    return `${doc.width}x${doc.height}:${(doc.connections ?? []).map((c) => `${c.direction},${c.offset},${c.bank},${c.map}`).join(";")}`;
  }

  private resetSession(): void {
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
    for (const b of this.bands.values()) b.close();
    this.bands.clear();
    this.peeked.clear();
    this.frame = null;
    this.done = true;
    const session = this.state.session;
    if (session) {
      // タイルセットを編集したら、帯の画像を描き直す
      this.unsubscribeBus = session.bus.subscribe((e) => {
        if (tilesetRefsOf(e.command).length === 0) return;
        this.tilesetGeneration++;
        this.schedule(false);
      });
    }
    this.state.emit("neighbors");
  }

  private async build(token: number, started: number | null): Promise<void> {
    const t0 = performance.now();
    const session = this.state.session;
    const main = this.state.map;
    const range = neighborRange(this.state.settings.data.neighborView);
    if (!session || !main || range === undefined) return this.finish(null, started);
    const doc = main.doc;
    this.builtSignature = this.mainSignature();
    // 隣のマップを読む（大きさを知るため。上下左右だけ）
    const docs = new Map<string, MapDocument>();
    for (const c of doc.connections ?? []) {
      if (c.direction < 1 || c.direction > 4) continue;
      const id = { bank: c.bank, map: c.map };
      const k = `${id.bank}.${id.map}`;
      if (docs.has(k)) continue;
      const d = await this.peek(id);
      if (token !== this.token) return;
      if (d) docs.set(k, d);
    }
    const layout = layoutNeighbors({ width: doc.width, height: doc.height, connections: doc.connections }, (id) => docs.get(`${id.bank}.${id.map}`) ?? null, range);
    const bands: NeighborBand[] = [];
    const temporary = new Map<string, TilesetView>();
    for (const p of layout.neighbors) {
      const nd = docs.get(`${p.id.bank}.${p.id.map}`)!;
      const tilesKey = `${nd.primaryTileset >>> 0}:${nd.secondaryTileset >>> 0}`;
      const b = p.band;
      const key = `${p.id.bank}.${p.id.map}|${tilesKey}|${this.tilesetGeneration}|${b.x},${b.y},${b.width},${b.height}|${bandHash(nd.grid, b)}`;
      let bitmap = this.bands.get(key);
      if (bitmap) {
        this.bands.delete(key);
      } else {
        let tiles = main.tiles.key === tilesKey ? main.tiles : (session.cachedTiles(tilesKey) ?? temporary.get(tilesKey));
        if (!tiles) {
          const t = await session.project.peekTilesets(nd);
          if (token !== this.token) return;
          tiles = new TilesetView(tilesKey, t.primary, t.secondary);
          temporary.set(tilesKey, tiles);
        }
        bitmap = await renderBand(nd.grid, b, tiles);
        if (token !== this.token) {
          bitmap.close();
          return;
        }
      }
      this.bands.set(key, bitmap);
      bands.push({ placement: p, bitmap, grid: nd.grid });
    }
    // 主マップと違うタイルセットの組（帯のために作ったもの）は捨て、落ち着いたら空いた領域も OS へ返す
    if (temporary.size > 0) scheduleIdleGc(true);
    temporary.clear();
    this.trimBands(new Set(bands.map((b) => b.bitmap)));
    this.lastBuildMs = performance.now() - t0;
    this.finish({ main: main.id, layout, bands }, started);
  }

  private finish(frame: NeighborFrame | null, started: number | null): void {
    this.frame = frame;
    this.done = true;
    // マップを切り替え始めてから帯を描き終えるまで
    if (started !== null) this.lastMs = performance.now() - (timings.lastMapSwitchStart || started);
    this.state.emit("neighbors");
  }

  /** 読み込み済みならそれを、無ければ読み取り専用で読む（16 枚まで持つ）。 */
  private async peek(id: MapId): Promise<MapDocument | null> {
    const session = this.state.session!;
    const loaded = session.project.loaded(id);
    if (loaded) return loaded;
    const k = `${id.bank}.${id.map}`;
    const cached = this.peeked.get(k);
    if (cached) {
      this.peeked.delete(k);
      this.peeked.set(k, cached);
      return cached;
    }
    const doc = await session.project.peek(id);
    if (!doc) return null;
    this.peeked.set(k, doc);
    while (this.peeked.size > PEEK_CACHE_SIZE) this.peeked.delete(this.peeked.keys().next().value!);
    return doc;
  }

  /** 古い帯の画像を捨てる（今使っているものは残す）。 */
  private trimBands(inUse: Set<ImageBitmap>): void {
    for (const [k, b] of this.bands) {
      if (this.bands.size <= BAND_CACHE_SIZE) break;
      if (inUse.has(b)) continue;
      b.close();
      this.bands.delete(k);
    }
  }
}

/** 隣のマップの帯の部分を等倍の画像にする。 */
async function renderBand(grid: BlockGrid, band: { x: number; y: number; width: number; height: number }, tiles: TilesetView): Promise<ImageBitmap> {
  const image = createImage(band.width * BLOCK_PIXELS, band.height * BLOCK_PIXELS);
  for (let y = 0; y < band.height; y++) {
    for (let x = 0; x < band.width; x++) {
      const block = grid.cells[(band.y + y) * grid.width + band.x + x]! & BLOCK_ID_MASK;
      tiles.renderer.blit(block, image.data, image.width, x * BLOCK_PIXELS, y * BLOCK_PIXELS);
    }
  }
  return createImageBitmap(new ImageData(image.data, image.width, image.height));
}
