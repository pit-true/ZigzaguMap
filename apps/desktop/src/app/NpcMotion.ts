import type { Actions } from "./Actions";
import type { EditorState } from "./EditorState";
import type { GameClock } from "./GameClock";
import type { PreviewPlayer } from "./PreviewPlayer";
import type { AidTab } from "./viewAids";
import type { MapView } from "../ui/map/MapView";
import type { NpcPreview, NpcPreviewState } from "./NpcPreview";
import { jaNpcMotion as t } from "../i18n/ja.npcMotion";
import { errorText } from "../util/errors";

/**
 * 表示 > 人物を動かす（#471）の入口。初めてオンにしたときに `NpcPreview` を読み込む。既定はオフで、設定に残さない。
 * 再生（#454）などは `hold(owner)` で人物の自分の動きを止める（A-5）。
 */
export class NpcMotion {
  private preview: NpcPreview | null = null;
  private loading: Promise<NpcPreview> | null = null;
  private readonly holds = new Map<string, number>();
  /** 今の NpcPreview の購読に掛けた止め（owner ごと）。 */
  private readonly releases = new Map<string, (() => void)[]>();

  constructor(
    private readonly state: EditorState,
    private readonly views: Readonly<Record<AidTab, MapView>>,
    private readonly player: PreviewPlayer,
    private readonly clock: GameClock,
    actions: Actions,
  ) {
    actions.register("view.npcMotion", () => this.enabled ? this.stop() : this.start().catch(error => state.setStatus(errorText(error), undefined, true)));
    actions.registerCheck("view.npcMotion", () => this.enabled);
  }

  get enabled(): boolean { return this.preview?.enabled ?? false; }

  /** 動かし始める（`seed` は乱数の種。同じ種なら毎回同じ動き）。 */
  async start(options: { seed?: number } = {}): Promise<void> {
    if (!this.state.map || !this.state.session) return;
    const preview = await this.load();
    preview.start(options.seed ?? 0);
    this.releases.clear();
    for (const [owner, count] of this.holds) for (let i = 0; i < count; i++) this.apply(owner);
  }

  stop(): void { this.preview?.stop(); if (this.preview && !this.preview.enabled) this.state.setStatus(t.stopped); }

  /**
   * owner の名前で人物の自分の動きを止める（絵は今の位置のまま）。返した関数で解除する。動かしていないときに呼んでもよく、
   * 後でオンにしたときも解除までは止まったまま。
   */
  hold(owner: string): () => void {
    this.holds.set(owner, (this.holds.get(owner) ?? 0) + 1);
    this.apply(owner);
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const count = (this.holds.get(owner) ?? 1) - 1;
      if (count > 0) this.holds.set(owner, count); else this.holds.delete(owner);
      this.releases.get(owner)?.pop()?.();
    };
  }

  private apply(owner: string): void {
    if (!this.preview?.enabled) return;
    const list = this.releases.get(owner) ?? [];
    list.push(this.preview.hold(owner));
    this.releases.set(owner, list);
  }

  /** 人物の層の画像（自動操作の確認用）。動かしていなければ null。 */
  image(): HTMLCanvasElement | null { return this.preview?.enabled ? this.preview.image() : null; }

  /** 時計を使わずに進める（自動操作のテスト用。止めていても進む）。 */
  advance(frames: number): void { this.preview?.advance(frames); }

  /** 今の状態（自動操作）。 */
  get snapshot(): NpcPreviewState {
    return this.preview?.snapshot ?? { enabled: false, frame: 0, seed: 0, holders: [], clock: this.clock.state, actors: [], missing: 0, cost: { ticks: 0, ms: 0 } };
  }

  private load(): Promise<NpcPreview> {
    this.loading ??= import("./NpcPreview").then(({ NpcPreview }) => (this.preview = new NpcPreview(this.state, this.views, this.player, this.clock)));
    return this.loading;
  }
}
