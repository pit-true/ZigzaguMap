import { movementAction } from "../script/movement/MovementActionTable.js";
import type { PlaybackActorState } from "../script/playback/PlaybackState.js";
import type { OverworldFrame, OverworldSprites } from "./OverworldSprites.js";

export interface ActorFrameResult {
  readonly frame: OverworldFrame | null;
  readonly reason: "hidden" | "graphics" | "animation" | null;
}

/** evobjdat.def の標準アニメーション番号。別の向きの画像へ黙って置き換えない。 */
export function resolveActorFrame(sprites: OverworldSprites, actor: PlaybackActorState): ActorFrameResult {
  if (!actor.present || !actor.visible || actor.graphicsId < 0) return { frame: null, reason: "hidden" };
  if (!sprites.info(actor.graphicsId)) return { frame: null, reason: "graphics" };
  const direction = { down: 0, up: 1, left: 2, right: 3 }[actor.facing];
  const action = actor.movementId === null ? null : movementAction(actor.movementId);
  const speed = action?.speed ?? 1;
  let base = 0;
  if (actor.sprite === "run") base = 20;
  else if (actor.sprite === "walk" || actor.sprite === "walkFast" || actor.sprite === "jump") {
    base = speed <= 1 ? 4 : speed <= 3 ? 8 : speed <= 4 ? 12 : 16;
  }
  // 通常の WALK_05 は絵の周期を変えない。STAY_WALK_05 だけ anm_wait を隔フレーム延ばす。
  const elapsed = actor.animHold ? 0 : Math.floor(actor.actionFrame / (speed === 0.5 && action?.kind === "walkInPlace" ? 2 : 1));
  const frame = sprites.animationFrame(actor.graphicsId, base + direction, elapsed);
  return { frame, reason: frame ? null : "animation" };
}

export function actorFrame(sprites: OverworldSprites, actor: PlaybackActorState): OverworldFrame | null {
  return resolveActorFrame(sprites, actor).frame;
}

/** マスの下端を足元として、移動途中の座標とジャンプの高さを反映する。 */
export function actorImagePosition(actor: PlaybackActorState, width: number, height: number): { x: number; y: number } {
  return { x: actor.pixelX + (16 - width) / 2, y: actor.pixelY + 16 - height + actor.height };
}
