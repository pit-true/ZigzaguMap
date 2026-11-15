import { invoke } from "@tauri-apps/api/core";
import {
  BLOCK_PIXELS,
  COMPOSITE_MAX_SIDE,
  EXPORT_PAD,
  cloneTargetOf,
  compositeScale,
  exportCrop,
  layoutComposite,
  rectsOverlap,
  type CompositeLayout,
  type MapDocument,
  type MapId,
} from "@zigzagumap/core";
import { jaComposite as t } from "../i18n/ja.composite";
import { drawEventsOn, placedPerson, type PersonGraphics, type PlacedEvent } from "../ui/map/EventLayer";
import { personGraphicsId } from "../ui/map/cloneLook";
import { spriteSourceFor } from "../ui/map/spriteCanvases";
import { messageBox } from "../ui/MessageBox";
import { scheduleIdleGc } from "../util/idleGc";
import type { EditorState } from "./EditorState";
import { renderBand } from "./neighbors/NeighborService";
import { drawMovements } from "../ui/map/NeighborLayer";
import { drawGrid } from "../ui/map/MapView";
import type { GridStyle } from "../ui/map/gridStyle";
import { TilesetView } from "./TilesetView";

/** 重ねるイベント（なし／人だけ／全部）。 */
export type CompositeEvents = "none" | "persons" | "all";

/** 重ねるイベントの種類ごとの指定（書き出しの窓。#403）。 */
export interface CompositeEventKinds {
  readonly persons: boolean;
  readonly warps: boolean;
  readonly traps: boolean;
  readonly signs: boolean;
}

/** `events` の 3 段階を種類ごとの指定にする。 */
export function eventKindsOf(events: CompositeEvents): CompositeEventKinds {
  return { persons: events !== "none", warps: events === "all", traps: events === "all", signs: events === "all" };
}

/** 作った画像。 */
export interface CompositeResult {
  readonly canvas: HTMLCanvasElement;
  readonly layout: CompositeLayout;
  /** 縮めた割合（1 = 等倍、2 = 1/2…）。 */
  readonly scale: number;
  /** 描いたマップの数（描く範囲にかかったもの）。 */
  readonly drawn: number;
}

/** 作り方。 */
export interface CompositeOptions {
  /** 接続している全マップ（false なら今のマップ 1 枚）。 */
  readonly whole: boolean;
  readonly events: CompositeEvents;
  /** 縮める割合（省略で、上限を超えるときは `ask` なら聞き、聞かないなら収まるまで縮める）。 */
  readonly scale?: number;
  readonly ask: boolean;
  /** 種類ごとのイベント（あれば `events` より優先。#403）。 */
  readonly eventKinds?: CompositeEventKinds;
  /** 移動許可を重ねる（濃さは移動エリアタブと同じ。#403）。 */
  readonly movement?: boolean;
  /** マップの周り（`EXPORT_PAD`）を境界ブロックで埋める（#403）。 */
  readonly border?: boolean;
  /** マップの周り（`EXPORT_PAD`）に隣のマップを描く（`whole` でないとき。#403）。 */
  readonly neighbors?: boolean;
  /** グリッドを重ねる（形は 表示 > グリッドの設定 と同じ。マップごとにマップの左上にそろえる。#403）。 */
  readonly grid?: GridStyle | null;
}

/** マップのイベントを、イベントタブと同じ印の並びにする（`persons` なら人だけ。クローンの見た目は `graphics` で引く。#298）。 */
function placedEvents(doc: MapDocument, kinds: CompositeEventKinds, graphics: PersonGraphics): PlacedEvent[] {
  const e = doc.events;
  if (!e) return [];
  const out: PlacedEvent[] = kinds.persons ? e.persons.map((p, index) => placedPerson(p, index, graphics)) : [];
  if (kinds.warps) e.warps.forEach((w, index) => out.push({ kind: "warp", index, x: w.x, y: w.y }));
  if (kinds.traps) e.traps.forEach((s, index) => out.push({ kind: "trap", index, x: s.x, y: s.y }));
  if (kinds.signs) e.signs.forEach((s, index) => out.push({ kind: "sign", index, x: s.x, y: s.y }));
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
    const pad = options.border || (options.neighbors && !options.whole) ? EXPORT_PAD : null;
    const layout: CompositeLayout = options.whole || (options.neighbors && pad)
      ? await layoutComposite(main.id, read)
      : { maps: [{ id: main.id, x: 0, y: 0, width: main.doc.width, height: main.doc.height }], bounds: { x: 0, y: 0, width: main.doc.width, height: main.doc.height } };
    if (layout.maps.length === 0) return null;
    // 描く範囲（全マップか今のマップ。境界・隣の帯なら周りに広げる）
    const b = exportCrop(layout, options.whole, pad);
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
    if (options.border) await this.fillBorder(out, main.doc, main.tiles, b, scale);
    const kinds = options.eventKinds ?? eventKindsOf(options.events);
    const opacity = this.state.settings.data.movementOpacity;
    const sprites = this.state.settings.data.showObjects ? spriteSourceFor(session) : null;
    // クローンは元の人の見た目で描く（元のマップは並べたマップから先に引く。#298）
    const graphics: PersonGraphics = (p) => {
      const target = cloneTargetOf(p);
      const origin = target ? docs.get(`${target.bank}.${target.map}`)?.events?.persons.find((q) => q.localId === target.localId) : undefined;
      return origin?.graphicsId ?? personGraphicsId(session, p);
    };
    const tilesets = new Map<string, TilesetView>();
    const drawn = layout.maps.filter((m) => rectsOverlap(b, m)).length;
    for (const [i, m] of layout.maps.entries()) {
      if (!rectsOverlap(b, m)) continue;
      // 隣の帯だけのとき（全マップでない）は、今のマップを最後に描く（帯が今のマップにかからないように）
      if (!options.whole && i === 0 && layout.maps.length > 1) continue;
      await this.drawMap(out, read, m, b, scale, tilesets, kinds, opacity, options.movement === true, graphics, sprites, options.grid ?? null);
    }
    if (!options.whole && layout.maps.length > 1) await this.drawMap(out, read, layout.maps[0]!, b, scale, tilesets, kinds, opacity, options.movement === true, graphics, sprites, options.grid ?? null);
    tilesets.clear();
    return { canvas, layout, scale, drawn };
  }

  /** 並べたマップ 1 つを描く。 */
  private async drawMap(
    out: CanvasRenderingContext2D,
    read: (id: MapId) => Promise<MapDocument | null>,
    m: CompositeLayout["maps"][number],
    b: { x: number; y: number },
    scale: number,
    tilesets: Map<string, TilesetView>,
    kinds: CompositeEventKinds,
    opacity: number,
    movement: boolean,
    graphics: PersonGraphics,
    sprites: ReturnType<typeof spriteSourceFor> | null,
    grid: GridStyle | null,
  ): Promise<void> {
    const session = this.state.session!;
    const main = this.state.map!;
    {
      const doc = await read(m.id);
      if (!doc) return;
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
      if (movement) drawMovements(c, doc.grid, { x: 0, y: 0, width: doc.width, height: doc.height }, BLOCK_PIXELS, opacity);
      if (grid) {
        const lines = document.createElement("canvas");
        lines.width = one.width;
        lines.height = one.height;
        drawGrid(lines, BLOCK_PIXELS, grid);
        c.drawImage(lines, 0, 0);
        lines.width = 0;
        lines.height = 0;
      }
      drawEventsOn(c, placedEvents(doc, kinds, graphics), BLOCK_PIXELS, null, sprites);
      out.drawImage(one, ((m.x - b.x) * BLOCK_PIXELS) / scale, ((m.y - b.y) * BLOCK_PIXELS) / scale, one.width / scale, one.height / scale);
      one.width = 0;
      one.height = 0;
    }
  }

  /** 描く範囲を、今のマップの境界ブロックの並び（マップの左上にそろえる）で埋める。 */
  private async fillBorder(out: CanvasRenderingContext2D, doc: MapDocument, tiles: TilesetView, b: { x: number; y: number }, scale: number): Promise<void> {
    const border = doc.border;
    if (border.width === 0 || border.height === 0) return;
    const bitmap = await renderBand(border, { x: 0, y: 0, width: border.width, height: border.height }, tiles);
    const pattern = out.createPattern(bitmap, "repeat");
    if (pattern) {
      pattern.setTransform(new DOMMatrix().scale(1 / scale).translate(-b.x * BLOCK_PIXELS, -b.y * BLOCK_PIXELS));
      out.fillStyle = pattern;
      out.fillRect(0, 0, out.canvas.width, out.canvas.height);
    }
    bitmap.close();
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
