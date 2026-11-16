/**
 * 画像からタイルとブロックを作る（Phase6 #442・#446）: 16×16 のマスからブロックを作り、置く番号を決める。DOM に依存しない。
 *
 * - 16×16 ごとに 1 ブロック。全部が透明のマスはブロックにしない。中身が同じマスは 1 つにまとめる（どちらも既定でオン）。
 * - 1 枚の画像: 重ね方の 3 択（絵だけ・下地の上でプレイヤーの下・下地の上で手前）。下地ブロックの下のレイヤーを写す。
 * - 2 枚: 下と上に入れ、属性のレイヤーの種類（ビット 29〜30）を選ぶ（0 なら上がプレイヤーより手前、1 なら両方がプレイヤーの下）。
 * - 3 枚: トリプルレイヤー（N の下・上と N+1 の下。属性のビット 28〜30 を 3 にする）。
 * - 空きのブロック: 中身が全部 0、0 番ではない、マップで使われていない、トリプルレイヤーの次の番号ではない。小さい順に使い、
 *   足りなければ後ろへ足す（上限まで）。
 */
import { BLOCK_TILE_COUNT } from "../blockFormat.js";

/** ブロックの中身（タイル指定 8 個と属性。3 枚の画像なら次の番号の中身も）。 */
export interface BuiltBlock {
  readonly tiles: readonly number[];
  readonly attribute: number;
  /** トリプルレイヤーの 3 枚目（次の番号の下のレイヤー 4 個。上と属性は 0）。 */
  readonly third: readonly number[] | null;
  /** このブロックを使うマス（左上から行ごとの番号）。 */
  readonly cells: number[];
}

/** 1 枚の画像の重ね方。 */
export type ImportLayerMode = "picture" | "under" | "over";

/** 下地ブロック（重ね方が under・over のとき、下のレイヤーと属性を写す）。 */
export interface BaseBlock {
  readonly tiles: readonly number[];
  readonly attribute: number;
}

/** ブロックの作り方。 */
export interface BlockBuildOptions {
  /** 全部が透明のマスはブロックにしない（既定 true）。 */
  readonly skipEmpty?: boolean;
  /** 中身が同じマスは 1 つにまとめる（既定 true）。 */
  readonly mergeSame?: boolean;
  /** 1 枚の画像の重ね方（既定 picture）。 */
  readonly mode?: ImportLayerMode;
  /** 2 枚の画像で、上のレイヤーもプレイヤーの下に描くか（属性のレイヤーの種類 1。既定 false）。 */
  readonly upperBehind?: boolean;
  /** 下地ブロック（無ければ下のレイヤーは透明のタイル）。 */
  readonly base?: BaseBlock | null;
}

/** 属性のビット 28〜30（重ね方）。 */
const LAYER_BITS = 0x70000000;
/** レイヤーの種類 1（上のレイヤーもプレイヤーの下）。 */
const LAYER_BEHIND = 1 << 29;
/** トリプルレイヤー（重ね方 3）。 */
const LAYER_TRIPLE = 3 << 28;

/**
 * マスごとのタイル指定からブロックを作る。
 * `refs[layer][cell]` はそのマスの 4 個（左上・右上・左下・右下）、`empty[cell]` は全部のレイヤーが透明か、
 * `blank` は透明のタイルの指定。返すのはブロック（まとめた後）と、マスごとのブロックの番号（ブロックにしないマスは -1）。
 */
export function buildBlocks(
  refs: readonly (readonly (readonly number[])[])[],
  empty: readonly boolean[],
  blank: number,
  options: BlockBuildOptions = {},
): { blocks: BuiltBlock[]; cellBlocks: Int32Array; skipped: number; merged: number } {
  const skipEmpty = options.skipEmpty ?? true;
  const mergeSame = options.mergeSame ?? true;
  const mode = options.mode ?? "picture";
  const blank4 = [blank, blank, blank, blank];
  const blocks: BuiltBlock[] = [];
  const byKey = new Map<string, number>();
  const cellBlocks = new Int32Array(empty.length).fill(-1);
  let skipped = 0;
  let merged = 0;
  for (let cell = 0; cell < empty.length; cell++) {
    if (skipEmpty && empty[cell]) {
      skipped++;
      continue;
    }
    let tiles: number[];
    let attribute = 0;
    let third: number[] | null = null;
    if (refs.length >= 3) {
      tiles = [...refs[0]![cell]!, ...refs[1]![cell]!];
      attribute = LAYER_TRIPLE;
      third = [...refs[2]![cell]!];
    } else if (refs.length === 2) {
      tiles = [...refs[0]![cell]!, ...refs[1]![cell]!];
      attribute = options.upperBehind ? LAYER_BEHIND : 0;
    } else if (mode === "picture") {
      tiles = [...refs[0]![cell]!, ...blank4];
    } else {
      const base = options.base ?? null;
      tiles = [...(base ? base.tiles.slice(0, 4) : blank4), ...refs[0]![cell]!];
      attribute = (((base?.attribute ?? 0) & ~LAYER_BITS) | (mode === "under" ? LAYER_BEHIND : 0)) >>> 0;
    }
    const key = `${tiles.join(",")}|${attribute}|${third?.join(",") ?? ""}`;
    const hit = mergeSame ? byKey.get(key) : undefined;
    if (hit !== undefined) {
      blocks[hit]!.cells.push(cell);
      cellBlocks[cell] = hit;
      merged++;
      continue;
    }
    byKey.set(key, blocks.length);
    cellBlocks[cell] = blocks.length;
    blocks.push({ tiles, attribute, third, cells: [cell] });
  }
  return { blocks, cellBlocks, skipped, merged };
}

/** 置く先のブロックの表。 */
export interface PlacementTable {
  /** 今のブロック定義（1 ブロック 8 個）。 */
  readonly blocks: Uint16Array;
  readonly attributes: Uint32Array;
  /** ブロック数の上限（主 640、副 384）。 */
  readonly capacity: number;
  /** 表の最初の通し番号（主 0、副 0x280）。 */
  readonly base: number;
  /** 通し番号のブロックのマップ・ボーダーでの使用回数（無ければ 0）。 */
  readonly used?: (block: number) => number;
}

/** 置けない理由。 */
export type PlacementProblem = "zero" | "tripleChild" | "outside" | "used" | "notEmpty" | "taken" | "noNext";

/** 表の中の番号 `local` のブロックが空か（中身が全部 0）。 */
export function isEmptyBlock(table: PlacementTable, local: number): boolean {
  if (local >= table.attributes.length) return true;
  if ((table.attributes[local] ?? 0) !== 0) return false;
  for (let i = 0; i < BLOCK_TILE_COUNT; i++) if ((table.blocks[local * BLOCK_TILE_COUNT + i] ?? 0) !== 0) return false;
  return true;
}

function tripleAt(table: PlacementTable, local: number): boolean {
  return local >= 0 && local < table.attributes.length && (((table.attributes[local] ?? 0) >>> 28) & 7) === 3;
}

/**
 * 番号 `local` に置けるか（置けなければ理由）。`triple` なら `local + 1` も使う。`allowReplace` なら、使っているブロックや
 * 中身のあるブロックにも置ける（置き換え）。`taken` はこの取り込みで既に使った番号。
 */
export function placementProblem(table: PlacementTable, local: number, triple: boolean, allowReplace: boolean, taken: ReadonlySet<number> = new Set()): PlacementProblem | null {
  if (!Number.isInteger(local) || local < 0 || local >= table.capacity) return "outside";
  if (table.base + local === 0) return "zero";
  if (triple && local + 1 >= table.capacity) return "noNext";
  const check = (l: number): PlacementProblem | null => {
    if (taken.has(l)) return "taken";
    // 1 つ前が今の 3 層のブロックなら、その 3 枚目に使われている（前の番号もこの取り込みで置き換えるなら構わない）
    if (tripleAt(table, l - 1) && !taken.has(l - 1)) return "tripleChild";
    if (allowReplace) return null;
    if ((table.used?.(table.base + l) ?? 0) > 0) return "used";
    if (!isEmptyBlock(table, l)) return "notEmpty";
    return null;
  };
  const first = check(local);
  if (first) return first;
  if (triple) {
    if (taken.has(local + 1)) return "taken";
    if (!allowReplace && ((table.used?.(table.base + local + 1) ?? 0) > 0 || !isEmptyBlock(table, local + 1))) return "noNext";
  }
  return null;
}

/** 置いた結果。 */
export interface Placement {
  /** ブロックごとの番号（表の中の番号。置けなければ -1）。 */
  readonly locals: Int32Array;
  /** 置けなかったブロックの数。 */
  readonly unplaced: number;
  /** 置き換えた（使っているか中身のある）ブロックの数。 */
  readonly replaced: number;
  /** 手で決めた番号のうち、置けなかったもの（ブロックの番号と理由）。 */
  readonly invalid: readonly { readonly block: number; readonly local: number; readonly problem: PlacementProblem }[];
  /** 空きの数（置く前。トリプルレイヤーは 2 つで 1 組でなく、1 つずつ数える）。 */
  readonly free: number;
}

/**
 * ブロックを置く番号を決める。`manual`（ブロックの番号 → 表の中の番号）は先に置き、残りを空きの小さい順へ置く。
 * 3 層のブロックは番号を 2 つ（N と N+1）使う。
 */
export function placeBlocks(table: PlacementTable, blocks: readonly BuiltBlock[], manual: ReadonlyMap<number, number> = new Map(), allowReplace = false): Placement {
  const locals = new Int32Array(blocks.length).fill(-1);
  const taken = new Set<number>();
  const invalid: { block: number; local: number; problem: PlacementProblem }[] = [];
  let replaced = 0;
  const countReplace = (l: number): void => {
    if (!isEmptyBlock(table, l) || (table.used?.(table.base + l) ?? 0) > 0) replaced++;
  };
  for (const [b, l] of [...manual].sort((x, y) => x[0] - y[0])) {
    const block = blocks[b];
    if (!block) continue;
    if (l === -1) continue;
    const triple = block.third !== null;
    const problem = placementProblem(table, l, triple, allowReplace, taken);
    if (problem) {
      invalid.push({ block: b, local: l, problem });
      continue;
    }
    locals[b] = l;
    taken.add(l);
    countReplace(l);
    if (triple) {
      taken.add(l + 1);
      countReplace(l + 1);
    }
  }
  let free = 0;
  for (let l = 0; l < table.capacity; l++) if (placementProblem(table, l, false, false) === null) free++;
  let unplaced = 0;
  let cursor = 0;
  for (let b = 0; b < blocks.length; b++) {
    if (locals[b]! >= 0) continue;
    if (manual.get(b) === -1) { unplaced++; continue; }
    const triple = blocks[b]!.third !== null;
    let found = -1;
    for (let l = cursor; l < table.capacity; l++) {
      if (placementProblem(table, l, triple, false, taken) === null) {
        found = l;
        break;
      }
    }
    if (found < 0) {
      unplaced++;
      continue;
    }
    locals[b] = found;
    taken.add(found);
    if (triple) taken.add(found + 1);
    // 3 層は次の番号も使うので、普通のブロックは次から探してよい
    if (!triple) cursor = found + 1;
  }
  return { locals, unplaced, replaced, invalid, free };
}
