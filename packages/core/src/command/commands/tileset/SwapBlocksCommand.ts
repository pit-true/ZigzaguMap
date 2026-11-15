import { mapTargets } from "../../affectedMaps.js";
import type { Command, EditorContext, JsonObject } from "../../Command.js";
import { documentContext, type DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { argInt, type Args } from "../../jsonArgs.js";
import { BLOCK_ID_MASK, PRIMARY_BLOCK_COUNT } from "../../../map/constants.js";
import type { BlockGrid } from "../../../map/BlockGrid.js";
import type { MapId } from "../../../map/types.js";
import { BLOCK_TILE_COUNT } from "../../../tileset/blockFormat.js";
import type { TilesetDocument } from "../../../tileset/TilesetDocument.js";
import { isLocalTripleChild, isTripleLayer, localAttribute, tableBlockCount, type BlockTable } from "../../../tileset/tripleLayer.js";
import { argTileset, type TilesetArgs } from "../base/TilesetCommand.js";

/** 「ブロックを入れ替える」の引数。 */
export type SwapBlocksArgs = TilesetArgs & {
  /** タイルセットの中の番号（副も 0 から）。 */
  a: number;
  b: number;
  /** 番号を付け替えるマップ（そのタイルセットを使うもの。空なら付け替えない）。 */
  targets: JsonObject[];
};

/** 入れ替えられない理由（EditError の `reason`）。 */
export type SwapRefusal = "same" | "child" | "noNext" | "mixed" | "overlap";

/**
 * 入れ替える番号の組（タイルセットの中の番号）。3 層のブロックは N と N+1 の 2 つ組で動かす。
 * 組が崩れる入れ替え（3 層の次の番号を選んだ、3 層とそうでないもの、組が重なる）は EditError（blockSwapRefused）。
 */
export function swapUnits(table: BlockTable, a: number, b: number): { from: number[]; to: number[] } {
  const count = tableBlockCount(table);
  const refuse = (reason: SwapRefusal): never => {
    throw new EditError(EditErrorCode.BlockSwapRefused, { a, b, reason });
  };
  for (const v of [a, b]) {
    if (!Number.isInteger(v) || v < 0 || v >= count) throw new EditError(EditErrorCode.BlockIndexOutOfRange, { index: v, count });
  }
  if (a === b) refuse("same");
  const unit = (x: number): number[] => {
    if (isLocalTripleChild(table, x)) refuse("child");
    if (!isTripleLayer(localAttribute(table, x))) return [x];
    if (x + 1 >= count) refuse("noNext");
    return [x, x + 1];
  };
  const from = unit(a);
  const to = unit(b);
  if (from.length !== to.length) refuse("mixed");
  if (from.some((v) => to.includes(v))) refuse("overlap");
  return { from, to };
}

/** マップの通し番号の付け替え表（通し番号 → 通し番号）。 */
function remapTable(secondary: boolean, from: readonly number[], to: readonly number[]): Map<number, number> {
  const base = secondary ? PRIMARY_BLOCK_COUNT : 0;
  const m = new Map<number, number>();
  from.forEach((f, i) => {
    m.set(base + f, base + to[i]!);
    m.set(base + to[i]!, base + f);
  });
  return m;
}

/** 配置のブロック番号を付け替える（移動許可はそのまま）。変えたマスの数。 */
function remapGrid(grid: BlockGrid, table: Map<number, number>): number {
  let n = 0;
  const cells = grid.cells;
  for (let i = 0; i < cells.length; i++) {
    const v = cells[i]!;
    const to = table.get(v & BLOCK_ID_MASK);
    if (to === undefined) continue;
    cells[i] = (v & ~BLOCK_ID_MASK & 0xffff) | to;
    n++;
  }
  return n;
}

/**
 * 「ブロックを入れ替える」コマンド（ブロックエディタの 編集 > ブロックの入れ替え。Phase5 #394）。
 *
 * - タイルセットの中の 2 つのブロック（8 タイルと属性）を入れ替える。3 層のブロックは N と N+1 の組で動かす（`swapUnits`）。
 * - `targets` のマップのうち、そのタイルセットを使うもの（主なら主、副なら副が同じ）の配置とボーダーの番号も付け替える
 *   （見た目は入れ替えの前と同じになる。#407 の Q8 の推奨）。マップは実行の前に読み込んでおく。
 * - 入れ替えは 2 回でもとに戻るので、取り消しは同じ入れ替えをもう一度行う（付け替えたマップも同じ）。1 回の取り消しで全部戻る。
 */
export class SwapBlocksCommand implements Command<SwapBlocksArgs> {
  static readonly NAME = "swapBlocks";
  readonly name = SwapBlocksCommand.NAME;
  /** 実行したときに付け替えたマップ（取り消しで同じものを戻す）。 */
  private remapped: MapId[] | null = null;

  constructor(readonly args: SwapBlocksArgs) {}

  /** 引数を作る。 */
  static of(tileset: { pointer: number; secondary: boolean }, a: number, b: number, targets: readonly MapId[]): SwapBlocksCommand {
    return new SwapBlocksCommand({ tileset: tileset.pointer >>> 0, secondary: tileset.secondary, a, b, targets: mapTargets(targets) as JsonObject[] });
  }

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SwapBlocksCommand {
    const list = Array.isArray(args["targets"]) ? (args["targets"] as unknown[]) : [];
    const targets: MapId[] = [];
    for (const t of list) {
      const v = t as { bank?: unknown; map?: unknown } | null;
      if (v && Number.isInteger(v.bank) && Number.isInteger(v.map) && !targets.some((o) => o.bank === v.bank && o.map === v.map)) {
        targets.push({ bank: v.bank as number, map: v.map as number });
      }
    }
    return new SwapBlocksCommand({ ...argTileset(args), a: argInt(args, "a"), b: argInt(args, "b"), targets: mapTargets(targets) as JsonObject[] });
  }

  do(context: EditorContext): void {
    const ctx = documentContext(context);
    const tileset = ctx.tileset({ pointer: this.args.tileset >>> 0, secondary: this.args.secondary });
    const { from, to } = swapUnits(tileset, this.args.a, this.args.b);
    // 先に全部のマップを引いておく（読み込んでいないマップがあれば何も変えずに失敗する）
    const maps = this.matchingMaps(ctx);
    swapTileset(tileset, from, to);
    const table = remapTable(this.args.secondary, from, to);
    for (const id of maps) {
      remapGrid(ctx.document(id).grid, table);
      remapGrid(ctx.border(id), table);
    }
    this.remapped = maps;
  }

  undo(context: EditorContext): void {
    if (!this.remapped) return;
    const ctx = documentContext(context);
    const tileset = ctx.tileset({ pointer: this.args.tileset >>> 0, secondary: this.args.secondary });
    const { from, to } = swapUnits(tileset, this.args.b, this.args.a);
    swapTileset(tileset, from, to);
    const table = remapTable(this.args.secondary, from, to);
    for (const id of this.remapped) {
      remapGrid(ctx.document(id).grid, table);
      remapGrid(ctx.border(id), table);
    }
    this.remapped = null;
  }

  /** `targets` のうち、このタイルセットを使うマップ。 */
  private matchingMaps(ctx: DocumentContext): MapId[] {
    const pointer = this.args.tileset >>> 0;
    const out: MapId[] = [];
    for (const t of this.args.targets) {
      const id = { bank: Number(t["bank"]), map: Number(t["map"]) };
      const doc = ctx.document(id);
      const used = this.args.secondary ? doc.secondaryTileset >>> 0 : doc.primaryTileset >>> 0;
      if (used === pointer) out.push(id);
    }
    return out;
  }
}

/** タイルセットの中で、`from[i]` と `to[i]` のブロック（8 タイルと属性）を入れ替える。 */
function swapTileset(tileset: TilesetDocument, from: readonly number[], to: readonly number[]): void {
  from.forEach((f, i) => {
    const t = to[i]!;
    const a = tileset.blocks.slice(f * BLOCK_TILE_COUNT, (f + 1) * BLOCK_TILE_COUNT);
    tileset.blocks.copyWithin(f * BLOCK_TILE_COUNT, t * BLOCK_TILE_COUNT, (t + 1) * BLOCK_TILE_COUNT);
    tileset.blocks.set(a, t * BLOCK_TILE_COUNT);
    const attr = tileset.attributes[f]!;
    tileset.attributes[f] = tileset.attributes[t]!;
    tileset.attributes[t] = attr;
  });
}
