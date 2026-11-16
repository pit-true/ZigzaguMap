import type { PlaybackMarker, TimeOfDay } from "@zigzagumap/core";

interface TimeView {
  readonly time: TimeOfDay;
  chronosTime(value: number): Promise<TimeOfDay | null>;
  set(time: TimeOfDay): Promise<boolean>;
}

/** 時間帯の非同期読み込みを直列にし、巻き戻し・終了後の古い結果を捨てる。 */
export class PlaybackTime {
  private readonly original: TimeOfDay;
  private queue: Promise<void> = Promise.resolve();
  private generation = 0;
  private requested: string | null = null;
  constructor(private readonly view: TimeView, private readonly valid: () => boolean) { this.original = view.time; }

  update(markers: readonly Pick<PlaybackMarker, "kind" | "frame" | "detail">[], frame: number): void {
    const marker = [...markers].reverse().find(marker => marker.kind === "timeOfDay" && marker.frame <= frame);
    const key = marker?.detail ?? "original";
    if (key === this.requested) return;
    this.requested = key;
    const generation = ++this.generation;
    this.queue = this.queue.catch(() => undefined).then(async () => {
      if (generation !== this.generation || !this.valid()) return;
      const value = marker ? Number(marker.detail) : null;
      const time = value === null ? this.original : Number.isInteger(value) ? await this.view.chronosTime(value) : null;
      if (time && generation === this.generation && this.valid()) await this.view.set(time);
    });
  }

  stop(): Promise<void> {
    ++this.generation;
    this.queue = this.queue.catch(() => undefined).then(async () => { if (this.valid()) await this.view.set(this.original); });
    return this.queue;
  }
  async ready(): Promise<void> { let pending: Promise<void>; do { pending = this.queue; await pending; } while (pending !== this.queue); }
}
