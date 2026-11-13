import type { BlockGrid } from "../../map/BlockGrid.js";
import type { MapId } from "../../map/types.js";
import type { Command, EditorContext, JsonObject } from "../Command.js";

/** マス 1 つ分の書き込み。`value` はブロック番号か移動許可（コマンドの種類による）。 */
export interface CellWrite {
  readonly x: number;
  readonly y: number;
  readonly value: number;
}

/**
 * 複数のマスへ書く操作の共通部分。書く前の値（ブロック番号と移動許可の両方）を覚えて戻す。
 * 同じ種類・同じマップの後続コマンドを `merge` でまとめられる（ドラッグ中の連続配置用）。
 */
export abstract class PaintCellsCommand<A extends JsonObject & { bank: number; map: number }> implements Command<A> {
  abstract readonly name: string;
  private previous: number[] = [];
  private currentArgs: A;

  constructor(
    args: A,
    private writes: CellWrite[],
  ) {
    this.currentArgs = args;
  }

  /** 引数（まとめた分も含む）。 */
  get args(): A {
    return this.currentArgs;
  }

  /** 対象のマップ。 */
  get mapId(): MapId {
    return { bank: this.currentArgs.bank, map: this.currentArgs.map };
  }

  /** 書くマス（まとめた分も含む）。 */
  get cells(): readonly CellWrite[] {
    return this.writes;
  }

  /** 書き込み先の配置。 */
  protected abstract target(context: EditorContext): BlockGrid;

  /** 1 マスへ書く。 */
  protected abstract write(grid: BlockGrid, cell: CellWrite): void;

  /** `writes` を JSON の引数へ写す。 */
  protected abstract toArgs(writes: readonly CellWrite[]): A;

  do(context: EditorContext): void {
    const grid = this.target(context);
    // 範囲外があれば何も書かずに失敗させる。
    for (const c of this.writes) grid.getCell(c.x, c.y);
    this.previous = this.writes.map((c) => grid.getCell(c.x, c.y));
    for (const c of this.writes) this.write(grid, c);
  }

  undo(context: EditorContext): void {
    const grid = this.target(context);
    for (let i = this.writes.length - 1; i >= 0; i--) {
      const c = this.writes[i]!;
      grid.setCell(c.x, c.y, this.previous[i]!);
    }
  }

  merge(next: Command): boolean {
    if (!(next instanceof PaintCellsCommand) || next.name !== this.name) return false;
    const other = next as PaintCellsCommand<A>;
    if (other.currentArgs.bank !== this.currentArgs.bank || other.currentArgs.map !== this.currentArgs.map) return false;
    this.writes = [...this.writes, ...other.writes];
    this.previous = [...this.previous, ...other.previous];
    this.currentArgs = this.toArgs(this.writes);
    return true;
  }
}
