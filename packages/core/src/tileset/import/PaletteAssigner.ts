/**
 * 画像からタイルとブロックを作る（Phase6 #441）: タイルごとに 15 色＋透明のパレット（本）を自動で割り当てる。DOM に依存しない。
 *
 * - 使える本は呼ぶ側が決める（書く先が副なら 7〜12、主なら 0〜6。主へ入れる副の取り込みでは主の本を読むだけ）。
 *   「空いている本」（free）は色を書いてよい本、それ以外は今の色のまま使うだけの本。
 * - 手順: 色の多いタイルから順に、色を全部含む本（今ある本を先に）→ 足しても 15 色に収まり、増える色がいちばん少ない新しい本
 *   → 新しい本を開ける。空きを超えたら、足りない本の数と本ごとのタイルの数を返す。
 * - 色番号 0 は透明。今の本の 0 番の色は変えない（新しいタイルセットでは透明色を入れる）。
 * - 収まらないときの減色（`reduceToFit`）: 全体を「空きの本 × 15 色」までメディアンカットで減らして割り当て直し、
 *   それでも収まらなければ、タイルを空きの本の数の組に分け、組ごとに 15 色へ減らす。
 */
import { TRANSPARENT } from "./ImportImage.js";
import { colorDistance, countColors, luminance, medianCut, nearestColor, remapTile } from "./Quantizer.js";

/** 1 本の色の数（0 番は透明）。 */
export const PALETTE_SIZE = 16;
/** 1 本で使える色の数。 */
export const PALETTE_COLORS = 15;
/** 数える新しい本の上限（これを超えたら、それ以上は数えない。写真のような絵で時間がかからないように）。 */
export const MAX_COUNTED_PALETTES = 64;

/** 割り当てに使える本 1 つ。 */
export interface PaletteSlotInput {
  /** 本の番号（0〜15）。 */
  readonly index: number;
  /** 今の 16 色（BGR555）。 */
  readonly colors: ArrayLike<number>;
  /** 色を書いてよい（どのブロックも指していない）か。false なら今の色のまま使うだけ。 */
  readonly free: boolean;
}

/** 割り当ての選び方。 */
export interface AssignOptions {
  /** 開けた本の 0 番に入れる色（省略で今の色のまま。新しいタイルセットでは透明色）。 */
  readonly zeroColor?: number;
}

/** 新しく開ける本 1 つ分の中身（足りないときの「本ごとのタイルの数」）。 */
export interface PaletteGroup {
  /** 色の数。 */
  readonly colors: number;
  /** その本を使うタイルの数。 */
  readonly tiles: number;
}

/** 割り当ての結果。 */
export interface PaletteAssignment {
  /** 全部のタイルに本が決まったか。 */
  readonly ok: boolean;
  /** タイルごとの本の番号（全部が透明なら -1、決まらなければ -2）。 */
  readonly tilePalettes: Int16Array;
  /** 色を書く本（本の番号 → 16 色）。 */
  readonly palettes: ReadonlyMap<number, Uint16Array>;
  /** 今の色のまま使った本。 */
  readonly fixedUsed: readonly number[];
  /** 新しく開けた本（空いている本から順に）。 */
  readonly opened: readonly number[];
  /** 要る新しい本の数（足りなくても数える。MAX_COUNTED_PALETTES を超えたら数えるのをやめ、neededAtLeast が true）。 */
  readonly needed: number;
  /** needed が下限か（数えるのをやめた）。 */
  readonly neededAtLeast: boolean;
  /** 空いている本の数。 */
  readonly available: number;
  /** 1 枚で 15 色を超えるタイルの数（減色しないと入らない）。 */
  readonly overColorTiles: number;
  /** 新しい本ごとの色とタイルの数（開けた順。足りない分も含む）。 */
  readonly groups: readonly PaletteGroup[];
  /** 使った色の数（透明を除く）。 */
  readonly colorCount: number;
}

/** タイルの色の集まり（透明を除き、小さい順）。 */
export function colorSet(tile: ArrayLike<number>): number[] {
  const set = new Set<number>();
  for (let i = 0; i < tile.length; i++) if (tile[i] !== TRANSPARENT) set.add(tile[i]!);
  return [...set].sort((a, b) => a - b);
}

interface Bin {
  colors: Set<number>;
  tiles: number[];
}

/** 色の集まりごとにタイルをまとめる（色の多い順、同じなら先に出た順）。 */
function groupSets(tiles: readonly Uint16Array[], only?: readonly number[]): { colors: number[]; tiles: number[] }[] {
  const map = new Map<string, { colors: number[]; tiles: number[]; first: number }>();
  const list = only ?? tiles.map((_, i) => i);
  for (const i of list) {
    const colors = colorSet(tiles[i]!);
    if (colors.length === 0) continue;
    const key = colors.join(",");
    const g = map.get(key);
    if (g) g.tiles.push(i);
    else map.set(key, { colors, tiles: [i], first: i });
  }
  return [...map.values()].sort((a, b) => b.colors.length - a.colors.length || a.first - b.first);
}

function slotColorSet(slot: PaletteSlotInput): Set<number> {
  const s = new Set<number>();
  for (let i = 1; i < PALETTE_SIZE; i++) s.add(slot.colors[i]! & 0x7fff);
  return s;
}

/** 新しい本へ入れる（増える色がいちばん少ない本。無ければ開ける）。`relaxed` なら 15 色を超えても入れる（減色の組分け用）。 */
function packIntoBins(bins: Bin[], colors: readonly number[], tiles: readonly number[], relaxed: boolean): boolean {
  if (!relaxed && colors.length > PALETTE_COLORS) return false;
  let best = -1;
  let bestAdd = Infinity;
  for (let b = 0; b < bins.length; b++) {
    const bin = bins[b]!;
    let add = 0;
    for (const c of colors) if (!bin.colors.has(c)) add++;
    if (bin.colors.size + add > PALETTE_COLORS) continue;
    if (add < bestAdd) {
      bestAdd = add;
      best = b;
    }
  }
  if (best < 0) bins.push({ colors: new Set(colors), tiles: [...tiles] });
  else {
    for (const c of colors) bins[best]!.colors.add(c);
    bins[best]!.tiles.push(...tiles);
  }
  return true;
}

/** 本の 16 色を作る（0 番は `zero`、1 番から明るい順、残りは今の色）。 */
function paletteOf(slot: PaletteSlotInput, colors: Iterable<number>, zero: number | undefined): Uint16Array {
  const out = Uint16Array.from({ length: PALETTE_SIZE }, (_, i) => (slot.colors[i] ?? 0) & 0x7fff);
  if (zero !== undefined) out[0] = zero & 0x7fff;
  const sorted = [...colors].sort((a, b) => luminance(a) - luminance(b) || a - b);
  sorted.forEach((c, i) => (out[i + 1] = c));
  return out;
}

/** タイルを本へ割り当てる。 */
export function assignPalettes(tiles: readonly Uint16Array[], slots: readonly PaletteSlotInput[], options: AssignOptions = {}): PaletteAssignment {
  const fixed = slots.filter((s) => !s.free).map((s) => ({ slot: s, set: slotColorSet(s) }));
  const free = slots.filter((s) => s.free);
  const tilePalettes = new Int16Array(tiles.length).fill(-1);
  const fixedUsed = new Set<number>();
  const bins: Bin[] = [];
  let overColorTiles = 0;
  let stopped = false;
  for (const g of groupSets(tiles)) {
    if (stopped) {
      for (const t of g.tiles) tilePalettes[t] = -2;
      continue;
    }
    const hit = fixed.find((f) => g.colors.every((c) => f.set.has(c)));
    if (hit) {
      for (const t of g.tiles) tilePalettes[t] = hit.slot.index;
      fixedUsed.add(hit.slot.index);
      continue;
    }
    if (!packIntoBins(bins, g.colors, g.tiles, false)) {
      overColorTiles += g.tiles.length;
      for (const t of g.tiles) tilePalettes[t] = -2;
    }
    if (bins.length > MAX_COUNTED_PALETTES) stopped = true;
  }
  return finish(tiles, tilePalettes, bins, free, [...fixedUsed], overColorTiles, options, stopped);
}

function finish(
  tiles: readonly Uint16Array[],
  tilePalettes: Int16Array,
  bins: readonly Bin[],
  free: readonly PaletteSlotInput[],
  fixedUsed: readonly number[],
  overColorTiles: number,
  options: AssignOptions,
  stopped = false,
): PaletteAssignment {
  const palettes = new Map<number, Uint16Array>();
  const opened: number[] = [];
  bins.forEach((bin, i) => {
    const slot = free[i];
    if (!slot) {
      for (const t of bin.tiles) tilePalettes[t] = -2;
      return;
    }
    opened.push(slot.index);
    palettes.set(slot.index, paletteOf(slot, bin.colors, options.zeroColor));
    for (const t of bin.tiles) tilePalettes[t] = slot.index;
  });
  const ok = !stopped && overColorTiles === 0 && bins.length <= free.length;
  return {
    ok,
    tilePalettes,
    palettes,
    fixedUsed: [...fixedUsed].sort((a, b) => a - b),
    opened,
    needed: bins.length,
    neededAtLeast: stopped,
    available: free.length,
    overColorTiles,
    groups: bins.map((b) => ({ colors: b.colors.size, tiles: b.tiles.length })),
    colorCount: countColors(tiles, TRANSPARENT).size,
  };
}

/**
 * タイルの色を、割り当てた本の色番号（0〜15）にする。透明は 0、色は 1〜15 の最初に同じ色がある番号。
 * 本に無い色は Error（割り当ての後に呼ぶ）。
 */
export function indexTile(tile: ArrayLike<number>, palette: ArrayLike<number>): Uint8Array {
  const out = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    const c = tile[i]!;
    if (c === TRANSPARENT) continue;
    let found = -1;
    for (let k = 1; k < PALETTE_SIZE; k++) {
      if ((palette[k]! & 0x7fff) === c) {
        found = k;
        break;
      }
    }
    if (found < 0) throw new Error(`色 ${c.toString(16)} が本にありません`);
    out[i] = found;
  }
  return out;
}

/** 減色の結果。 */
export interface ReduceResult {
  /** 減色したタイル（入力は変えない）。 */
  readonly tiles: Uint16Array[];
  /** 色が変わった画素の数。 */
  readonly changedPixels: number;
  /** 減らす前と後の色の数（透明を除く）。 */
  readonly colorsBefore: number;
  readonly colorsAfter: number;
  /** 減らした後の割り当て。 */
  readonly assignment: PaletteAssignment;
}

/** 組分けを、まとめる方法で行う組の数の上限（これより多ければ平均の色で分ける）。 */
const MERGE_LIMIT = 256;

/** 収まらない絵を減色して収める（空いている本が 1 本も無ければ、今ある本のいちばん近い本の色で描く）。 */
export function reduceToFit(tiles: readonly Uint16Array[], slots: readonly PaletteSlotInput[], options: AssignOptions = {}): ReduceResult {
  const work = tiles.map((t) => t.slice());
  const before = countColors(tiles, TRANSPARENT).size;
  const done = (): ReduceResult => {
    let changed = 0;
    work.forEach((t, i) => {
      const src = tiles[i]!;
      for (let k = 0; k < t.length; k++) if (t[k] !== src[k]) changed++;
    });
    return { tiles: work, changedPixels: changed, colorsBefore: before, colorsAfter: countColors(work, TRANSPARENT).size, assignment: assignPalettes(work, slots, options) };
  };
  const first = assignPalettes(work, slots, options);
  if (first.ok) return done();

  const fixed = slots.filter((s) => !s.free).map((s) => ({ slot: s, set: slotColorSet(s), list: [...slotColorSet(s)] }));
  const free = slots.filter((s) => s.free);
  // 今ある本にそのまま入るタイルは変えない
  const loose: number[] = [];
  work.forEach((t, i) => {
    const colors = colorSet(t);
    if (colors.length > 0 && !fixed.some((f) => colors.every((c) => f.set.has(c)))) loose.push(i);
  });

  if (free.length === 0) {
    // 空きが無い: タイルごとに、いちばん誤差の少ない今ある本の色で描く
    if (fixed.length === 0) return done();
    for (const i of loose) {
      const t = work[i]!;
      let best = fixed[0]!;
      let bestError = Infinity;
      for (const f of fixed) {
        let e = 0;
        for (const c of t) if (c !== TRANSPARENT) e += colorDistance(c, nearestColor(c, f.list));
        if (e < bestError) {
          bestError = e;
          best = f;
        }
      }
      remapTile(t, best.list, TRANSPARENT);
    }
    return done();
  }

  // 1. 全体を「空きの本 × 15 色」まで減らす
  const looseTiles = loose.map((i) => work[i]!);
  const weights = countColors(looseTiles, TRANSPARENT);
  if (weights.size > free.length * PALETTE_COLORS) {
    const palette = medianCut(weights, free.length * PALETTE_COLORS);
    const cache = new Map<number, number>();
    for (const t of looseTiles) remapTile(t, palette, TRANSPARENT, cache);
    if (assignPalettes(work, slots, options).ok) return done();
  }

  // 2. タイルを空きの本の数の組に分け、組ごとに 15 色へ減らす
  const groups = splitIntoGroups(work, loose, free.length);
  for (const g of groups) {
    const ts = g.map((i) => work[i]!);
    const palette = medianCut(countColors(ts, TRANSPARENT), PALETTE_COLORS);
    const cache = new Map<number, number>();
    for (const t of ts) remapTile(t, palette, TRANSPARENT, cache);
  }
  const result = done();
  if (result.assignment.ok) return result;
  // 組ごとに 15 色以下になっているので、組をそのまま本にする（貪欲な割り当てで入らなかったとき）
  const tilePalettes = new Int16Array(work.length).fill(-1);
  const fixedUsed = new Set<number>();
  work.forEach((t, i) => {
    const colors = colorSet(t);
    if (colors.length === 0) return;
    const hit = fixed.find((f) => colors.every((c) => f.set.has(c)));
    if (hit && !loose.includes(i)) {
      tilePalettes[i] = hit.slot.index;
      fixedUsed.add(hit.slot.index);
    }
  });
  const bins: Bin[] = groups.map((g) => ({ colors: new Set(g.flatMap((i) => colorSet(work[i]!))), tiles: g }));
  return { ...result, assignment: finish(work, tilePalettes, bins, free, [...fixedUsed], 0, options) };
}

/** タイル（`members` の番号）を `count` 組以下に分ける。 */
function splitIntoGroups(tiles: readonly Uint16Array[], members: readonly number[], count: number): number[][] {
  const bins: Bin[] = [];
  let many = false;
  for (const g of groupSets(tiles, members)) {
    packIntoBins(bins, g.colors, g.tiles, true);
    if (bins.length > MERGE_LIMIT) {
      many = true;
      break;
    }
  }
  if (!many && bins.length <= count) return bins.map((b) => b.tiles);
  if (!many) {
    // 小さい組から順に、合わせたときの色がいちばん少ない組へまとめる
    while (bins.length > count) {
      let small = 0;
      for (let i = 1; i < bins.length; i++) {
        const a = bins[i]!;
        const s = bins[small]!;
        if (a.colors.size < s.colors.size || (a.colors.size === s.colors.size && a.tiles.length < s.tiles.length)) small = i;
      }
      const from = bins.splice(small, 1)[0]!;
      let best = 0;
      let bestSize = Infinity;
      for (let i = 0; i < bins.length; i++) {
        let size = bins[i]!.colors.size;
        for (const c of from.colors) if (!bins[i]!.colors.has(c)) size++;
        if (size < bestSize) {
          bestSize = size;
          best = i;
        }
      }
      for (const c of from.colors) bins[best]!.colors.add(c);
      bins[best]!.tiles.push(...from.tiles);
    }
    return bins.map((b) => b.tiles);
  }
  return kMeansByMean(tiles, members, count);
}

/** タイルの平均の色で `count` 組に分ける（k-means。初めの中心は明るさの順の等分点。同じ入力なら同じ結果）。 */
function kMeansByMean(tiles: readonly Uint16Array[], members: readonly number[], count: number): number[][] {
  const means = members.map((i) => {
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (const c of tiles[i]!) {
      if (c === TRANSPARENT) continue;
      r += c & 0x1f;
      g += (c >> 5) & 0x1f;
      b += (c >> 10) & 0x1f;
      n++;
    }
    return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n];
  });
  const order = members.map((_, k) => k).sort((x, y) => lum(means[x]!) - lum(means[y]!) || x - y);
  let centers = Array.from({ length: count }, (_, j) => [...means[order[Math.floor(((j + 0.5) * order.length) / count)]!]!]);
  let assign = new Int32Array(members.length);
  for (let iter = 0; iter < 10; iter++) {
    const next = new Int32Array(members.length);
    means.forEach((m, k) => {
      let best = 0;
      let bestD = Infinity;
      centers.forEach((c, j) => {
        const d = 3 * (m[0]! - c[0]!) ** 2 + 4 * (m[1]! - c[1]!) ** 2 + 2 * (m[2]! - c[2]!) ** 2;
        if (d < bestD) {
          bestD = d;
          best = j;
        }
      });
      next[k] = best;
    });
    const same = next.every((v, k) => v === assign[k]);
    assign = next;
    const sums = centers.map(() => [0, 0, 0, 0]);
    means.forEach((m, k) => {
      const s = sums[assign[k]!]!;
      s[0]! += m[0]!;
      s[1]! += m[1]!;
      s[2]! += m[2]!;
      s[3]! += 1;
    });
    centers = sums.map((s, j) => (s[3]! > 0 ? [s[0]! / s[3]!, s[1]! / s[3]!, s[2]! / s[3]!] : centers[j]!));
    if (same && iter > 0) break;
  }
  const out: number[][] = centers.map(() => []);
  members.forEach((t, k) => out[assign[k]!]!.push(t));
  return out.filter((g) => g.length > 0);
}

function lum(m: readonly number[]): number {
  return m[0]! * 299 + m[1]! * 587 + m[2]! * 114;
}
