import { actorFrame, type PlaybackActorState } from "@zigzagumap/core";
import type { ProjectSession } from "../../app/ProjectSession";
import { activeTint, type ActiveTint } from "../../app/timeOfDay/activeTint";
import { canvasOf } from "../canvas";
import type { SpriteSource } from "./EventLayer";

interface SpriteCache {
  generation: number;
  plain: Map<number, HTMLCanvasElement | null>;
  tinted: Map<number, HTMLCanvasElement | null>;
}
const sources = new WeakMap<ProjectSession, SpriteCache>();
const actorSources = new WeakMap<ProjectSession, { generation: number; images: Map<string, HTMLCanvasElement | null> }>();

/** 再生・NPC 用。コマと反転を鍵にし、時間帯を替えたら色付き画像を捨てる。 */
export function actorSpriteSourceFor(session: ProjectSession | null, mapType?: number, tint: ActiveTint | null = activeTint()): ((actor: PlaybackActorState) => HTMLCanvasElement | null) | null {
  const sprites = session?.overworldSprites;
  if (!session || !sprites) return null;
  const useTint = tint && mapType !== undefined && tint.tintsMapType(mapType) ? tint : null;
  let cache = actorSources.get(session);
  if (!cache || cache.generation !== (useTint?.generation ?? 0)) {
    if (cache) for (const image of cache.images.values()) if (image) { image.width = 0; image.height = 0; }
    cache = { generation: useTint?.generation ?? 0, images: new Map() };
    actorSources.set(session, cache);
  }
  const images = cache.images;
  return actor => {
    const frame = actorFrame(sprites, actor);
    if (!frame) return null;
    const key = `${actor.graphicsId}:${frame.index}:${+frame.hFlip}:${+frame.vFlip}`;
    if (images.has(key)) return images.get(key)!;
    const image = sprites.frameImage(actor.graphicsId, frame, useTint?.sprite ?? null);
    const canvas = image ? canvasOf(image) : null;
    images.set(key, canvas);
    if (images.size > 128) {
      const first = images.keys().next().value!;
      const old = images.get(first);
      if (old) { old.width = 0; old.height = 0; }
      images.delete(first);
    }
    return canvas;
  };
}

/** 昼の画像は共有し、時間帯の画像は今の1組だけ持つ。ROMや昼の画像は変えない。 */
export function spriteSourceFor(session: ProjectSession | null, mapType?: number, tint: ActiveTint | null = activeTint()): SpriteSource | null {
  const sprites = session?.overworldSprites;
  if (!session || !sprites) return null;
  let cache = sources.get(session);
  if (!cache) { cache = { generation: 0, plain: new Map(), tinted: new Map() }; sources.set(session, cache); }
  const useTint = tint && mapType !== undefined && tint.tintsMapType(mapType) ? tint : null;
  if (cache.generation !== (useTint?.generation ?? 0)) {
    for (const canvas of cache.tinted.values()) if (canvas) { canvas.width = 0; canvas.height = 0; }
    cache.tinted.clear();
    cache.generation = useTint?.generation ?? 0;
  }
  const canvases = useTint?.sprite ? cache.tinted : cache.plain;
  return (id) => {
    let canvas = canvases.get(id);
    if (canvas === undefined) {
      const image = sprites.image(id, useTint?.sprite ?? null);
      canvas = image ? canvasOf(image) : null;
      canvases.set(id, canvas);
    }
    return canvas;
  };
}
