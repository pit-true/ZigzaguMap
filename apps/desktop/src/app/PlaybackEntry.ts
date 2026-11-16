import { MOVEMENT_DELTA, signAllows, type MovementDirection } from "@zigzagumap/core";
import type { App } from "./App";
import type { PlayerPlacement } from "./PreviewPlayer";
import type { PlaybackController, PlaybackRequest } from "../ui/playback/PlaybackController";
import { inputDialog } from "../ui/InputDialog";
import { jaPlayback as t } from "../i18n/ja.playback";
import { errorText } from "../util/errors";

/** 使うまで再生の計算・画面を読み込まない入口。仮の主人公の「踏む」「話しかける」もここで受ける（#457）。 */
export class PlaybackEntry {
  private loaded: Promise<PlaybackController> | null = null;
  /** 仮の主人公が始めた再生（自動操作が終わりを待つ）。 */
  private triggered: Promise<void> = Promise.resolve();
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
    app.previewPlayer.onStep = placement => this.trigger(this.stepRequest(placement));
    app.previewPlayer.onTalk = placement => {
      const request = this.talkRequest(placement);
      if (typeof request === "string") app.state.setStatus(request);
      else this.trigger(request);
    };
  }
  get(): Promise<PlaybackController> {
    return this.loaded ??= import("../ui/playback/PlaybackController").then(module => new module.PlaybackController(this.app));
  }
  async start(request: PlaybackRequest): Promise<void> { await (await this.get()).start(request); }
  async existing(): Promise<PlaybackController | null> { return this.loaded ? this.loaded : null; }
  /** 仮の主人公の踏む・話しかけるで始めた再生の準備が済むまで待つ。 */
  settled(): Promise<void> { return this.triggered; }

  /** 「ここに仮の主人公を置く」。置いていなければ置き、そのマスへ移す。 */
  placePlayer(x: number, y: number, patch: Partial<Omit<PlayerPlacement, "x" | "y">> = {}): void {
    const preview = this.app.previewPlayer;
    if (!preview.enabled) preview.start();
    preview.setPlayer({ ...patch, x, y });
  }

  /** 踏んだマスの踏むスクリプト（変数の条件は見ない）。無ければ null。 */
  private stepRequest(placement: PlayerPlacement): PlaybackRequest | null {
    const map = this.app.state.map, session = this.app.state.session;
    if (!map || !session?.projectDir) return null;
    const index = (map.doc.events?.traps ?? []).findIndex(trap => trap.x === placement.x && trap.y === placement.y);
    return index < 0 ? null : { target: { map: map.id, kind: "trap", index }, origin: placement, play: true };
  }

  /** 向いている先のマスの人物か看板。看板は向きの条件を見る。無ければ知らせる文。 */
  private talkRequest(placement: PlayerPlacement): PlaybackRequest | string | null {
    const map = this.app.state.map, session = this.app.state.session;
    if (!map || !session?.projectDir) return null;
    const d = MOVEMENT_DELTA[placement.facing as MovementDirection];
    const x = placement.x + d.x, y = placement.y + d.y;
    const events = map.doc.events;
    const person = (events?.persons ?? []).findIndex(p => p.x === x && p.y === y);
    if (person >= 0) return { target: { map: map.id, kind: "person", index: person }, origin: placement };
    const sign = (events?.signs ?? []).findIndex(s => s.x === x && s.y === y && s.content.type === "script");
    if (sign >= 0) return signAllows(events!.signs[sign]!.kind, placement.facing) ? { target: { map: map.id, kind: "sign", index: sign }, origin: placement } : t.signSide;
    return t.nothingToTalk;
  }

  private trigger(request: PlaybackRequest | null): void {
    if (!request) return;
    this.triggered = this.start(request).catch(error => this.app.state.setStatus(errorText(error), undefined, true));
  }
}
