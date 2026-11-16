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
