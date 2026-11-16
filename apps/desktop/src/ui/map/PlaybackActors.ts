import { actorImagePosition, type PlaybackActorState } from "@zigzagumap/core";

export type ActorSpriteSource = (actor: PlaybackActorState) => HTMLCanvasElement | null;

/** 呼び出し側が決めた重なり順で描く。座標はマップ画素（カメラ・倍率は context に設定する）。 */
export function drawPlaybackActors(context: CanvasRenderingContext2D, actors: readonly PlaybackActorState[], source: ActorSpriteSource): void {
  context.save();
  context.imageSmoothingEnabled = false;
  for (const actor of actors) {
    if (!actor.present || !actor.visible || actor.graphicsId < 0) continue;
    const image = source(actor);
    if (!image) continue;
    const at = actorImagePosition(actor, image.width, image.height);
    context.drawImage(image, at.x, at.y);
  }
  context.restore();
}
