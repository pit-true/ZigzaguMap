import type { OverworldAnimationCommand, OverworldFrame } from "./OverworldSprites.js";

export type AnimationReader = (animation: number, command: number) => OverworldAnimationCommand | null;

/** actanm.cの1フレームの状態。画像そのものは持たず、コマ番号と反転だけを返す。 */
export class SpriteAnimation {
  private animation: number;
  private command = 0;
  private wait = 0;
  private count = 0;
  private initial = true;
  private ended = false;
  private invalid = false;
  private current: OverworldFrame | null = null;
  paused = false;

  constructor(private readonly read: AnimationReader, animation = 0) { this.animation = animation; }
  get commandIndex(): number { return this.command; }
  get failed(): boolean { return this.invalid; }

  /** ActAnmChg。次のtickで先頭を表示し、ループの数も戻す。 */
  restart(animation: number): void {
    this.animation = animation; this.initial = true; this.invalid = false; this.ended = false;
  }

  /** 番号だけを替える場合も、現在のコマと待ち時間は残す。 */
  select(animation: number): void { this.animation = animation; }

  /** ActAnmOffsChg。コマを即座に読み、同じフレームのtickの分を補償する。pauseは変えない。 */
  changeAt(animation: number, command: number): void {
    this.animation = animation; this.command = command;
    this.initial = false; this.ended = false; this.invalid = false;
    this.wait = 0;
    this.load();
    if (this.wait) this.wait++;
  }

  /** STAY_WALK_05は隔フレームにwaitを延ばす。通常のWALK_05には使わない。 */
  delay(): void { this.wait++; }

  tick(): OverworldFrame | null {
    if (this.invalid) return null;
    if (this.initial) {
      this.initial = false; this.command = 0; this.count = 0;
      this.load();
    } else if (!this.ended) {
      if (this.wait) {
        if (!this.paused) this.wait--;
        // 同じコマのまま表が替わった場合は、反転だけが新しい表の値になる。
        const item = this.read(this.animation, this.command);
        if (item?.kind === "frame" && this.current) this.current = { ...this.current, hFlip: item.frame.hFlip, vFlip: item.frame.vFlip };
      } else if (!this.paused) {
        this.command++; this.load();
      }
    }
    return this.invalid ? null : this.current;
  }

  private load(): void {
    const visited = new Set<string>();
    for (let steps = 0; steps < 256; steps++) {
      const key = `${this.command}:${this.count}`;
      if (visited.has(key)) break;
      visited.add(key);
      const item = this.read(this.animation, this.command);
      if (!item) break;
      if (item.kind === "frame") {
        this.current = item.frame;
        this.wait = Math.max(0, item.duration - 1);
        return;
      }
      if (item.kind === "end") {
        this.command = Math.max(0, this.command - 1); this.ended = true;
        return;
      }
      if (item.kind === "jump") {
        this.command = item.target;
        continue;
      }
      this.count = this.count ? this.count - 1 : item.count;
      if (this.count) {
        do { this.command--; } while (this.command > 0 && this.read(this.animation, this.command - 1)?.kind !== "loop");
      } else this.command++;
    }
    this.invalid = true; this.current = null;
  }
}
