import {
  drawWeatherLayer,
  readProjectWhiteSandstorm,
  releaseWeatherLayerBuffer,
  weatherBackgroundPalettes,
  weatherBehindActors,
  weatherChanges,
  weatherChangesPalettes,
  weatherFromHeader,
  WeatherGraphics,
  weatherObjectColors,
  WeatherSimulation,
  weatherSpriteColors,
  tilesetPairPalettes,
  WEATHER,
  type PlaybackMarker,
  type PlaybackState,
  type SceneView,
  type WeatherChange,
  type WeatherLayerItem,
  type WeatherObjectKind,
  type WeatherPaletteEffect,
} from "@zigzagumap/core";
import type { EditorState } from "../EditorState";
import type { ClockSubscription, GameClock } from "../GameClock";
import type { PreviewPlayer } from "../PreviewPlayer";
import type { OpenMap, ProjectSession } from "../ProjectSession";
import type { ActiveTint } from "../timeOfDay/activeTint";
import { jaWeather as t } from "../../i18n/ja.weather";
import { setSceneWeather, type SceneWeatherFrame, type SceneWeatherSource } from "./sceneWeather";

/** プレビューする天候（"map" はヘッダーの値）。 */
export type WeatherChoice = "map" | number;

/** 天候ごとに使う絵。 */
const KINDS: Readonly<Record<number, readonly WeatherObjectKind[]>> = {
  [WEATHER.CLOUDS]: ["cloud"],
  [WEATHER.RAIN]: ["rain"], [WEATHER.THUNDER]: ["rain"], [WEATHER.HEAVY_RAIN]: ["rain"],
  [WEATHER.SNOW]: ["snow"],
  [WEATHER.FOG]: ["fog"], [WEATHER.UNDERWATER]: ["fog"], [WEATHER.BUBBLES]: ["fog", "bubble"],
  [WEATHER.ASH]: ["ash"], [WEATHER.SANDSTORM]: ["sandstorm"], [WEATHER.FOG_DIAGONAL]: ["fogDiagonal"],
};

/**
 * 天候のプレビュー（#498）の本体。`WeatherEntry` が初めてオンにしたときに読み込む。
 * - 共通の時計（`GameClock`）を購読し、1 フレームずつ天候を進めて仮の主人公の絵を描き直す。仮の主人公の絵が出ていない間と再生中は止める。
 * - 再生中は、再生のフレームまで天候を進める（setweather・doweather・resetweather の印に合わせて切り替える）。
 * - オフにしたら購読をやめ、ROM から読んだ絵と作業用の領域を捨てる。マップのヘッダーは変えない。
 */
export class WeatherPreview implements SceneWeatherSource {
  private on = false;
  private choiceValue: WeatherChoice = "map";
  private graphics: { readonly session: ProjectSession; readonly value: WeatherGraphics | null } | null = null;
  private sim: WeatherSimulation | null = null;
  /** 今の sim を作ったときの鍵（セッション・マップ・天候）。 */
  private simKey = "";
  private view: { x: number; y: number } | null = null;
  private subscription: ClockSubscription | null = null;
  private release: (() => void) | null = null;
  private playback: { frame: number; applied: number; changes: readonly WeatherChange[]; key: string } | null = null;
  private problemValue: string | null = null;
  private seed = 0;
  private colorCache = new Map<string, Uint16Array>();
  private draws: { readonly frame: number; readonly items: ReturnType<WeatherSimulation["draws"]> } | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly player: PreviewPlayer,
    private readonly clock: GameClock,
    private readonly markers: () => readonly PlaybackMarker[] | null,
  ) {
    for (const topic of ["session", "map"] as const) state.on(topic, () => this.reset());
    state.on("view", () => this.updateHold());
  }

  get enabled(): boolean { return this.on; }
  get choice(): WeatherChoice { return this.choiceValue; }
  /** 表示できない理由（表示できていれば null）。 */
  get problem(): string | null { return this.problemValue; }

  async start(seed = this.seed): Promise<void> {
    this.seed = seed;
    const session = this.state.session;
    if (session) await this.loadGraphics(session);
    this.on = true;
    this.subscription ??= this.clock.subscribe("weather", (frames) => this.tick(frames));
    this.simKey = "";
    setSceneWeather(this);
    this.updateHold();
    this.report();
    this.player.refresh();
  }

  stop(): void {
    if (!this.on) return;
    this.on = false;
    this.release?.(); this.release = null;
    this.subscription?.dispose(); this.subscription = null;
    setSceneWeather(null);
    this.sim = null; this.simKey = ""; this.graphics = null; this.view = null; this.playback = null;
    this.colorCache.clear(); this.draws = null; this.problemValue = null;
    releaseWeatherLayerBuffer();
    this.state.setStatus(t.stopped);
    this.player.refresh();
  }

  /** プレビューする天候を選ぶ（ヘッダーは変えない）。オフなら選ぶだけ。 */
  select(choice: WeatherChoice): void {
    if (choice !== "map" && !(Number.isInteger(choice) && choice >= 0 && choice < 15)) throw new RangeError("天候は map か 0〜14 です");
    this.choiceValue = choice;
    this.simKey = "";
    if (this.on) { this.report(); this.player.refresh(); }
  }

  /** 時計から（自動操作で進めるときも）。 */
  tick(frames: number): void {
    if (!this.on || this.playback || frames <= 0) return;
    const sim = this.ensure();
    if (!sim) return;
    this.followCamera(sim);
    for (let i = 0; i < Math.min(600, Math.floor(frames)); i++) sim.step();
    this.player.refresh();
  }

  /** 再生の画面から（PreviewPlayer.onPlayback）。null で再生の終わり。 */
  followPlayback(state: PlaybackState | null): void {
    if (!this.on) return;
    if (!state) {
      if (this.playback) { this.playback = null; this.simKey = ""; this.updateHold(); }
      return;
    }
    const map = this.state.map;
    const header = map?.doc.header.weather ?? 0;
    const markers = this.markers() ?? [];
    const changes = weatherChanges(markers, header);
    const key = changes.map(c => `${c.frame}:${c.weather}`).join(",");
    const restart = !this.playback || this.playback.key !== key || state.frame < this.playback.frame;
    const playback = this.playback = restart ? { frame: 0, applied: 0, changes, key } : this.playback!;
    this.updateHold();
    if (restart) this.simKey = "";
    const sim = this.ensure();
    if (!sim) return;
    // 切り替えはその印のフレームの頭で始める（同じ印を二度入れない）。
    let i = playback.applied;
    const applyUpTo = (frame: number) => { while (i < changes.length && changes[i]!.frame <= frame) sim.changeSmooth(changes[i++]!.weather); };
    for (let f = playback.frame; f < state.frame; f++) { applyUpTo(f); sim.step(); }
    applyUpTo(state.frame);
    playback.applied = i; playback.frame = state.frame;
  }

  /** 自動操作の確かめ用。 */
  info(): Record<string, unknown> {
    const sim = this.sim;
    return {
      enabled: this.on, choice: this.choiceValue, weather: this.target(), problem: this.problemValue,
      status: sim?.status ?? null, next: sim?.nextStatus ?? null, frame: sim?.frame ?? 0,
      screen: sim?.screen ?? null, objects: sim?.draws().length ?? 0,
      graphicsBytes: this.graphics?.value?.loadedBytes ?? 0, ashIsSandstorm: this.graphics?.value?.ashIsSandstorm ?? null,
      whiteSandstorm: !!this.graphics?.value?.whiteSandstormPalette,
      subscribed: this.subscription !== null, holders: this.subscription?.holders ?? [], playback: this.playback?.frame ?? null,
    };
  }

  // ---- SceneWeatherSource ----

  forScene(session: ProjectSession, map: OpenMap, view: SceneView, tint: ActiveTint | null): SceneWeatherFrame | null {
    if (!this.on || session !== this.state.session || map !== this.state.map) return null;
    const sim = this.ensure();
    const graphics = this.graphics?.value;
    if (!sim || !graphics || this.problemValue) return null;
    if (view.width === 240 && view.height === 160) this.followCamera(sim, view);
    const mapType = map.doc.header.mapType;
    const cfru = session.projectDir !== null || graphics.ashIsSandstorm;
    const screen = sim.screen;
    const effect: WeatherPaletteEffect = { evy: screen.evy, fogTint: !cfru && sim.status === WEATHER.FOG, cfru, fadeTypes: graphics.fadeTypes };
    const base = tint && tint.tintsMapType(mapType) ? tint : null;
    const changes = weatherChangesPalettes(effect);
    const code = effect.evy + (effect.fogTint ? 32 : 0);
    const wrapped: ActiveTint | null = !changes ? tint : {
      time: base?.time,
      generation: 1_000_000_000 + code * 100_000 + (base?.generation ?? 0),
      tintsMapType: () => true,
      palettes: (primaryPointer, secondaryPointer, primary, secondary) =>
        weatherBackgroundPalettes(base ? base.palettes(primaryPointer, secondaryPointer, primary, secondary) : tilesetPairPalettes(primary.palettes, secondary.palettes), effect),
      sprite: (colors, slot) => {
        const weathered = weatherSpriteColors(colors, slot, effect);
        return base?.sprite ? base.sprite(weathered, slot) : weathered;
      },
    };
    if (this.draws?.frame !== sim.frame) this.draws = { frame: sim.frame, items: sim.draws() };
    const draws = this.draws.items;
    const weather = sim.status;
    const colorsOf = (kind: WeatherObjectKind): Uint16Array | null => {
      const key = `${kind}:${weather}:${code}:${base?.generation ?? 0}`;
      let value = this.colorCache.get(key);
      if (!value) {
        const raw = graphics.palette(kind, weather);
        if (!raw) return null;
        const faded = weatherObjectColors(raw, effect);
        // 天候の絵の色にも時間帯の色をかける（CFRU の動的パレットの番号は決まらないので、人物の 0 番と同じ扱い）。
        value = base?.sprite ? base.sprite(faded, 0) : faded;
        if (this.colorCache.size > 64) this.colorCache.clear();
        this.colorCache.set(key, value);
      }
      return value;
    };
    const objects = draws.length ? (plane: number, image: Parameters<typeof drawWeatherLayer>[0], stage: "under" | "over"): void => {
      const items: WeatherLayerItem[] = [];
      for (const draw of draws) {
        if (draw.priority !== plane || (weatherBehindActors(draw.kind) ? "under" : "over") !== stage) continue;
        const g = graphics.object(draw.kind), colors = colorsOf(draw.kind);
        if (g && colors) items.push({ draw, graphics: g, colors });
      }
      drawWeatherLayer(image, items, sim.eva, sim.evb);
    } : undefined;
    return { tint: wrapped, objects };
  }

  // ---- 内側 ----

  private async loadGraphics(session: ProjectSession): Promise<void> {
    if (this.graphics?.session === session) return;
    let value: WeatherGraphics | null = null;
    try {
      const project = session.projectDir ? await readProjectWhiteSandstorm(session.files) : null;
      value = WeatherGraphics.read(session.project.rom, session.project.game.offsets.weather, { projectAshIsSandstorm: project?.enabled, projectWhiteSandstorm: project?.palette });
    } catch { value = null; }
    this.graphics = { session, value };
  }

  /** 今プレビューする天候（中の番号）。 */
  private target(): number {
    if (this.choiceValue !== "map") return this.choiceValue;
    return weatherFromHeader(this.state.map?.doc.header.weather ?? 0);
  }

  /** 天候・マップが変わっていたら、マップに入ったときの形から作り直す。 */
  private ensure(): WeatherSimulation | null {
    const session = this.state.session, map = this.state.map;
    if (!session || !map) return null;
    if (this.graphics?.session !== session) { this.graphics = null; void this.loadGraphics(session).then(() => { this.simKey = ""; this.player.refresh(); }); return null; }
    const graphics = this.graphics.value;
    const weather = this.target();
    const key = `${map.id}:${weather}:${map.doc.header.weather}`;
    if (this.sim && this.simKey === key) return this.sim;
    this.simKey = key;
    this.problemValue = this.problemOf(weather, graphics);
    if (!graphics) { this.sim = null; return null; }
    const sim = new WeatherSimulation(graphics, this.seed);
    const frame = this.player.frame;
    sim.startDirect(this.problemValue ? WEATHER.NONE : weather, frame?.x ?? 0, frame?.y ?? 0);
    this.view = frame ? { x: frame.x, y: frame.y } : null;
    this.sim = sim; this.draws = null; this.colorCache.clear();
    this.report();
    return sim;
  }

  private problemOf(weather: number, graphics: WeatherGraphics | null): string | null {
    const name = this.nameOf(weather, graphics);
    if (!graphics) return t.cannot(name, t.reasons.rom);
    if (weather === WEATHER.DROUGHT) return t.cannot(name, t.reasons.drought);
    const kinds = weather === WEATHER.ASH && graphics.ashIsSandstorm ? ["sandstorm" as const] : KINDS[weather] ?? [];
    for (const kind of kinds) if (!graphics.object(kind) || !graphics.palette(kind, weather)) return t.cannot(name, t.reasons.graphics);
    return null;
  }

  private nameOf(weather: number, graphics: WeatherGraphics | null | undefined): string {
    if (weather === WEATHER.ASH && graphics?.ashIsSandstorm) return t.whiteSandstorm;
    return t.names[weather] ?? String(weather);
  }

  private followCamera(sim: WeatherSimulation, view?: { x: number; y: number }): void {
    const at = view ?? this.player.frame;
    if (!at) return;
    if (this.view) sim.camera(at.x - this.view.x, at.y - this.view.y);
    this.view = { x: at.x, y: at.y };
  }

  /** 仮の主人公の絵が出ている間だけ時計を動かす。再生中は再生のフレームに合わせる。 */
  private updateHold(): void {
    const stop = !this.on || !this.player.enabled || this.playback !== null;
    if (stop && !this.release && this.subscription) this.release = this.subscription.hold("hidden");
    else if (!stop && this.release) { this.release(); this.release = null; }
  }

  private reset(): void {
    this.sim = null; this.simKey = ""; this.view = null; this.playback = null; this.draws = null; this.colorCache.clear();
    if (this.graphics && this.graphics.session !== this.state.session) this.graphics = null;
  }

  private report(): void {
    if (!this.on) return;
    const weather = this.target();
    const name = this.nameOf(weather, this.graphics?.value);
    if (this.problemValue) this.state.setStatus(this.problemValue, undefined, true);
    else this.state.setStatus(this.player.enabled ? t.started(name) : t.waiting(name));
  }
}
