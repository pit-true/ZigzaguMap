import { blockDiffer, findSeamIssues, type MapDocument, type MapId, type SeamIssue, type SeamNeighbor } from "@zigzagumap/core";
import type { EditorState } from "../EditorState";
import { TilesetView } from "../TilesetView";
import { tilesetRefsOf } from "../../windows/tilesetRefs";
import { scheduleIdleGc } from "../../util/idleGc";

/** 点検の結果（自動操作の `seams.state`）。 */
export interface SeamState {
  readonly map: MapId | null;
  readonly done: boolean;
  readonly issues: readonly SeamIssue[];
}

/**
 * 接続の境目の点検（#305）。表示中のマップの上下左右の接続のうち、相手のタイルセットの組が違うものについて、
 * 境目から見える範囲（横 8・縦 6 マス）で相手のブロックがこちらの組では違う絵になるマスを数える。
 * - マップを出したあとの待ち時間に調べる（切り替えの時間に入らない）。組が同じ接続はタイルセットを読まない。
 * - 相手のタイルセットは調べる間だけ読み、終わったら捨てる（開いている組のキャッシュに入っていればそれを使う）。
 * - 接続・相手のマップ・タイルセットが変わったら調べ直す。結果が変わったら `onChange` の関数を呼ぶ。
 */
export class SeamWarnings {
  private result: SeamState = { map: null, done: true, issues: [] };
  private token = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private signature = "";
  private unsubscribeBus: (() => void) | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly state: EditorState) {
    state.on("session", () => {
      this.unsubscribeBus?.();
      this.unsubscribeBus = state.session?.bus.subscribe((e) => {
        if (tilesetRefsOf(e.command).length > 0) this.schedule();
      }) ?? null;
      this.schedule();
    });
    state.on("map", () => this.schedule());
    // 主マップの接続・大きさが変わったとき（描くたびには調べ直さない）
    state.on("cells", () => {
      if (this.mainSignature() !== this.signature) this.schedule();
    });
    state.on("otherMaps", () => {
      const doc = state.map?.doc;
      if (doc && state.changedMaps.some((id) => (doc.connections ?? []).some((c) => c.bank === id.bank && c.map === id.map))) this.schedule();
    });
  }

  /** 今の結果。 */
  get current(): SeamState {
    return this.result;
  }

  /** 結果が変わったときに呼ぶ関数を足す。 */
  onChange(listener: () => void): void {
    this.listeners.add(listener);
  }

  /** 調べ終えるまで待つ（自動操作用）。 */
  async settle(timeoutMs = 5000): Promise<void> {
    const t0 = performance.now();
    while (!this.result.done && performance.now() - t0 < timeoutMs) await new Promise((r) => setTimeout(r, 10));
  }

  private mainSignature(): string {
    const doc = this.state.map?.doc;
    if (!doc) return "";
    return `${doc.width}x${doc.height}:${(doc.connections ?? []).map((c) => `${c.direction},${c.offset},${c.bank},${c.map}`).join(";")}`;
  }

  private schedule(): void {
    const token = ++this.token;
    this.result = { map: this.state.map?.id ?? null, done: false, issues: this.result.issues };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check(token).catch(() => token === this.token && this.finish([]));
    }, 0);
  }

  private async check(token: number): Promise<void> {
    const session = this.state.session;
    const main = this.state.map;
    if (!session || !main) return this.finish([]);
    const doc = main.doc;
    this.signature = this.mainSignature();
    const neighbors: (SeamNeighbor | null)[] = [];
    const temporary = new Map<string, TilesetView>();
    for (const c of doc.connections ?? []) {
      let n: SeamNeighbor | null = null;
      if (c.direction >= 1 && c.direction <= 4) {
        const id = { bank: c.bank, map: c.map };
        const nd: MapDocument | null = session.project.loaded(id) ?? (await session.project.peek(id).catch(() => null));
        if (token !== this.token) return;
        const key = nd ? `${nd.primaryTileset >>> 0}:${nd.secondaryTileset >>> 0}` : null;
        if (nd && key !== main.tiles.key) {
          let tiles = session.cachedTiles(key!) ?? temporary.get(key!);
          if (!tiles) {
            const t = await session.project.peekTilesets(nd).catch(() => null);
            if (token !== this.token) return;
            if (t) {
              tiles = new TilesetView(key!, t.primary, t.secondary);
              temporary.set(key!, tiles);
            }
          }
          if (tiles) n = { grid: nd.grid, differs: blockDiffer(main.tiles.renderer, tiles.renderer) };
        }
      }
      neighbors.push(n);
    }
    const issues = findSeamIssues({ width: doc.width, height: doc.height, connections: doc.connections }, (_c, i) => neighbors[i] ?? null);
    // 調べるために読んだタイルセットは捨て、落ち着いたら空いた領域も OS へ返す
    if (temporary.size > 0) scheduleIdleGc(true);
    temporary.clear();
    if (token === this.token) this.finish(issues);
  }

  private finish(issues: SeamIssue[]): void {
    this.result = { map: this.state.map?.id ?? null, done: true, issues };
    for (const l of this.listeners) l();
  }
}
