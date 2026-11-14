import { BlockUsage, affectedMaps, layoutOf } from "@zigzagumap/core";
import type { EditorState } from "./EditorState";

/** ROM を開いてから数え始めるまでの待ち（起動とマップの表示を先にする）。 */
const BUILD_DELAY_MS = 800;

/**
 * ブロックの使用回数の索引（#235）。ROM を開いたあと、少し待ってから全マップを 1 回なめて作る（マップの表示を遅らせない）。
 * 操作でマップが変わったら、そのマップの分だけ差し替える。変わったら `listeners` に知らせる。
 */
export class BlockUsageService {
  private usage: BlockUsage | null = null;
  private building: Promise<BlockUsage | null> | null = null;
  private timer: number | null = null;
  private generation = 0;
  private readonly listeners = new Set<() => void>();
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly state: EditorState) {
    state.on("session", () => this.reset());
  }

  /** 作り終えた索引（まだなら null）。 */
  get ready(): BlockUsage | null {
    return this.usage;
  }

  /** 変わったときに呼ぶ。 */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    for (const l of this.listeners) l();
  }

  private reset(): void {
    this.generation++;
    this.usage = null;
    this.building = null;
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.unsubscribe?.();
    this.unsubscribe = null;
    const session = this.state.session;
    if (!session) return;
    this.unsubscribe = session.bus.subscribe((e) => this.onCommand(e.command));
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.build();
    }, BUILD_DELAY_MS);
    this.notify();
  }

  /** 索引を作る（作っている途中ならそれを待つ）。 */
  build(): Promise<BlockUsage | null> {
    if (this.usage) return Promise.resolve(this.usage);
    const session = this.state.session;
    if (!session) return Promise.resolve(null);
    if (this.timer !== null) {
      window.clearTimeout(this.timer);
      this.timer = null;
    }
    const generation = this.generation;
    this.building ??= BlockUsage.build(session.project).then(
      (u) => {
        if (generation !== this.generation) return null;
        this.usage = u;
        this.notify();
        return u;
      },
      () => null,
    );
    return this.building;
  }

  private onCommand(record: Parameters<typeof affectedMaps>[0]): void {
    const usage = this.usage;
    const session = this.state.session;
    if (!usage || !session) return;
    let changed = false;
    for (const id of affectedMaps(record)) {
      const doc = session.project.loaded(id);
      if (doc) usage.set(layoutOf(doc));
      else usage.remove(id);
      changed = true;
    }
    if (changed) this.notify();
  }
}
