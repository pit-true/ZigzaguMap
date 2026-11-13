/** 起動からの時間の記録（自動操作の state で返し、軽さの目標を測るのに使う）。 */
export const timings = {
  /** 出来事 → performance.now()（ページの読み込み開始からのミリ秒）。最初の 1 回だけ記録する。 */
  marks: {} as Record<string, number>,
  /** 最後にマップを切り替えたときの所要時間（ミリ秒）。 */
  lastMapSwitchMs: 0,

  /** 出来事の時刻を記録する（最初の 1 回だけ）。 */
  mark(name: string): void {
    this.marks[name] ??= performance.now();
  },

  /** JSON にする（`origin` はページの読み込み開始の時刻。UNIX ミリ秒）。 */
  toJson(): { origin: number; marks: Record<string, number>; lastMapSwitchMs: number } {
    return { origin: performance.timeOrigin, marks: { ...this.marks }, lastMapSwitchMs: this.lastMapSwitchMs };
  },
};
