/**
 * イベントの貼り付け（Phase7 #519）の置く位置の計算。コピーしたイベントの互いの位置を保ったまま、押したマスを左上（コピーした
 * ものの左上）にして置く。どれかがマップの外になる・同じ種類のイベントと同じマスに重なるときは、全部を置かない。
 */

/** 貼り付けるイベントの種類（フライトポジションは写さない）。 */
export type PasteKind = "person" | "warp" | "trap" | "sign";

/** 写したイベント 1 つの、コピーしたものの左上からのずれ。 */
export interface PasteItem {
  readonly kind: PasteKind;
  readonly dx: number;
  readonly dy: number;
}

/** 置けなかった理由。 */
export type PasteRefusal =
  /** マップの外になる。 */
  | { readonly reason: "outside"; readonly item: number; readonly x: number; readonly y: number }
  /** 同じ種類のイベントと同じマスに重なる。 */
  | { readonly reason: "overlap"; readonly item: number; readonly x: number; readonly y: number };

/** 置く位置（items と同じ並び）か、置けない理由。 */
export type PastePlacement = { readonly ok: true; readonly positions: readonly { readonly x: number; readonly y: number }[] } | ({ readonly ok: false } & PasteRefusal);

/** 写したイベントの位置から、左上の位置とずれを作る。 */
export function pasteItems(events: readonly { readonly kind: PasteKind; readonly x: number; readonly y: number }[]): { readonly items: PasteItem[]; readonly left: number; readonly top: number } {
  const left = Math.min(...events.map((e) => e.x));
  const top = Math.min(...events.map((e) => e.y));
  return { items: events.map((e) => ({ kind: e.kind, dx: e.x - left, dy: e.y - top })), left, top };
}

/**
 * (x, y) を左上にして置く位置を決める。occupied は貼る先のマップの種類ごとのイベントの位置。
 * 写したもの同士で同じ種類が同じマスになるときも重なりとする。
 */
export function placePaste(
  items: readonly PasteItem[],
  x: number,
  y: number,
  map: { readonly width: number; readonly height: number; readonly occupied: Readonly<Record<PasteKind, readonly { readonly x: number; readonly y: number }[]>> },
): PastePlacement {
  const taken: Record<PasteKind, Set<string>> = { person: new Set(), warp: new Set(), trap: new Set(), sign: new Set() };
  for (const kind of Object.keys(taken) as PasteKind[]) for (const p of map.occupied[kind]) taken[kind].add(`${p.x},${p.y}`);
  const positions: { x: number; y: number }[] = [];
  for (const [i, item] of items.entries()) {
    const px = x + item.dx, py = y + item.dy;
    if (px < 0 || py < 0 || px >= map.width || py >= map.height) return { ok: false, reason: "outside", item: i, x: px, y: py };
    const key = `${px},${py}`;
    if (taken[item.kind].has(key)) return { ok: false, reason: "overlap", item: i, x: px, y: py };
    taken[item.kind].add(key);
    positions.push({ x: px, y: py });
  }
  return { ok: true, positions };
}
