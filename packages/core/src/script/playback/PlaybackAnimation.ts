import { ActorAnimator } from "../../sprite/ActorAnimator.js";
import type { OverworldFrame, OverworldSprites } from "../../sprite/OverworldSprites.js";
import type { PlaybackState } from "./PlaybackState.js";
import type { Timeline } from "./Timeline.js";

const MISSING = 0xffff;

/** コマだけを1人・1フレーム2バイトで記録する。戻す操作でも時計を巻き戻す必要が無い。 */
export class PlaybackAnimation {
  private readonly frames = new Map<number, Uint16Array>();
  readonly issues: readonly { readonly actor: number; readonly frame: number; readonly reason: string }[];

  constructor(readonly timeline: Timeline, sprites: OverworldSprites) {
    const length = timeline.lastFrame + 1;
    if (!Number.isSafeInteger(length) || length < 1 || length > 36_001 || length * timeline.tracks.length * 2 > 16 * 1024 * 1024) {
      throw new RangeError("Animation recording exceeds its frame or memory limit");
    }
    const issues: { actor: number; frame: number; reason: string }[] = [];
    for (const track of timeline.tracks) {
      const clock = new ActorAnimator(sprites);
      const frames = new Uint16Array(length);
      let lastReason: string | null = null;
      for (let frame = 0; frame < length; frame++) {
        const actor = timeline.actorAt(track.id, frame)!;
        const image = clock.advance(actor);
        frames[frame] = image ? image.index | (+image.hFlip << 8) | (+image.vFlip << 9) : MISSING;
        if (clock.reason && clock.reason !== lastReason) issues.push({ actor: track.id, frame, reason: clock.reason });
        lastReason = clock.reason;
      }
      this.frames.set(track.id, frames);
    }
    this.issues = issues;
  }

  get byteLength(): number { return [...this.frames.values()].reduce((sum, frames) => sum + frames.byteLength, 0); }

  stateAt(frame: number): PlaybackState {
    const state = this.timeline.stateAt(frame);
    return {
      ...state,
      actors: state.actors.map(actor => {
        const value = this.frames.get(actor.id)?.[state.frame] ?? MISSING;
        const animationFrame: OverworldFrame | null = value === MISSING ? null : { index: value & 255, hFlip: !!(value & 256), vFlip: !!(value & 512) };
        return { ...actor, animationFrame };
      }),
    };
  }
}
