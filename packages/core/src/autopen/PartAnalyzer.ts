import { edgeSlotOf } from "./EdgeSolver.js";
import { EDGE_INNER_SLOTS, EDGE_OUTER_SLOTS, gridOf, singleGrid, type AutoPenPart, type PartGrid } from "./types.js";

/**
 * マップからオートペンのパーツの候補を作る（#313）。主タイルセットが同じ全マップの並びと挙動から作り、名前は「自動: 」で始める。
 * - 草むら・水・段差は挙動（属性の下位 9 ビット）で決める。
 * - 水の縁は、水のブロック（C）に 8 方向で隣り合うブロックごとに、周りが水のまとまりかどうかを数え、
 *   多数決で縁つきの枠（NW〜SE・内角）に当てはめる。
 * - 地面と森は、2×2 の並びがくり返し現れるもの（右と下にも同じ並びが続くもの）を探す。通れれば地面、通れなければ森。
 * - 建物と飾りは、通れない（移動許可の衝突のビットが立つ）マスのかたまり。下の辺にワープがあれば建物。
 * 途中の表は関数の中だけで持ち、終わったら捨てる（呼んだ側は結果のパーツだけを持つ）。
 */

/** 解析する 1 枚。 */
export interface AnalyzeLayout {
  readonly width: number;
  readonly height: number;
  /** 配置（u16。ブロックと移動許可）。 */
  readonly cells: Uint16Array;
  /** ワープの位置。 */
  readonly warps?: readonly { readonly x: number; readonly y: number }[];
}

/** 解析の入力。 */
export interface AnalyzeInput {
  readonly layouts: readonly AnalyzeLayout[];
  /** ブロックの挙動（属性の下位 9 ビット）。 */
  behavior(block: number): number;
  /** 解析するブロックの範囲（主タイルセットだけなら 0x280）。これ以上の番号は使わない。 */
  readonly blockLimit?: number;
}

const GRASS = new Set([0x02, 0x03]);
const WATER = new Set([0x10, 0x11, 0x12, 0x15, 0x16, 0x17]);
const JUMPS: ReadonlyMap<number, string> = new Map([
  [0x3b, "下"],
  [0x38, "右"],
  [0x39, "左"],
  [0x3a, "上"],
]);
/** 縁つきの枠に当てはめるのに要る、その枠への票の割合。 */
const SLOT_SHARE = 0.6;
/** 水の縁とみなすのに要る、水に隣り合う割合。 */
const ADJACENT_SHARE = 0.5;
/** 候補にするのに要る使用回数。 */
const MIN_USES = 4;

function blockOf(v: number): number {
  return v & 0x3ff;
}
function blocked(v: number): boolean {
  return ((v >> 10) & 0x3) !== 0;
}

/** 使用回数と、いちばん多い移動許可。 */
function usageTable(input: AnalyzeInput): { count: Map<number, number>; movement: Map<number, number> } {
  const per = new Map<number, Map<number, number>>();
  for (const l of input.layouts) {
    for (const v of l.cells) {
      const b = blockOf(v);
      let m = per.get(b);
      if (!m) per.set(b, (m = new Map()));
      m.set(v >> 10, (m.get(v >> 10) ?? 0) + 1);
    }
  }
  const count = new Map<number, number>();
  const movement = new Map<number, number>();
  for (const [b, m] of per) {
    let n = 0;
    let best = 0;
    let bestN = -1;
    for (const [mv, c] of m) {
      n += c;
      if (c > bestN) {
        best = mv;
        bestN = c;
      }
    }
    count.set(b, n);
    movement.set(b, best);
  }
  return { count, movement };
}

/** 候補を作る。 */
export function analyzeParts(input: AnalyzeInput): AutoPenPart[] {
  const limit = input.blockLimit ?? 0x400;
  const { count, movement } = usageTable(input);
  const used = [...count.entries()].filter(([b, n]) => b < limit && n >= MIN_USES).sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  const parts: AutoPenPart[] = [];
  const add = (p: Omit<AutoPenPart, "order">) => parts.push({ ...p, order: parts.length });

  // 草むら
  const grass = used.filter(([b]) => GRASS.has(input.behavior(b) & 0xff)).slice(0, 4);
  if (grass.length > 0) add({ name: "自動: 草むら", kind: "fill", role: "grass", slots: { Blocks: gridOf(grass.length, 1, grass.map(([b]) => b), grass.map(([b]) => movement.get(b) ?? null)) } });

  // 水の縁
  const taken = new Set<number>(grass.map(([b]) => b));
  const waters = used.filter(([b]) => WATER.has(input.behavior(b) & 0xff));
  let waterN = 0;
  for (const [c] of waters) {
    if (taken.has(c) || waterN >= 3) continue;
    const edge = analyzeEdge(input, c, limit, taken);
    if (!edge) continue;
    waterN++;
    const slots: Record<string, PartGrid> = { C: singleGrid(c, movement.get(c) ?? null) };
    for (const [slot, b] of edge) slots[slot] = singleGrid(b, movement.get(b) ?? null);
    for (const b of [c, ...edge.values()]) taken.add(b);
    add({ name: `自動: 水 ${hex3(c)}`, kind: "edge", role: "water", slots });
  }

  // 段差
  for (const [beh, dir] of JUMPS) {
    const list = used.filter(([b]) => (input.behavior(b) & 0xff) === beh && !taken.has(b)).slice(0, 3);
    if (list.length === 0) continue;
    for (const [b] of list) taken.add(b);
    add({ name: `自動: 段差（${dir}へ跳ぶ）`, kind: "fill", role: "cliff", slots: { Blocks: gridOf(list.length, 1, list.map(([b]) => b), list.map(([b]) => movement.get(b) ?? null)) } });
  }

  // 地面と森（2×2 のくり返し）
  for (const r of analyzeRepeats(input, limit, taken)) {
    add(r);
    for (const g of Object.values(r.slots)) for (const c of g.cells) if (c) taken.add(c.block);
  }

  // 建物と飾り
  for (const p of analyzeClusters(input, limit, taken)) add(p);
  return parts;
}

function hex3(n: number): string {
  return n.toString(16).toUpperCase().padStart(3, "0");
}

/** 水 `c` の縁のブロックを枠に当てはめる（枠 → ブロック）。足りなければ null。 */
function analyzeEdge(input: AnalyzeInput, c: number, limit: number, taken: ReadonlySet<number>): Map<string, number> | null {
  // 1. 水に 8 方向で隣り合う割合
  const adj = new Map<number, { near: number; all: number }>();
  for (const l of input.layouts) {
    const { width: w, height: h, cells } = l;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const b = blockOf(cells[y * w + x]!);
        if (b === c || b >= limit) continue;
        let e = adj.get(b);
        if (!e) adj.set(b, (e = { near: 0, all: 0 }));
        e.all++;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < w && ny < h && blockOf(cells[ny * w + nx]!) === c) {
              near = true;
              break;
            }
          }
        }
        if (near) e.near++;
      }
    }
  }
  const shore = new Set<number>();
  for (const [b, e] of adj) if (e.near >= MIN_USES && e.near / e.all >= ADJACENT_SHARE && !taken.has(b)) shore.add(b);
  if (shore.size === 0) return null;
  // 2. 縁のブロックごとに、周りがまとまり（水か縁）かで枠を数える（マップの外は同じ）
  const votes = new Map<number, Map<string, number>>();
  for (const l of input.layouts) {
    const { width: w, height: h, cells } = l;
    const inside = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return true;
      const b = blockOf(cells[y * w + x]!);
      return b === c || shore.has(b);
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const b = blockOf(cells[y * w + x]!);
        if (!shore.has(b)) continue;
        const slot = edgeSlotOf({
          n: inside(x, y - 1),
          s: inside(x, y + 1),
          w: inside(x - 1, y),
          e: inside(x + 1, y),
          nw: inside(x - 1, y - 1),
          ne: inside(x + 1, y - 1),
          sw: inside(x - 1, y + 1),
          se: inside(x + 1, y + 1),
        });
        let m = votes.get(b);
        if (!m) votes.set(b, (m = new Map()));
        m.set(slot, (m.get(slot) ?? 0) + 1);
      }
    }
  }
  // 3. 枠ごとに、その枠への票がいちばん多いブロック（票の 6 割以上がその枠のもの）
  const best = new Map<string, { block: number; n: number }>();
  for (const [b, m] of votes) {
    let total = 0;
    let top = "";
    let topN = 0;
    for (const [s, n] of m) {
      total += n;
      if (n > topN) {
        top = s;
        topN = n;
      }
    }
    if (top === "thin" || top === "C" || topN / total < SLOT_SHARE) continue;
    const cur = best.get(top);
    if (!cur || topN > cur.n) best.set(top, { block: b, n: topN });
  }
  const out = new Map<string, number>();
  for (const s of [...EDGE_OUTER_SLOTS, ...EDGE_INNER_SLOTS]) {
    const e = best.get(s);
    if (e) out.set(s, e.block);
  }
  // 辺 4 つがそろわなければ縁つきにしない
  return ["N", "S", "W", "E"].every((s) => out.has(s)) ? out : null;
}

/** 2×2 のくり返し（地面・森）。 */
function analyzeRepeats(input: AnalyzeInput, limit: number, taken: ReadonlySet<number>): Omit<AutoPenPart, "order">[] {
  const counts = new Map<string, { n: number; blocks: number[]; walk: number }>();
  for (const l of input.layouts) {
    const { width: w, height: h, cells } = l;
    const at = (x: number, y: number) => blockOf(cells[y * w + x]!);
    for (let y = 0; y + 3 < h; y++) {
      for (let x = 0; x + 3 < w; x++) {
        const a = [at(x, y), at(x + 1, y), at(x, y + 1), at(x + 1, y + 1)];
        if (a.some((b) => b >= limit || taken.has(b))) continue;
        if (new Set(a).size < 2) continue;
        // 右と下に同じ並びが続くか
        const right = at(x + 2, y) === a[0] && at(x + 3, y) === a[1] && at(x + 2, y + 1) === a[2] && at(x + 3, y + 1) === a[3];
        const down = at(x, y + 2) === a[0] && at(x + 1, y + 2) === a[1] && at(x, y + 3) === a[2] && at(x + 1, y + 3) === a[3];
        if (!right || !down) continue;
        const key = a.join(",");
        let e = counts.get(key);
        if (!e) counts.set(key, (e = { n: 0, blocks: a, walk: 0 }));
        e.n++;
        if (!blocked(cells[y * w + x]!)) e.walk++;
      }
    }
  }
  const list = [...counts.values()].filter((e) => e.n >= MIN_USES).sort((a, b) => b.n - a.n);
  // 位相のずれた同じ模様（a b / c d と b a / d c など）は 1 つにまとめる
  const seen = new Set<number>();
  const out: Omit<AutoPenPart, "order">[] = [];
  let ground = 0;
  let forest = 0;
  for (const e of list) {
    if (e.blocks.some((b) => seen.has(b))) continue;
    const walkable = e.walk * 2 >= e.n;
    if (walkable ? ground >= 2 : forest >= 2) continue;
    for (const b of e.blocks) seen.add(b);
    if (walkable) ground++;
    else forest++;
    out.push({
      name: walkable ? `自動: 地面の模様 ${hex3(e.blocks[0]!)}` : `自動: 森 ${hex3(e.blocks[0]!)}`,
      kind: "repeat",
      role: walkable ? "ground" : "tree",
      slots: { Body: gridOf(2, 2, e.blocks) },
    });
  }
  return out;
}

/** 通れないかたまり（建物・飾り）。同じ並びは 1 つにまとめ、多く現れる順に建物 8 個・飾り 8 個まで。 */
function analyzeClusters(input: AnalyzeInput, limit: number, taken: ReadonlySet<number>): Omit<AutoPenPart, "order">[] {
  const found = new Map<string, { n: number; w: number; h: number; blocks: (number | null)[]; movements: (number | null)[]; warp: boolean }>();
  for (const l of input.layouts) {
    const { width: w, height: h, cells } = l;
    const seen = new Uint8Array(w * h);
    const ok = (i: number) => {
      const v = cells[i]!;
      const b = blockOf(v);
      return blocked(v) && b < limit && !taken.has(b);
    };
    for (let i = 0; i < w * h; i++) {
      if (seen[i] || !ok(i)) continue;
      const stack = [i];
      seen[i] = 1;
      const member: number[] = [];
      while (stack.length > 0) {
        const j = stack.pop()!;
        member.push(j);
        const x = j % w;
        const y = (j / w) | 0;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const k = ny * w + nx;
          if (!seen[k] && ok(k)) {
            seen[k] = 1;
            stack.push(k);
          }
        }
      }
      let x0 = w;
      let y0 = h;
      let x1 = 0;
      let y1 = 0;
      for (const j of member) {
        x0 = Math.min(x0, j % w);
        x1 = Math.max(x1, j % w);
        y0 = Math.min(y0, (j / w) | 0);
        y1 = Math.max(y1, (j / w) | 0);
      }
      const bw = x1 - x0 + 1;
      const bh = y1 - y0 + 1;
      if (bw < 2 || bh < 2 || bw > 12 || bh > 10 || member.length < 4) continue;
      // 建物は下の辺の 1 つ下までの行にワープがあるもの。ドアのマスも並びに入れる
      const warp = (l.warps ?? []).some((p) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 + 1);
      const inSet = new Set(member);
      const blocks: (number | null)[] = [];
      const movements: (number | null)[] = [];
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const j = y * w + x;
          const isWarp = warp && (l.warps ?? []).some((p) => p.x === x && p.y === y);
          if (inSet.has(j) || (isWarp && blockOf(cells[j]!) < limit)) {
            blocks.push(blockOf(cells[j]!));
            movements.push(cells[j]! >> 10);
          } else {
            blocks.push(null);
            movements.push(null);
          }
        }
      }
      // 1 つのブロックが半分以上の並び（柵や壁の続き）は部品にしない
      const freq = new Map<number, number>();
      for (const b of blocks) if (b !== null) freq.set(b, (freq.get(b) ?? 0) + 1);
      if (Math.max(...freq.values()) * 2 > member.length) continue;
      const key = `${bw}x${bh}:${blocks.join(",")}`;
      const e = found.get(key);
      if (e) e.n++;
      else found.set(key, { n: 1, w: bw, h: bh, blocks, movements, warp });
    }
  }
  const all = [...found.values()].sort((a, b) => b.n - a.n || b.w * b.h - a.w * a.h);
  const out: Omit<AutoPenPart, "order">[] = [];
  let buildings = 0;
  let decor = 0;
  for (const e of all) {
    if (e.warp ? buildings >= 8 : decor >= 8 || e.n < 2) continue;
    const first = e.blocks.find((b) => b !== null) ?? 0;
    if (e.warp) buildings++;
    else decor++;
    out.push({
      name: e.warp ? `自動: 建物 ${hex3(first)}` : `自動: 飾り ${hex3(first)}`,
      kind: "piece",
      role: e.warp ? "building" : "decoration",
      slots: { Body: gridOf(e.w, e.h, e.blocks, e.movements) },
    });
  }
  return out;
}

/** 解析に使うプロジェクトの窓口（CfruProject の一部）。 */
export interface AnalyzeProject {
  mapIds(): readonly { bank: number; map: number }[];
  loaded(id: { bank: number; map: number }): AnalyzeDoc | undefined;
  peek(id: { bank: number; map: number }): Promise<AnalyzeDoc | null>;
}

/** 解析に使うマップ（MapDocument の一部）。 */
export interface AnalyzeDoc {
  readonly primaryTileset: number;
  readonly width: number;
  readonly height: number;
  readonly grid: { readonly cells: Uint16Array };
  readonly events: { readonly warps: readonly { readonly x: number; readonly y: number }[] } | null;
}

/**
 * プロジェクトの全マップ（ROM と maps\）から、主タイルセットが `primary` のマップの配置を集める（読めないマップは飛ばす）。
 * `yieldEvery` 枚ごとに `pause` を待つ（画面を止めないため。待ち時間に回す）。
 */
export async function collectLayouts(project: AnalyzeProject, primary: number, pause?: () => Promise<void>, yieldEvery = 16): Promise<AnalyzeLayout[]> {
  const out: AnalyzeLayout[] = [];
  let i = 0;
  for (const id of project.mapIds()) {
    if (pause && ++i % yieldEvery === 0) await pause();
    try {
      const doc = project.loaded(id) ?? (await project.peek(id));
      if (!doc || doc.primaryTileset >>> 0 !== primary >>> 0) continue;
      out.push({ width: doc.width, height: doc.height, cells: doc.grid.cells, warps: doc.events?.warps ?? [] });
    } catch {
      // 読めないマップは使わない
    }
  }
  return out;
}
