import type { EditorState } from "./EditorState";
import type { GameClock } from "./GameClock";
import type { PreviewPlayer } from "./PreviewPlayer";
import type { FollowerPreview } from "./FollowerPreview";

/** 仮の主人公の連れ歩き（#476・#477）の入口。仮の主人公を初めて置いたときに `FollowerPreview` を読み込む。 */
export class FollowerEntry {
  private loaded: Promise<FollowerPreview> | null = null;
  private attached: Promise<void> = Promise.resolve();

  constructor(private readonly state: EditorState, private readonly player: PreviewPlayer, private readonly clock: GameClock) {
    player.activeListeners.add(active => {
      if (active) this.attached = this.get().then(f => f.attach()).catch(() => undefined);
      else void this.loaded?.then(f => f.detach());
    });
  }

  /** 読み込みと欄の準備が済むまで待つ（自動操作）。 */
  async ready(): Promise<FollowerPreview> { await this.attached; return this.get(); }

  private get(): Promise<FollowerPreview> {
    this.loaded ??= import("./FollowerPreview").then(({ FollowerPreview }) => new FollowerPreview(this.state, this.player, this.clock));
    return this.loaded;
  }
}
