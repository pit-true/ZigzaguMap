import type { ImportLayerMode, ImportOptions, ImportPlan, ImportProblem, ImportTarget } from "@zigzagumap/core";

/** 書く先の名前（自動操作の `target` とウィザードの選び方）。 */
export type ImportTargetName = "primary" | "secondary" | "newPrimary" | "newSecondary";

/** 書く先の並び（ウィザードのコンボと同じ順）。 */
export const IMPORT_TARGETS: readonly ImportTargetName[] = ["secondary", "primary", "newSecondary", "newPrimary"];

/** 名前から書く先にする（知らない名前は Error）。 */
export function targetOf(name: string): ImportTarget {
  switch (name) {
    case "primary":
      return { secondary: false, isNew: false };
    case "secondary":
      return { secondary: true, isNew: false };
    case "newPrimary":
      return { secondary: false, isNew: true };
    case "newSecondary":
      return { secondary: true, isNew: true };
  }
  throw new Error(`書く先は primary / secondary / newPrimary / newSecondary のどれかです: ${name}`);
}

/** 計画の設定の JSON の形（窓からメインへ送る形、自動操作の `options`）。 */
export interface ImportOptionsJson {
  useFlip?: boolean;
  reuseExisting?: boolean;
  skipEmpty?: boolean;
  mergeSame?: boolean;
  mode?: ImportLayerMode;
  upperBehind?: boolean;
  baseBlock?: number | null;
  reduce?: boolean;
  excludedPalettes?: number[];
  reserveDoorTiles?: boolean;
  /** 手で決めた置き場所（[ブロックの番号, タイルセットの中の番号] の並び）。 */
  placement?: [number, number][];
  allowReplace?: boolean;
}

/** JSON の設定を計画の設定にする。 */
export function importOptionsFromJson(json: ImportOptionsJson): ImportOptions {
  const { placement, ...rest } = json;
  return { ...rest, ...(placement && placement.length > 0 ? { placement: new Map(placement) } : {}) };
}

/** 計画のうち、JSON で返すもの（自動操作の返事とウィザードの表示）。 */
export interface PlanSummary {
  readonly ok: boolean;
  readonly paletteShortage: boolean;
  readonly problems: readonly ImportProblem[];
  readonly tiles: ImportPlan["tiles"];
  readonly blocks: ImportPlan["blocks"];
  readonly palettes: ImportPlan["palettes"];
  readonly reduction: ImportPlan["reduction"];
  readonly cellsWide: number;
  readonly cellsHigh: number;
  /** ブロックごとの置く番号（タイルセットの中の番号）。 */
  readonly locals: number[];
  /** マスごとの通し番号（左上から行ごと。ブロックにしないマスは -1）。 */
  readonly cells: number[];
  readonly firstBlock: number | null;
  readonly ms: number;
}

export function planSummary(plan: ImportPlan): PlanSummary {
  return {
    ok: plan.ok,
    paletteShortage: plan.paletteShortage,
    problems: plan.problems,
    tiles: plan.tiles,
    blocks: plan.blocks,
    palettes: plan.palettes,
    reduction: plan.reduction,
    cellsWide: plan.cellsWide,
    cellsHigh: plan.cellsHigh,
    locals: [...plan.locals],
    cells: [...plan.stampCells],
    firstBlock: plan.firstBlock,
    ms: plan.ms,
  };
}
