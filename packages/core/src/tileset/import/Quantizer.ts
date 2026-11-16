/**
 * 画像からタイルとブロックを作る（Phase6 #441）: 減色の計算。DOM に依存しない。外の部品は使わない。
 *
 * 色はどれも BGR555（0〜0x7FFF）。減色は重みつきのメディアンカット（画素の数を重みにして、範囲がいちばん広い成分で、
 * 重みが半分になる所で箱を割る）。近い色は、緑を重く青を軽く見た距離で選ぶ。
 */

/** BGR555 の成分（0〜31）。 */
export function channels(color: number): [number, number, number] {
  return [color & 0x1f, (color >> 5) & 0x1f, (color >> 10) & 0x1f];
}

/** 成分から BGR555 を作る。 */
export function fromChannels(r: number, g: number, b: number): number {
  return (r & 0x1f) | ((g & 0x1f) << 5) | ((b & 0x1f) << 10);
}

/** 2 色の距離（緑を重く、青を軽く見る）。 */
export function colorDistance(a: number, b: number): number {
  const dr = (a & 0x1f) - (b & 0x1f);
  const dg = ((a >> 5) & 0x1f) - ((b >> 5) & 0x1f);
  const db = ((a >> 10) & 0x1f) - ((b >> 10) & 0x1f);
  return 3 * dr * dr + 4 * dg * dg + 2 * db * db;
}

/** 明るさ（並べる順に使う）。 */
export function luminance(color: number): number {
  const [r, g, b] = channels(color);
  return r * 299 + g * 587 + b * 114;
}

/** `palette` のうち `color` にいちばん近い色（同じ距離なら先のもの）。 */
export function nearestColor(color: number, palette: readonly number[]): number {
  let best = palette[0] ?? color;
  let bestDistance = Infinity;
  for (const c of palette) {
    const d = colorDistance(color, c);
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
      if (d === 0) break;
    }
  }
  return best;
}

interface Box {
  colors: number[];
  weight: number;
  /** いちばん広い成分（0 r、1 g、2 b）とその範囲。 */
  axis: number;
  range: number;
}

function makeBox(colors: number[], weights: ReadonlyMap<number, number>): Box {
  const lo = [31, 31, 31];
  const hi = [0, 0, 0];
  let weight = 0;
  for (const c of colors) {
    const ch = channels(c);
    for (let i = 0; i < 3; i++) {
      lo[i] = Math.min(lo[i]!, ch[i]!);
      hi[i] = Math.max(hi[i]!, ch[i]!);
    }
    weight += weights.get(c) ?? 0;
  }
  let axis = 0;
  for (let i = 1; i < 3; i++) if (hi[i]! - lo[i]! > hi[axis]! - lo[axis]!) axis = i;
  return { colors, weight, axis, range: hi[axis]! - lo[axis]! };
}

/**
 * 重みつきのメディアンカットで `k` 色以下にする。色が `k` 以下ならそのまま返す（明るい順）。
 * 返す色は、箱ごとの重みつきの平均（5 ビットに丸める）。同じ入力なら同じ結果になる。
 */
export function medianCut(weights: ReadonlyMap<number, number>, k: number): number[] {
  const all = [...weights.keys()].sort((a, b) => a - b);
  if (k <= 0 || all.length === 0) return [];
  if (all.length <= k) return all.sort((a, b) => luminance(a) - luminance(b) || a - b);
  const boxes: Box[] = [makeBox(all, weights)];
  while (boxes.length < k) {
    // 範囲がいちばん広い箱（同じなら重い方）を割る
    let pick = -1;
    for (let i = 0; i < boxes.length; i++) {
      const b = boxes[i]!;
      if (b.colors.length < 2) continue;
      if (pick < 0 || b.range > boxes[pick]!.range || (b.range === boxes[pick]!.range && b.weight > boxes[pick]!.weight)) pick = i;
    }
    if (pick < 0) break;
    const box = boxes[pick]!;
    const sorted = [...box.colors].sort((a, b) => channels(a)[box.axis]! - channels(b)[box.axis]! || a - b);
    let acc = 0;
    let cut = 1;
    for (let i = 0; i < sorted.length - 1; i++) {
      acc += weights.get(sorted[i]!) ?? 0;
      cut = i + 1;
      if (acc * 2 >= box.weight) break;
    }
    boxes.splice(pick, 1, makeBox(sorted.slice(0, cut), weights), makeBox(sorted.slice(cut), weights));
  }
  const out = new Set<number>();
  for (const b of boxes) {
    let r = 0;
    let g = 0;
    let bl = 0;
    let w = 0;
    for (const c of b.colors) {
      const cw = Math.max(1, weights.get(c) ?? 0);
      const ch = channels(c);
      r += ch[0] * cw;
      g += ch[1] * cw;
      bl += ch[2] * cw;
      w += cw;
    }
    out.add(fromChannels(Math.round(r / w), Math.round(g / w), Math.round(bl / w)));
  }
  return [...out].sort((a, b) => luminance(a) - luminance(b) || a - b);
}

/** 色ごとの画素の数を数える（`skip` の色は数えない）。 */
export function countColors(tiles: readonly Uint16Array[], skip: number): Map<number, number> {
  const out = new Map<number, number>();
  for (const t of tiles) for (const c of t) if (c !== skip) out.set(c, (out.get(c) ?? 0) + 1);
  return out;
}

/** タイルの色を `palette` のいちばん近い色に置き換える（`skip` の色はそのまま）。変わった画素の数を返す。 */
export function remapTile(tile: Uint16Array, palette: readonly number[], skip: number, cache = new Map<number, number>()): number {
  let changed = 0;
  for (let i = 0; i < tile.length; i++) {
    const c = tile[i]!;
    if (c === skip) continue;
    let n = cache.get(c);
    if (n === undefined) {
      n = nearestColor(c, palette);
      cache.set(c, n);
    }
    if (n !== c) {
      tile[i] = n;
      changed++;
    }
  }
  return changed;
}
