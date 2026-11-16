import type { BlockRenderer, SceneCell } from "@zigzagumap/core";
import type { OpenMap, ProjectSession } from "../ProjectSession";
import type { ActiveTint } from "../timeOfDay/activeTint";

/**
 * 240×160 の絵（仮の主人公・再生）に当てるタイルアニメとドア（Phase6 #473・#474）。
 * ここは型と入れ物だけ。動かしていないときは null で、絵は今までと同じ道を通る。
 */
export interface SceneAnimationSource {
  /** そのマップを描くときの描き手とドアのマス。何も動かしていなければ null。 */
  forScene(session: ProjectSession, map: OpenMap, tint: ActiveTint | null): SceneAnimationFrame | null;
}

export interface SceneAnimationFrame {
  readonly renderer: BlockRenderer;
  readonly cellAt?: (x: number, y: number) => SceneCell | null;
}

let active: SceneAnimationSource | null = null;

/** 今動かしているアニメ（無ければ null）。 */
export function sceneAnimation(): SceneAnimationSource | null {
  return active;
}

/** 動かし始めた・止めたときに入れ替える。 */
export function setSceneAnimation(source: SceneAnimationSource | null): void {
  active = source;
}
