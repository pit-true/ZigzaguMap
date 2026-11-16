import type { App } from "./App";
import type { PlaybackController, PlaybackRequest } from "../ui/playback/PlaybackController";
import { inputDialog } from "../ui/InputDialog";
import { jaPlayback as t } from "../i18n/ja.playback";

/** 使うまで再生の計算・画面を読み込まない入口。 */
export class PlaybackEntry {
  private loaded: Promise<PlaybackController> | null = null;
  constructor(private readonly app: App) {
    app.actions.register("playback.open", async () => {
      const selection = app.eventTabSelection(), map = app.state.map;
      if (!map) return;
      if (app.state.tab === "event" && ["person", "sign", "trap"].includes(selection.kind)) {
        await this.start({ target: { map: map.id, kind: selection.kind as "person" | "sign" | "trap", index: selection.index } });
      } else {
        const label = await inputDialog(t.menu, t.label, "");
        if (label?.trim()) await this.start({ label: label.trim() });
      }
    });
  }
  get(): Promise<PlaybackController> {
    return this.loaded ??= import("../ui/playback/PlaybackController").then(module => new module.PlaybackController(this.app));
  }
  async start(request: PlaybackRequest): Promise<void> { await (await this.get()).start(request); }
  async existing(): Promise<PlaybackController | null> { return this.loaded ? this.loaded : null; }
}
