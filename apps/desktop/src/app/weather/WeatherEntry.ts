import type { PlaybackMarker, PlaybackState } from "@zigzagumap/core";
import type { Actions } from "../Actions";
import type { EditorState } from "../EditorState";
import type { GameClock } from "../GameClock";
import type { PreviewPlayer } from "../PreviewPlayer";
import type { WeatherChoice, WeatherPreview } from "./WeatherPreview";
import { errorText } from "../../util/errors";

/** プレビューする天候の選択肢の命令の名前（`view.weatherPick.map`・`view.weatherPick.0`〜`14`）。 */
export const WEATHER_PICK_IDS: readonly string[] = ["map", ...Array.from({ length: 15 }, (_, i) => String(i))].map(v => `view.weatherPick.${v}`);

/**
 * 表示 > 天候を表示する（#498）の入口。初めてオンにしたときに `WeatherPreview` を読み込む。既定はオフで、設定に残さない。
 * 選んだ天候（マップの天候・各天候）は、オフの間も覚えておく（ヘッダーは変えない）。
 */
export class WeatherEntry {
  private preview: WeatherPreview | null = null;
  private loading: Promise<WeatherPreview> | null = null;
  private choiceValue: WeatherChoice = "map";

  constructor(
    private readonly state: EditorState,
    private readonly player: PreviewPlayer,
    private readonly clock: GameClock,
    actions: Actions,
    private readonly markers: () => readonly PlaybackMarker[] | null,
  ) {
    actions.register("view.weather", () => this.enabled ? this.stop() : this.start().catch(error => state.setStatus(errorText(error), undefined, true)));
    actions.registerCheck("view.weather", () => this.enabled);
    for (const id of WEATHER_PICK_IDS) {
      const value = id.slice("view.weatherPick.".length);
      const choice: WeatherChoice = value === "map" ? "map" : Number(value);
      actions.register(id, () => this.select(choice));
      actions.registerCheck(id, () => this.choiceValue === choice);
    }
  }

  get enabled(): boolean { return this.preview?.enabled ?? false; }
  get choice(): WeatherChoice { return this.choiceValue; }
  /** 読み込み済みの本体（自動操作）。 */
  get loaded(): WeatherPreview | null { return this.preview; }

  async start(options: { seed?: number } = {}): Promise<void> {
    if (!this.state.session) return;
    const preview = await this.load();
    preview.select(this.choiceValue);
    await preview.start(options.seed ?? 0);
  }

  stop(): void { this.preview?.stop(); }

  /** 天候を選ぶ。表示していなければ、選んで表示を始める（メニュー）。 */
  select(choice: WeatherChoice): void {
    this.choose(choice);
    if (!this.preview?.enabled && this.state.session) void this.start().catch(error => this.state.setStatus(errorText(error), undefined, true));
  }

  /** 天候を選ぶだけ（表示していれば切り替える）。 */
  choose(choice: WeatherChoice): void {
    if (choice !== "map" && !(Number.isInteger(choice) && choice >= 0 && choice < 15)) throw new RangeError("天候は map か 0〜14 です");
    this.choiceValue = choice;
    if (this.preview?.enabled) this.preview.select(choice);
  }

  /** 再生の画面から（PreviewPlayer.onPlayback）。 */
  followPlayback(state: PlaybackState | null): void { this.preview?.followPlayback(state); }

  private load(): Promise<WeatherPreview> {
    this.loading ??= import("./WeatherPreview").then(({ WeatherPreview }) => (this.preview = new WeatherPreview(this.state, this.player, this.clock, this.markers)));
    return this.loading;
  }
}
