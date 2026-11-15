import { AutoPenPlanner } from "./AutoPenPlanner.js";
import { PartIndex } from "./PartIndex.js";
import type { PenSource, PenWrite } from "./PenGrid.js";
import { EDGE_OUTER_SLOTS, singleGrid, type AutoPenPart, type PartGrid } from "./types.js";

/**
 * スマートパス（Phase5 #389。Porymap の Smart Path）。ちょうど 3×3 の選択を見本にして、周りに合わせて角・辺・中を選んで描く。
 * 9 マスを「縁つき」の一時的なパーツ（NW N NE / W C E / SW S SE。内角は持たない）にして、Phase4 のオートペンの縁つきの解き方
 * （AutoPenPlanner と EdgeSolver）で描く。パーツはファイルに残さない。
 */
export class SmartPath {
  /** 一時的なパーツ。 */
  readonly part: AutoPenPart;
  private readonly planner: AutoPenPlanner;

  private constructor(part: AutoPenPart) {
    this.part = part;
    this.planner = new AutoPenPlanner(new PartIndex([part]));
  }

  /**
   * 3×3 の選択から作る（`blocks` と `movements` は左上から横へ 9 個。`movements` が無ければ移動許可は決めない）。
   * 3×3 でなければ null。
   */
  static of(width: number, height: number, blocks: readonly number[], movements?: readonly number[]): SmartPath | null {
    if (width !== 3 || height !== 3 || blocks.length !== 9) return null;
    const slots: Record<string, PartGrid> = {};
    EDGE_OUTER_SLOTS.forEach((slot, i) => {
      slots[slot] = singleGrid(blocks[i]!, movements?.[i] ?? null);
    });
    return new SmartPath({ name: "smart-path", kind: "edge", role: "path", order: 0, slots });
  }

  /** 中のブロック（筆で塗るブロック）。 */
  get center(): number {
    return this.part.slots["C"]!.cells[0]!.block;
  }

  /** `cells` を中のブロックで塗ったあと、周りの縁を選び直したもの（元と同じマスは入らない）。 */
  stroke(source: PenSource, cells: readonly (readonly [number, number])[]): PenWrite[] {
    return this.planner.strokeWith(source, this.part, this.center, cells)?.writes ?? [];
  }
}
