import { LineLock, lineCells } from "@zigzagumap/core";
import type { Cell } from "../../ui/map/MapView";

/**
 * 直線（Phase5 #389。Q3 の推奨で Shift）。Shift を押しながら描くと、描き始め（か Shift を押したマス）から 2 マス目へ動いた向きで
 * 横か縦の軸を決め、その軸の上のマスだけに描く。Shift を離すとふつうに戻り、押し直すとその位置から続ける。
 * 鉛筆・移動許可・スマートパスで使う（マップシフトは ShiftTool が LineLock を直接使う）。
 * Shift を押していないときは、今までと同じく通ったマスだけを返す（線の補間はしない。AdvanceMap と同じ）。
 */
export class LineGuide {
  private readonly lock = new LineLock();
  private last: Cell | null = null;

  /** 押した（Shift を押していればそのマスを始点にする）。 */
  begin(cell: Cell, shift: boolean): void {
    this.last = cell;
    if (shift) this.lock.start(cell.x, cell.y);
    else this.lock.stop();
  }

  /** 離した。 */
  end(): void {
    this.last = null;
    this.lock.stop();
  }

  /** Shift で軸を固定しているか。 */
  get locked(): boolean {
    return this.lock.active;
  }

  /**
   * マウスが `cell` へ動いたときに描くマス。Shift なら軸の上へ寄せ、前に描いたマスから飛んだ分を軸の上でつなぐ
   * （寄せた先が前と同じマスなら空）。Shift でなければ `[cell]`。
   */
  next(cell: Cell, shift: boolean): Cell[] {
    const last = this.last;
    if (!shift || !last) {
      this.lock.stop();
      this.last = cell;
      return [cell];
    }
    if (!this.lock.active) this.lock.start(last.x, last.y);
    const c = this.lock.constrain(cell.x, cell.y);
    if (c.x === last.x && c.y === last.y) return [];
    this.last = c;
    return lineCells(last.x, last.y, c.x, c.y)
      .slice(1)
      .map(([x, y]) => ({ x, y }));
  }
}
