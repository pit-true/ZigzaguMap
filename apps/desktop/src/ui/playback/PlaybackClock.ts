/** 再生中だけrequestAnimationFrameから呼ぶ時計。停止中にはタイマーを持たない。 */
export class PlaybackClock {
  private position = 0;
  private previous: number | null = null;
  private active = false;
  private multiplier = 1;

  constructor(readonly lastFrame: number, readonly keyFrames: readonly number[]) {}
  get frame(): number { return Math.floor(this.position); }
  get playing(): boolean { return this.active; }
  get speed(): number { return this.multiplier; }

  play(): void { this.active = this.frame < this.lastFrame; this.previous = null; }
  pause(): void { this.active = false; this.previous = null; }
  seek(frame: number): void {
    if (!Number.isFinite(frame)) throw new RangeError("Invalid playback frame");
    this.pause(); this.position = Math.max(0, Math.min(this.lastFrame, Math.floor(frame)));
  }
  setSpeed(speed: number): void {
    if (![0.25, 0.5, 1, 2, 4].includes(speed)) throw new RangeError("Invalid playback speed");
    this.multiplier = speed; this.previous = null;
  }
  step(direction: -1 | 1, singleFrame = false): void {
    const f = this.frame;
    this.seek(singleFrame ? f + direction : direction > 0 ? this.keyFrames.find(k => k > f) ?? this.lastFrame : [...this.keyFrames].reverse().find(k => k < f) ?? 0);
  }

  /** stopAtで文の印を渡すと、そのフレームで止まる。バックグラウンドの経過は最大250ms。 */
  tick(timestamp: number, stopAt: number | null = null): number {
    if (!this.active || !Number.isFinite(timestamp)) return this.frame;
    if (this.previous !== null) {
      const elapsed = Math.max(0, Math.min(250, timestamp - this.previous));
      this.position = Math.min(this.lastFrame, this.position + elapsed * 60 / 1000 * this.multiplier);
    }
    this.previous = timestamp;
    if (stopAt !== null && this.position >= stopAt) { this.position = stopAt; this.pause(); }
    else if (this.position >= this.lastFrame) this.pause();
    return this.frame;
  }
}
