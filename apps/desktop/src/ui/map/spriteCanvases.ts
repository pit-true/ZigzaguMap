import type { ProjectSession } from "../../app/ProjectSession";
import { canvasOf } from "../canvas";
import type { SpriteSource } from "./EventLayer";

const sources = new WeakMap<ProjectSession, SpriteSource>();

/**
 * OW 画像を Canvas にして返す関数（セッションごとに作り、描いた画像は覚えておく）。
 * OW の表が読めない ROM なら null。
 */
export function spriteSourceFor(session: ProjectSession | null): SpriteSource | null {
  if (!session) return null;
  let source = sources.get(session);
  if (source) return source;
  const sprites = session.overworldSprites;
  if (!sprites) return null;
  const canvases = new Map<number, HTMLCanvasElement | null>();
  source = (id) => {
    let canvas = canvases.get(id);
    if (canvas === undefined) {
      const image = sprites.image(id);
      canvas = image ? canvasOf(image) : null;
      canvases.set(id, canvas);
    }
    return canvas;
  };
  sources.set(session, source);
  return source;
}
