import {
  AnimatedTiles,
  BLOCK_ID_MASK,
  GifWriter,
  addUsedTiles,
  readTileAnimation,
  tileAnimationKeyFrames,
  tileAnimationLoop,
  visibleTileAnimation,
  type TileAnimationSet,
} from "@zigzagumap/core";
import { scheduleIdleGc } from "../../util/idleGc";
import { jsHeapBytes } from "../../util/jsHeap";
import type { CompositeImage, CompositeOptions } from "../CompositeImage";
import type { EditorState } from "../EditorState";
import { TilesetView } from "../TilesetView";

/** GIF の長さの上限（フレーム。60 分の 1 秒単位で 12 秒。素の FR の外のタイルセットの 1 周 640 フレームが入る）。 */
export const TILE_GIF_MAX_FRAMES = 720;

/** 書き出した GIF。 */
export interface TileAnimGifResult {
  readonly gif: Uint8Array;
  readonly frames: number;
  readonly width: number;
  readonly height: number;
  /** 1 回分の長さ（1/100 秒）。 */
  readonly durationCs: number;
  /** 全部のアニメの周期がそろう長さで切れたか（上限で切っていなければ true）。 */
  readonly complete: boolean;
  /** 書く間に持ったコマの画像のバイト数（1 コマ分。全部のコマは同時に持たない）。 */
  readonly frameBytes: number;
  /** 書く間の JavaScript のヒープの増え方の最大（MB。測れなければ null）。 */
  readonly heapGrowthMb: number | null;
}

/**
 * タイルアニメの GIF（Phase7 #514）。画像の書き出しと同じ作り方（範囲・含めるもの・時間帯）で、タイルアニメの時計を 1 フレームずつ
 * 進めた絵を作り、絵が変わったフレームだけをコマにして GIF に書く（タイルが変わっても、描いた画素が前と同じなら前のコマを延ばす）。長さは全部のアニメの周期がそろうまで（上限 12 秒）。
 * アニメの読み方は Phase6 のタイルアニメ（core の readTileAnimation・AnimatedTiles）と同じ。コマは 1 枚ずつ作ってすぐ書き、
 * 書き終えたら捨てる。元のタイルセットとマップは変えない。動くタイルが無ければ "none"。
 */
export class TileAnimGif {
  constructor(
    private readonly state: EditorState,
    private readonly composite: CompositeImage,
  ) {}

  async render(image: Omit<CompositeOptions, "ask" | "scale" | "tileView">): Promise<TileAnimGifResult | "none" | null> {
    const session = this.state.session;
    if (!session) return null;
    // 1 回描いて、使うタイルセットの組と大きさを知る
    const seen = new Map<string, TilesetView>();
    const usedBlocks = new Map<string, Set<number>>();
    const probe = await this.composite.render({
      ...image,
      ask: false,
      tileView: (t, grid) => {
        seen.set(t.key, t);
        let blocks = usedBlocks.get(t.key);
        if (!blocks) usedBlocks.set(t.key, (blocks = new Set()));
        for (const cell of grid.cells) blocks.add(cell & BLOCK_ID_MASK);
        return t;
      },
    });
    if (!probe) return null;
    const scale = probe.scale;
    const frame = document.createElement("canvas");
    frame.width = probe.canvas.width;
    frame.height = probe.canvas.height;
    probe.canvas.width = 0;
    probe.canvas.height = 0;
    const rom = session.project.rom;
    const read = new Map<number, TileAnimationSet | null>();
    const setOf = (callback: number): TileAnimationSet | null => {
      if (!read.has(callback)) read.set(callback, readTileAnimation(rom, callback).set);
      return read.get(callback)!;
    };
    const groups = [...seen.values()].map((view) => ({
      view,
      tiles: new AnimatedTiles(view.primary, view.secondary, setOf(view.primary.header.callback), setOf(view.secondary.header.callback)),
    }));
    // 長さとコマは、描くブロックが使うタイルに当たるアニメだけで決める（ほかの組のアニメは絵を変えない）
    const sets: (TileAnimationSet | null)[] = [];
    for (const g of groups) {
      const used = addUsedTiles(g.view.primary, g.view.secondary, usedBlocks.get(g.view.key) ?? [], new Set());
      sets.push(visibleTileAnimation(g.tiles.primaryAnimation, used), visibleTileAnimation(g.tiles.secondaryAnimation, used));
    }
    const loop = tileAnimationLoop(sets, TILE_GIF_MAX_FRAMES);
    if (!loop) {
      frame.width = frame.height = 0;
      return "none";
    }
    const keyFrames = tileAnimationKeyFrames(sets, loop);
    const gif = new GifWriter(frame.width, frame.height);
    let durationCs = 0;
    // 前のコマ（画素が同じコマは足さずに前のコマを延ばす。マップに出ていないタイルだけが変わったフレームなど）
    let pending: { rgba: Uint8ClampedArray; delayCs: number } | null = null;
    const heap0 = jsHeapBytes()?.used ?? null;
    let heapMax = heap0 ?? 0;
    try {
      for (const k of keyFrames) {
        // そのフレームのタイルで描く組（写しは次の `at` で上書きされるので、コマごとに作ってすぐ描く）
        const views = new Map<string, TilesetView>();
        for (const g of groups) {
          if (!g.tiles.animated) continue;
          const at = g.tiles.at(k.frame);
          views.set(g.view.key, new TilesetView(g.view.key, at.primary, at.secondary));
        }
        const r = await this.composite.render({ ...image, ask: false, scale, tileView: (t) => views.get(t.key) ?? t });
        if (!r) return null;
        const c = frame.getContext("2d", { willReadFrequently: true })!;
        c.fillStyle = "#000";
        c.fillRect(0, 0, frame.width, frame.height);
        c.drawImage(r.canvas, 0, 0);
        r.canvas.width = 0;
        r.canvas.height = 0;
        const rgba = c.getImageData(0, 0, frame.width, frame.height).data;
        if (pending && sameBytes(pending.rgba, rgba)) pending.delayCs += k.delayCs;
        else {
          if (pending) gif.addFrame(pending.rgba, pending.delayCs * 10);
          pending = { rgba, delayCs: k.delayCs };
        }
        durationCs += k.delayCs;
        heapMax = Math.max(heapMax, jsHeapBytes()?.used ?? 0);
      }
      if (pending) gif.addFrame(pending.rgba, pending.delayCs * 10);
    } finally {
      pending = null;
      frame.width = 0;
      frame.height = 0;
      scheduleIdleGc(true);
    }
    const frames = gif.frameCount;
    // 動くタイルがマップに出ていなければ、絵は 1 枚だけになる
    if (frames <= 1) return "none";
    return {
      gif: gif.finish(),
      frames,
      width: gif.width,
      height: gif.height,
      durationCs,
      complete: loop.complete,
      frameBytes: gif.width * gif.height * 4,
      heapGrowthMb: heap0 === null ? null : Math.round(((heapMax - heap0) / 1048576) * 10) / 10,
    };
  }
}

/** 2 つの画素の並びが同じか。 */
function sameBytes(a: Uint8ClampedArray, b: Uint8ClampedArray): boolean {
  if (a.length !== b.length) return false;
  const x = new Uint32Array(a.buffer, a.byteOffset, a.length >> 2);
  const y = new Uint32Array(b.buffer, b.byteOffset, b.length >> 2);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
