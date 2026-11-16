import { movementAction } from "../script/movement/MovementActionTable.js";
import type { PlaybackActorState } from "../script/playback/PlaybackState.js";
import type { OverworldFrame, OverworldSprites, WalkingOffsets } from "./OverworldSprites.js";
import { SpriteAnimation } from "./SpriteAnimation.js";

const DIRECTION = { down: 0, up: 1, left: 2, right: 3 } as const;

/** 人物ごとのアニメーション時計。NPCと再生で使い、1ゲームフレームにつき一度advanceする。 */
export class ActorAnimator {
  private previous: PlaybackActorState | null = null;
  private animation: SpriteAnimation | null = null;
  private issue: "graphics" | "animation" | "walkingTable" | null = null;

  constructor(private readonly sprites: OverworldSprites) {}
  get reason(): typeof this.issue { return this.issue; }

  advance(actor: PlaybackActorState): OverworldFrame | null {
    const old = this.previous;
    this.previous = actor;
    if (!actor.present || actor.graphicsId < 0) { this.animation = null; this.issue = null; return null; }
    const created = !this.animation || old?.graphicsId !== actor.graphicsId || !old.present;
    if (created) {
      this.issue = null;
      if (!this.sprites.info(actor.graphicsId)) { this.issue = "graphics"; return null; }
      this.animation = new SpriteAnimation((animation, command) => this.sprites.animationCommand(actor.graphicsId, animation, command), DIRECTION[actor.facing]);
    }
    const clock = this.animation!;
    const action = actor.movementId === null ? null : movementAction(actor.movementId);
    const begin = created || old?.movementId !== actor.movementId || actor.actionFrame <= old.actionFrame;
    const moving = action?.kind === "walk" || action?.kind === "walkInPlace" || action?.kind === "jump";
    if (begin && action && moving) {
      clock.paused = false;
      if (!actor.animHold) this.startWalking(actor, false);
    } else if (begin && action?.kind === "face") {
      if (!actor.animHold) this.startWalking(actor, true);
      clock.paused = true;
    } else if (!created && old.facing !== actor.facing && !actor.animHold) {
      // changeface / faceplayer、ジャンプの途中の向きの反転。
      this.startWalking(actor, true);
      if (!moving) clock.paused = true;
    }
    if (moving && actor.actionFrame >= action.frames - 1) clock.paused = true;
    if (action?.kind === "walkInPlace" && action.speed === 0.5 && actor.actionFrame % 2 === 1) clock.delay();
    const frame = clock.tick();
    if (clock.failed) this.issue = "animation";
    return this.issue ? null : frame;
  }

  private startWalking(actor: PlaybackActorState, stop: boolean): void {
    const offsets = this.sprites.walkingOffsets(actor.graphicsId);
    if (offsets === undefined) { this.issue = "walkingTable"; return; }
    const action = actor.movementId === null ? null : movementAction(actor.movementId);
    const speed = action?.speed ?? 1;
    const base = stop ? 4 : actor.sprite === "run" ? 20 : speed <= 1 ? 4 : speed <= 3 ? 8 : speed <= 4 ? 12 : 16;
    const number = base + DIRECTION[actor.facing];
    const clock = this.animation!;
    this.issue = null;
    if (stop && !offsets) { clock.select(number); return; }
    const command = stop ? this.stopOffset(clock.commandIndex, offsets!) : this.walkOffset(clock.commandIndex, offsets);
    clock.changeAt(number, command);
  }

  private walkOffset(command: number, offsets: WalkingOffsets | null): number {
    if (offsets && command === offsets.stopLeft) return offsets.walkRight;
    if (offsets && command === offsets.stopRight) return offsets.walkLeft;
    return command;
  }
  private stopOffset(command: number, offsets: WalkingOffsets): number {
    return command <= offsets.stopLeft ? offsets.stopLeft : offsets.stopRight;
  }
}
