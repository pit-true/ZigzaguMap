import type { PlacedEvent } from "../map/EventLayer";
import type { UiKind } from "./eventModel";

/** 選んでいるイベント 1 件（フライトポジションの番号は表の番号）。 */
export interface EventRef {
  readonly kind: UiKind;
  readonly index: number;
}

function same(a: EventRef, b: EventRef): boolean {
  return a.kind === b.kind && (a.kind === "fly" || a.index === b.index);
}

/**
 * イベントの複数選択（Phase5 #399）。Shift＋クリックで足す・外す、Shift＋ドラッグの矩形で足す。
 * 1 つだけ選んでいるときは空のまま（今までと同じく、イベントタブの種別と番号だけで選ぶ）。2 つ以上のときだけ中身を持ち、
 * イベントタブの種別と番号（欄に出すもの）はこの中の 1 つ（最後に押したもの）。
 */
export class EventSelection {
  private items: EventRef[] = [];

  /** 2 つ以上選んでいるか。 */
  get multiple(): boolean {
    return this.items.length > 1;
  }

  /** 選んでいるもの（1 つだけのときは空）。 */
  list(): readonly EventRef[] {
    return this.items;
  }

  has(ref: EventRef): boolean {
    return this.items.some((i) => same(i, ref));
  }

  clear(): void {
    this.items = [];
  }

  /**
   * `ref` を足すか外す（Shift＋クリック）。`primary` は今の 1 つの選択（まだ複数でないとき、それも選んだままにする）。
   * 戻り値は次に欄へ出すもの（外して 1 つも残らなければ null）。
   */
  toggle(ref: EventRef, primary: EventRef | null): EventRef | null {
    if (!this.multiple) this.items = primary && !same(primary, ref) ? [primary] : [];
    if (this.has(ref)) {
      this.items = this.items.filter((i) => !same(i, ref));
      const next = this.items.at(-1) ?? null;
      if (this.items.length <= 1) this.items = [];
      return next;
    }
    this.items.push(ref);
    if (this.items.length <= 1) this.items = [];
    return ref;
  }

  /** 矩形の中のものを足す（Shift＋ドラッグ）。戻り値は欄に出すもの（何も無ければ `primary`）。 */
  addAll(refs: readonly EventRef[], primary: EventRef | null): EventRef | null {
    if (refs.length === 0) return primary;
    if (!this.multiple) this.items = primary ? [primary] : [];
    for (const r of refs) if (!this.has(r)) this.items.push(r);
    if (this.items.length <= 1) this.items = [];
    return refs.at(-1)!;
  }

  /** 全部を選び直す（複製したあと、写しを選ぶ）。 */
  set(refs: readonly EventRef[]): void {
    this.items = refs.length > 1 ? [...refs] : [];
  }

  /** 無くなったもの（消した・取り消した）を外す。`exists` が false のものを外す。 */
  prune(exists: (ref: EventRef) => boolean): void {
    if (this.items.length === 0) return;
    this.items = this.items.filter(exists);
    if (this.items.length <= 1) this.items = [];
  }

  /** 画面の印（`placed`）のうち、選んでいるもの。 */
  placed(placed: readonly PlacedEvent[]): PlacedEvent[] {
    return this.items.length === 0 ? [] : placed.filter((p) => this.has(p));
  }
}

/** 矩形（両端のマスを含む）の中の印。 */
export function eventsInRect(placed: readonly PlacedEvent[], a: { x: number; y: number }, b: { x: number; y: number }): EventRef[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  return placed.filter((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1).map((p) => ({ kind: p.kind, index: p.index }));
}

/**
 * まとめて動かす量を、マップの中にあるイベントがマップの外へ出ない範囲に収める（#399）。
 * 元からマップの外にあるもの（クローンなど）は、座標が 0〜0xFFFF に収まる範囲だけを見る。
 */
export function clampGroupDelta(
  points: readonly { x: number; y: number }[],
  dx: number,
  dy: number,
  size: { width: number; height: number },
): { dx: number; dy: number } {
  let minX = -Infinity;
  let maxX = Infinity;
  let minY = -Infinity;
  let maxY = Infinity;
  for (const p of points) {
    const insideX = p.x < size.width;
    const insideY = p.y < size.height;
    minX = Math.max(minX, -p.x);
    maxX = Math.min(maxX, (insideX ? size.width - 1 : 0xffff) - p.x);
    minY = Math.max(minY, -p.y);
    maxY = Math.min(maxY, (insideY ? size.height - 1 : 0xffff) - p.y);
  }
  const clamp = (v: number, lo: number, hi: number) => (lo > hi ? 0 : Math.min(hi, Math.max(lo, v)));
  return { dx: clamp(dx, minX, maxX), dy: clamp(dy, minY, maxY) };
}

/**
 * 複製を置くマス（#399）。元の 1 マス右下を最初に試し、ふさがっている（ほかのイベントがある・マップの外）なら、
 * そこから近い順（チェビシェフ距離の輪、輪の中は上から左から）に空いたマスを探す。どこも空いていなければ右下（収めた位置）。
 * `taken` には置いたものを足していく。
 */
export function duplicatePosition(
  from: { x: number; y: number },
  size: { width: number; height: number },
  taken: Set<string>,
): { x: number; y: number } {
  const inside = (x: number, y: number) => x >= 0 && y >= 0 && x < size.width && y < size.height;
  const sx = Math.min(Math.max(from.x + 1, 0), size.width - 1);
  const sy = Math.min(Math.max(from.y + 1, 0), size.height - 1);
  const free = (x: number, y: number) => inside(x, y) && !taken.has(`${x},${y}`);
  const limit = Math.max(size.width, size.height);
  for (let r = 0; r <= limit; r++) {
    for (let y = sy - r; y <= sy + r; y++) {
      for (let x = sx - r; x <= sx + r; x++) {
        if (Math.max(Math.abs(x - sx), Math.abs(y - sy)) !== r) continue;
        if (free(x, y)) {
          taken.add(`${x},${y}`);
          return { x, y };
        }
      }
    }
  }
  return { x: sx, y: sy };
}
