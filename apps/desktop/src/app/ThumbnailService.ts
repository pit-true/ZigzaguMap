import { BlockRenderer, THUMBNAIL_SIZE, blockAverageColors, renderThumbnail, type MapId } from "@zigzagumap/core";
import { scheduleIdleGc } from "../util/idleGc";
import type { EditorState } from "./EditorState";
import { TilesetView } from "./TilesetView";

/** ROM を開いてマップを出してから、作り始めるまでの待ち（起動からマップ表示までの時間に影響させない）。 */
const START_DELAY_MS = 1500;
/** 1 回の待ち時間に作り続ける長さ（画面を止めない）。 */
const SLICE_MS = 12;
/** 作っている間に持つタイルセットの組の数（使い終えたら捨てる）。 */
const TILESET_CACHE = 4;
/** 編集したマップの縮小を作り直すまでの待ち。 */
const UPDATE_DELAY_MS = 1000;

/** 作り具合（自動操作の `thumbs.state`）。 */
export interface ThumbnailState {
  readonly enabled: boolean;
  readonly running: boolean;
  /** 作り終えたマップの数（配置が同じマップは 1 枚を使い回すので、作った絵の数 `images` より多い）。 */
  readonly maps: number;
  readonly images: number;
  /** 全部を作り終えるのにかかった時間（ミリ秒。作り直しの最中や作っていなければ null）。 */
  readonly ms: number | null;
}

const keyOf = (id: MapId): string => `${id.bank}.${id.map}`;

/**
 * マップ一覧のサムネイル（#315。Bochi のマップ一覧の縮小。Q13 の推奨で、設定のチェック・既定オフ）。
 * - オンのときだけ、マップ一覧で開いている枝に見えているマップの分を作る（`setWanted`。枝を閉じたら、その分は捨てる）。
 *   ROM を開いてマップを出したあとの待ち時間に、選んでいるマップの近く（一覧の番号の順で近いもの）から順に作る。
 * - 1 枚は RGB565 で 48×48×2 バイト。配置（レイアウト）が同じマップは 1 枚を使い回す。3 層のブロックも描いた絵の色で作る。
 * - タイルセットは作る間だけ読み（開いている組はそのまま使う）、作り終えたら捨てる。
 * - オフにすると、作ったものを全部捨てる。編集したマップは少し待ってから作り直す。
 */
export class ThumbnailService {
  /** 縮小（RGB565 の 16 ビットで持つ。行に描くときだけ ImageData にする。メモリを半分にするため）。 */
  private readonly images = new Map<string, Uint16Array>();
  /** マップ → 使い回す絵の鍵（配置の番号か、マップそのもの）。 */
  private readonly shared = new Map<string, string>();
  private readonly byShare = new Map<string, Uint16Array>();
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private updateTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastMs: number | null = null;
  private startedForSession: unknown = null;
  /** 作る対象（一覧で見えているマップ）。 */
  private wanted = new Map<string, MapId>();
  /** 読めなかったマップ（作り直しを繰り返さない。ROM を開き直すかオフにすると忘れる）。 */
  private readonly failed = new Set<string>();

  constructor(
    private readonly state: EditorState,
    /** 1 枚できた（そのマップの行を描き直す。全部描き直すときは null）。 */
    private readonly onReady: (id: MapId | null) => void,
  ) {
    state.on("session", () => {
      this.clear();
      this.startedForSession = null;
    });
    state.on("map", () => {
      if (!this.enabled || !state.map || this.startedForSession === state.session) return;
      this.startedForSession = state.session;
      this.schedule(START_DELAY_MS);
    });
    state.on("view", () => {
      if (this.enabled && !this.running && this.timer === null && this.images.size === 0 && state.map) {
        // オンにしたときは待たずに作る（以後、枝を開いた分もすぐ作る）
        this.startedForSession = state.session;
        if (this.wanted.size > 0) this.schedule(0);
      } else if (!this.enabled && (this.images.size > 0 || this.running)) {
        this.clear();
        onReady(null);
      }
    });
    state.on("cells", () => this.mapEdited());
  }

  /**
   * 作る対象（マップ一覧で開いている枝に見えているマップ）を変える。対象から外れたマップの縮小は捨て、
   * 増えた分は（ROM を開いたあとの待ちが済んでいれば）すぐ作り始める。
   */
  setWanted(ids: readonly MapId[]): void {
    const next = new Map(ids.map((id) => [keyOf(id), id] as const));
    let dropped = false;
    for (const k of [...this.images.keys()]) {
      if (next.has(k)) continue;
      this.drop(k);
      dropped = true;
    }
    const added = [...next.keys()].some((k) => !this.wanted.has(k));
    this.wanted = next;
    if (dropped) scheduleIdleGc(true);
    if (!this.enabled || !added || !this.state.map || this.startedForSession !== this.state.session) return;
    // 作っている最中なら、続きで新しい対象も作る（`run` は対象を毎回見直す）
    if (!this.running && this.timer === null) this.schedule(0);
  }

  /** そのマップの縮小を捨てる（配置を共有している最後のマップなら絵も捨てる）。 */
  private drop(k: string): void {
    const share = this.shared.get(k);
    this.images.delete(k);
    this.shared.delete(k);
    if (share === undefined) return;
    for (const s of this.shared.values()) if (s === share) return;
    this.byShare.delete(share);
  }

  /** 設定でオンか。 */
  get enabled(): boolean {
    return this.state.settings.data.treeThumbnails;
  }

  /** そのマップの縮小（まだ無ければ null）。 */
  get(id: MapId): ImageData | null {
    if (!this.enabled) return null;
    const packed = this.images.get(keyOf(id));
    return packed ? unpack565(packed) : null;
  }

  /** 作り具合。 */
  status(): ThumbnailState {
    return { enabled: this.enabled, running: this.running || this.timer !== null, maps: this.images.size, images: this.byShare.size, ms: this.lastMs };
  }

  /** 作り終えるまで待つ（自動操作用）。 */
  async settle(timeoutMs = 60000): Promise<void> {
    const t0 = performance.now();
    while ((this.running || this.timer !== null) && performance.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 50));
  }

  /** 次に作るマップ（対象のうちまだ無いもので、選んでいるマップに一覧の番号の順でいちばん近いもの）。無ければ null。 */
  private next(ids: readonly MapId[]): MapId | null {
    const current = this.state.map?.id;
    const at = current ? Math.max(0, ids.findIndex((i) => i.bank === current.bank && i.map === current.map)) : 0;
    let best: MapId | null = null;
    let bestD = Infinity;
    for (let i = 0; i < ids.length; i++) {
      const id = ids[i]!;
      const k = keyOf(id);
      if (!this.wanted.has(k) || this.images.has(k) || this.failed.has(k)) continue;
      const d = Math.abs(i - at);
      if (d < bestD) {
        best = id;
        bestD = d;
      }
    }
    return best;
  }

  private clear(): void {
    this.token++;
    this.failed.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.running = false;
    const had = this.images.size > 0;
    this.images.clear();
    this.shared.clear();
    this.byShare.clear();
    this.lastMs = null;
    if (had) scheduleIdleGc(true);
  }

  private schedule(delay: number): void {
    if (this.timer) clearTimeout(this.timer);
    const token = ++this.token;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.run(token);
    }, delay);
  }

  /** 表示中のマップを編集したら、少し待ってからその縮小を作り直す。 */
  private mapEdited(): void {
    const id = this.state.map?.id;
    if (!this.enabled || !id || !this.images.has(keyOf(id))) return;
    if (this.updateTimer) clearTimeout(this.updateTimer);
    this.updateTimer = setTimeout(() => {
      this.updateTimer = null;
      const k = keyOf(id);
      const share = this.shared.get(k);
      // 配置を共有しているマップも同じ絵なので、まとめて作り直す
      for (const [m, s] of this.shared) {
        if (s !== share) continue;
        this.images.delete(m);
        this.shared.delete(m);
      }
      if (share) this.byShare.delete(share);
      if (!this.running) this.schedule(0);
    }, UPDATE_DELAY_MS);
  }

  /** 近い順に作る。 */
  private async run(token: number): Promise<void> {
    const session = this.state.session;
    if (!session || !this.enabled) return;
    this.running = true;
    const t0 = performance.now();
    const project = session.project;
    const tiles = new Map<string, Uint8Array>();
    let slice = performance.now();
    let made = false;
    try {
      // 対象は作っている間にも変わる（枝を開閉したとき）ので、1 枚ごとに残りから選び直す
      for (let id = this.next(project.mapIds()); id; id = this.next(project.mapIds())) {
        if (token !== this.token) return;
        const k = keyOf(id);
        const info = session.catalog.get(id);
        // 配置が同じマップ（ベース ROM のまま、同じ配置の番号）は 1 枚を使い回す
        const share = info && project.inBase(id) && !project.hasJson(id) && !project.loaded(id) && info.layoutId > 0 ? `layout:${info.layoutId}` : `map:${k}`;
        let image = this.byShare.get(share);
        if (!image) {
          const doc = project.loaded(id) ?? (await project.peek(id).catch(() => null));
          if (token !== this.token) return;
          if (!doc) {
            this.failed.add(k);
            continue;
          }
          const tilesKey = `${doc.primaryTileset >>> 0}:${doc.secondaryTileset >>> 0}`;
          let colors = tiles.get(tilesKey);
          if (!colors) {
            let view = session.cachedTiles(tilesKey) ?? null;
            if (!view) {
              const pair = await project.peekTilesets(doc).catch(() => null);
              if (token !== this.token) return;
              if (!pair) {
                this.failed.add(k);
                continue;
              }
              view = new TilesetView(tilesKey, pair.primary, pair.secondary);
            }
            // 色を取るためだけの描き手を作る（開いている組の描き手のキャッシュに、全部のブロックの絵を残さない）
            colors = blockAverageColors(new BlockRenderer(view.primary, view.secondary), view.paletteBlockCount);
            tiles.set(tilesKey, colors);
            while (tiles.size > TILESET_CACHE) tiles.delete(tiles.keys().next().value!);
          }
          const rgba = renderThumbnail(doc.grid, colors, THUMBNAIL_SIZE);
          image = pack565(rgba.data);
          this.byShare.set(share, image);
          made = true;
        }
        // 待っている間に対象から外れたなら持たない
        if (!this.wanted.has(k)) {
          if (![...this.shared.values()].includes(share)) this.byShare.delete(share);
          continue;
        }
        this.images.set(k, image);
        this.shared.set(k, share);
        this.onReady(id);
        if (performance.now() - slice > SLICE_MS) {
          await new Promise((r) => setTimeout(r, 0));
          slice = performance.now();
        }
      }
      if (token === this.token) this.lastMs = performance.now() - t0;
    } finally {
      if (token === this.token) this.running = false;
      tiles.clear();
      // 作る間だけ読んだタイルセットと、ブロックの絵のごみを片付ける
      if (made) scheduleIdleGc(true);
    }
  }
}

/** RGBA を RGB565 にする（透明の画素は 0。縮小の色は 0 にならないよう 1 にする）。 */
export function pack565(rgba: Uint8ClampedArray): Uint16Array {
  const out = new Uint16Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) {
    const o = i * 4;
    if (rgba[o + 3] === 0) continue;
    const v = ((rgba[o]! >> 3) << 11) | ((rgba[o + 1]! >> 2) << 5) | (rgba[o + 2]! >> 3);
    out[i] = v === 0 ? 1 : v;
  }
  return out;
}

/** RGB565 を 48×48 の ImageData にする（0 は透明）。 */
export function unpack565(packed: Uint16Array): ImageData {
  const image = new ImageData(THUMBNAIL_SIZE, THUMBNAIL_SIZE);
  const d = image.data;
  for (let i = 0; i < packed.length; i++) {
    const v = packed[i]!;
    if (v === 0) continue;
    const o = i * 4;
    d[o] = ((v >> 11) & 31) * 255 / 31;
    d[o + 1] = ((v >> 5) & 63) * 255 / 63;
    d[o + 2] = (v & 31) * 255 / 31;
    d[o + 3] = 255;
  }
  return image;
}
