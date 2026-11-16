/**
 * ループする時計（#471）。人物の移動タイプとタイルアニメ（#473）が共用する。ゲームの 1 フレーム（GBA の 280896 クロック、
 * 約 16.74ms）ごとに、購読している相手へ「進めるフレーム数」を渡す。
 *
 * - 動いている購読が 1 つも無いときは requestAnimationFrame を予約しない（止まっているときに CPU を使わない）。
 * - 購読ごとに `hold(owner)` で止められる（再生中は人物の自分の動きを止める A-5 など）。止めた相手が全部 release するまで止まる。
 * - 窓が隠れて間があいたときは、1 回に進めるのを 250ms 分までにする（戻ったときに一気に進めない）。
 */

/** GBA の 1 フレームの長さ（ms）。 */
export const GBA_FRAME_MS = (1000 * 280896) / 16777216;
/** 1 回の呼び出しで進める時間の上限（ms）。 */
const MAX_ELAPSED_MS = 250;

/** requestAnimationFrame の代わり（テストで差し替える）。 */
export interface ClockScheduler {
  request(callback: (timestamp: number) => void): number;
  cancel(handle: number): void;
}

const browserScheduler: ClockScheduler = {
  request: (callback) => requestAnimationFrame(callback),
  cancel: (handle) => cancelAnimationFrame(handle),
};

/** 時計の購読。 */
export interface ClockSubscription {
  readonly name: string;
  /** 止めている相手（空なら動いている）。 */
  readonly holders: readonly string[];
  /** owner の名前で止める。返した関数で解除する（何度呼んでもよい）。 */
  hold(owner: string): () => void;
  /** 購読をやめる。 */
  dispose(): void;
}

class Subscription implements ClockSubscription {
  readonly holds = new Map<string, number>();
  disposed = false;
  constructor(readonly name: string, readonly tick: (frames: number) => void, private readonly clock: GameClock) {}
  get holders(): readonly string[] { return [...this.holds.keys()]; }
  get active(): boolean { return !this.disposed && this.holds.size === 0; }
  hold(owner: string): () => void {
    this.holds.set(owner, (this.holds.get(owner) ?? 0) + 1);
    this.clock.update();
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = (this.holds.get(owner) ?? 1) - 1;
      if (count > 0) this.holds.set(owner, count); else this.holds.delete(owner);
      this.clock.update();
    };
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.clock.remove(this);
  }
}

export class GameClock {
  private readonly subscriptions: Subscription[] = [];
  private handle: number | null = null;
  private previous: number | null = null;
  private carry = 0;
  private frameCount = 0;
  private looping = false;

  constructor(private readonly scheduler: ClockScheduler = browserScheduler) {}

  /** requestAnimationFrame を予約しているか。 */
  get running(): boolean { return this.handle !== null; }
  /** 渡したフレームの合計。 */
  get frames(): number { return this.frameCount; }
  /** 購読の一覧（自動操作の確認用）。 */
  get state(): { running: boolean; frames: number; subscriptions: { name: string; holders: readonly string[] }[] } {
    return { running: this.running, frames: this.frameCount, subscriptions: this.subscriptions.map(s => ({ name: s.name, holders: s.holders })) };
  }

  /** フレームごとに tick を呼ぶ。 */
  subscribe(name: string, tick: (frames: number) => void): ClockSubscription {
    const s = new Subscription(name, tick, this);
    this.subscriptions.push(s);
    this.update();
    return s;
  }

  /** @internal */
  remove(s: Subscription): void {
    const i = this.subscriptions.indexOf(s);
    if (i >= 0) this.subscriptions.splice(i, 1);
    this.update();
  }

  /** @internal 動いている購読の有無に合わせて予約する・やめる。 */
  update(): void {
    if (this.looping) return;
    const needed = this.subscriptions.some(s => s.active);
    if (needed && this.handle === null) {
      this.previous = null;
      this.handle = this.scheduler.request(this.loop);
    } else if (!needed && this.handle !== null) {
      this.scheduler.cancel(this.handle);
      this.handle = null;
      this.previous = null;
      this.carry = 0;
    }
  }

  private readonly loop = (timestamp: number): void => {
    this.handle = null;
    this.looping = true;
    try {
      this.advance(timestamp);
    } finally {
      this.looping = false;
    }
    if (this.subscriptions.some(s => s.active)) this.handle = this.scheduler.request(this.loop);
    else { this.previous = null; this.carry = 0; }
  };

  private advance(timestamp: number): void {
    if (this.previous !== null) {
      this.carry += Math.max(0, Math.min(MAX_ELAPSED_MS, timestamp - this.previous));
      const frames = Math.floor(this.carry / GBA_FRAME_MS);
      if (frames > 0) {
        this.carry -= frames * GBA_FRAME_MS;
        this.frameCount += frames;
        for (const s of [...this.subscriptions]) if (s.active) s.tick(frames);
      }
    }
    this.previous = timestamp;
  }
}
