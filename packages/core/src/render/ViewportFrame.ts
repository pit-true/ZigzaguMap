import type { PlaybackCamera } from "../script/playback/PlaybackState.js";
import type { SceneView } from "./GameScene.js";

/** mapbg.c: CENTER=(7,7)マス、BASE_OFF_Y=32、DOT_OFF_Y=8。足元は(120,88)。 */
export const PLAYER_SCREEN_ORIGIN = { x: 112, y: 72 } as const;

export function viewportFrame(camera: PlaybackCamera): SceneView {
  return { x: camera.x - PLAYER_SCREEN_ORIGIN.x + camera.shakeX, y: camera.y - PLAYER_SCREEN_ORIGIN.y + camera.shakeY, width: 240, height: 160 };
}
