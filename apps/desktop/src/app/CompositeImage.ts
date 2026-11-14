import { invoke } from "@tauri-apps/api/core";
import { BLOCK_PIXELS, COMPOSITE_MAX_SIDE, compositeScale, layoutComposite, type CompositeLayout, type MapDocument, type MapId } from "@zigzagumap/core";
import { jaComposite as t } from "../i18n/ja.composite";
import { drawEventsOn, type PlacedEvent } from "../ui/map/EventLayer";
import { spriteSourceFor } from "../ui/map/spriteCanvases";
import { messageBox } from "../ui/MessageBox";
import { scheduleIdleGc } from "../util/idleGc";
import type { EditorState } from "./EditorState";
import { renderBand } from "./neighbors/NeighborService";
import { TilesetView } from "./TilesetView";

/** 重ねるイベント（なし／人だけ／全部）。 */
export type CompositeEvents = "none" | "persons" | "all";

/** 作った画像。 */
export interface CompositeResult {
  readonly canvas: HTMLCanvasElement;
  readonly layout: CompositeLayout;
  /** 縮めた割合（1 = 等倍、2 = 1/2…）。 */
  readonly scale: number;
}

/** 作り方。 */
export interface CompositeOptions {
  /** 接続している全マップ（false なら今のマップ 1 枚）。 */
  readonly whole: boolean;
  readonly events: CompositeEvents;
  /** 縮める割合（省略で、上限を超えるときは `ask` なら聞き、聞かないなら収まるまで縮める）。 */
  readonly scale?: number;
  readonly ask: boolean;
}

/** マップのイベントを、イベントタブと同じ印の並びにする（`persons` なら人だけ）。 */
function placedEvents(doc: MapDocument, events: CompositeEvents): PlacedEvent[] {
  const e = doc.events;
  if (!e || events === "none") return [];
  const out: PlacedEvent[] = e.persons.map((p, index) => ({ kind: "person", index, x: p.x, y: p.y, graphicsId: p.graphicsId }));
  if (events === "persons") return out;
  e.warps.forEach((w, index) => out.push({ kind: "warp", index, x: w.x, y: w.y }));
  e.traps.forEach((s, index) => out.push({ kind: "trap", index, x: s.x, y: s.y }));
  e.signs.forEach((s, index) => out.push({ kind: "sign", index, x: s.x, y: s.y }));
  return out;
}

/**
 * 接続している全マップ（か今のマップ）の画像（#246）。主マップから上下左右の接続をたどって並べ（`layoutComposite`）、
 * マップごとに描いて 1 枚にする。隣のマップは読み取り専用で読む。画像の辺が 16,384 画素を超えるときは 1/2・1/4 に縮めるか聞く（Q15）。
 * コピーは Rust 側でクリップボードへ渡す（CF_DIB と PNG）。描いたら画像はすぐ捨てる。
 */
export class CompositeImage {
  constructor(private readonly state: EditorState) {}

  /** 画像を作る。マップを開いていない・取りやめたときは null。 */
  async render(options: CompositeOptions): Promise<CompositeResult | null> {
    const session = this.state.session;
    const main = this.state.map;
    if (!session || !main) return null;
    const docs = new Map<string, MapDocument>();
    const read = async (id: MapId): Promise<MapDocument | null> => {
      const k = `${id.bank}.${id.map}`;
      const cached = docs.get(k);
      if (cached) return cached;
      const doc = id.bank === main.id.bank && id.map === main.id.map ? main.doc : await session.project.peek(id);
      if (doc) docs.set(k, doc);
      return doc;
    };
    const layout: CompositeLayout = options.whole
      ? await layoutComposite(main.id, read)
      : { maps: [{ id: main.id, x: 0, y: 0, width: main.doc.width, height: main.doc.height }], bounds: { x: 0, y: 0, width: main.doc.width, height: main.doc.height } };
    if (layout.maps.length === 0) return null;
    const b = layout.bounds;
    let scale = options.scale ?? 1;
    const need = compositeScale(b, BLOCK_PIXELS);
    if (options.scale === undefined && need > 1) {
      if (!options.ask) scale = need;
      else {
        const answer = await messageBox(t.tooLargeTitle, t.tooLarge(b.width * BLOCK_PIXELS, b.height * BLOCK_PIXELS, COMPOSITE_MAX_SIDE), "question", "yesNoCancel");
        if (answer === "cancel") return null;
        scale = answer === "yes" ? 2 : 4;
      }
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil((b.width * BLOCK_PIXELS) / scale);
    canvas.height = Math.ceil((b.height * BLOCK_PIXELS) / scale);
    const out = canvas.getContext("2d")!;
    out.imageSmoothingEnabled = scale > 1;
    const sprites = this.state.settings.data.showObjects ? spriteSourceFor(session) : null;
    const tilesets = new Map<string, TilesetView>();
    for (const m of layout.maps) {
      const doc = await read(m.id);
      if (!doc) continue;
      const tilesKey = `${doc.primaryTileset >>> 0}:${doc.secondaryTileset >>> 0}`;
      let tiles = main.tiles.key === tilesKey ? main.tiles : (session.cachedTiles(tilesKey) ?? tilesets.get(tilesKey));
      if (!tiles) {
        const ts = await session.project.peekTilesets(doc);
        tiles = new TilesetView(tilesKey, ts.primary, ts.secondary);
        tilesets.set(tilesKey, tiles);
      }
      const bitmap = await renderBand(doc.grid, { x: 0, y: 0, width: doc.width, height: doc.height }, tiles);
      const one = document.createElement("canvas");
      one.width = bitmap.width;
      one.height = bitmap.height;
      const c = one.getContext("2d")!;
      c.drawImage(bitmap, 0, 0);
      bitmap.close();
      drawEventsOn(c, placedEvents(doc, options.events), BLOCK_PIXELS, null, sprites);
      out.drawImage(one, ((m.x - b.x) * BLOCK_PIXELS) / scale, ((m.y - b.y) * BLOCK_PIXELS) / scale, one.width / scale, one.height / scale);
      one.width = 0;
      one.height = 0;
    }
    tilesets.clear();
    return { canvas, layout, scale };
  }

  /** 作ってクリップボードへ渡す。渡した画像の大きさとマップの数（取りやめたら null）。 */
  async copy(options: CompositeOptions): Promise<{ width: number; height: number; maps: number; scale: number } | null> {
    const r = await this.render(options);
    if (!r) return null;
    try {
      await writeClipboard(r.canvas);
      return { width: r.canvas.width, height: r.canvas.height, maps: r.layout.maps.length, scale: r.scale };
    } finally {
      release(r.canvas);
    }
  }
}

/** Canvas の画像をクリップボードへ（PNG と RGBA を Rust へ渡す）。 */
export async function writeClipboard(canvas: HTMLCanvasElement): Promise<void> {
  const png = new Uint8Array(await (await canvasPng(canvas)).arrayBuffer());
  const rgba = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
  const body = new Uint8Array(png.length + rgba.length);
  body.set(png, 0);
  body.set(rgba, png.length);
  await invoke("clipboard_write_image", body, { headers: { width: String(canvas.width), height: String(canvas.height), "png-length": String(png.length) } });
}

/** Canvas を PNG にする。 */
export function canvasPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(t.encodeFailed))), "image/png"));
}

/** 画像を捨てる（Canvas の領域を返し、落ち着いたら GC で OS へ返す）。 */
export function release(canvas: HTMLCanvasElement): void {
  canvas.width = 0;
  canvas.height = 0;
  scheduleIdleGc(true);
}
