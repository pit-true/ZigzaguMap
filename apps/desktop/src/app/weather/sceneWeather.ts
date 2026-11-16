import type { SceneOptions, SceneView } from "@zigzagumap/core";
import type { OpenMap, ProjectSession } from "../ProjectSession";
import type { ActiveTint } from "../timeOfDay/activeTint";

/**
 * 240×160 の絵（仮の主人公・再生）に重ねる天候（#498）。ここは型と入れ物だけ。
 * 天候を表示していないときは null で、絵は今までと同じ道を通る。
 */
export interface SceneWeatherSource {
  /** そのマップを描くときの色（時間帯の色に天候の段を重ねたもの）と、天候の OBJ を描く関数。何も変えなければ null。 */
  forScene(session: ProjectSession, map: OpenMap, view: SceneView, tint: ActiveTint | null): SceneWeatherFrame | null;
}

export interface SceneWeatherFrame {
  readonly tint: ActiveTint | null;
  readonly objects?: SceneOptions["objects"];
}

let active: SceneWeatherSource | null = null;

/** 今表示している天候（無ければ null）。 */
export function sceneWeather(): SceneWeatherSource | null {
  return active;
}

/** 表示し始めた・止めたときに入れ替える。 */
export function setSceneWeather(source: SceneWeatherSource | null): void {
  active = source;
}
