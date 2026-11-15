/**
 * 直線（Phase5 #389。Porymap の描きながら Ctrl に当たる。ZigzaguMap では Shift）。描き始めから 2 マス目へ動いた向きで
 * 横か縦の軸を決め、その軸の上のマスだけに描く。DOM に依存しない。
 */

/** 決めた軸（まだ決めていなければ null）。 */
export type LineAxis = "x" | "y" | null;

/** 直線の状態。 */
export class LineLock {
  private anchor: { x: number; y: number } | null = null;
  private axisValue: LineAxis = null;

  /** 始点（この位置から軸を決め直す）。 */
  start(x: number, y: number): void {
    this.anchor = { x, y };
    this.axisValue = null;
  }

  /** やめる（Shift を離した）。 */
  stop(): void {
    this.anchor = null;
    this.axisValue = null;
  }

  /** 始点があるか。 */
  get active(): boolean {
    return this.anchor !== null;
  }

  /** 決めた軸。 */
  get axis(): LineAxis {
    return this.axisValue;
  }

  /**
   * マウスのマスを軸の上に寄せたマス。始点が無ければそのまま。軸をまだ決めていなければ、始点からずれた量の大きい向きで決める
   * （始点と同じマスなら決めない）。
   */
  constrain(x: number, y: number): { x: number; y: number } {
    const a = this.anchor;
    if (!a) return { x, y };
    if (this.axisValue === null) {
      const dx = Math.abs(x - a.x);
      const dy = Math.abs(y - a.y);
      if (dx === 0 && dy === 0) return { x, y };
      this.axisValue = dx >= dy ? "x" : "y";
    }
    return this.axisValue === "x" ? { x, y: a.y } : { x: a.x, y };
  }
}
