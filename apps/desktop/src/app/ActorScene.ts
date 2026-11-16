import { hasTripleLayerBlocks, OverworldEffects, PLAYER_ID, renderGameScene, resolveActorFrame, type PlaybackActorState, type RgbaImage, type SceneActor, type SceneOptions, type SceneView } from "@zigzagumap/core";
import type { OpenMap, ProjectSession } from "./ProjectSession";
import { activeTint, type ActiveTint } from "./timeOfDay/activeTint";

interface Assets {
  generation: number;
  images: Map<string, RgbaImage | null>;
  effects: OverworldEffects | null | undefined;
}
const sessions = new WeakMap<ProjectSession, Assets>();

/** NPC・再生・仮の主人公の画面と書き出しが共用する、ROMの人物と前景の合成。 */
export function renderActorScene(
  session: ProjectSession,
  map: OpenMap,
  view: SceneView,
  actors: readonly PlaybackActorState[],
  tint: ActiveTint | null = activeTint(),
  outside?: (x: number, y: number) => number | null,
  options?: SceneOptions,
) {
  const sprites = session.overworldSprites;
  const useTint = tint?.tintsMapType(map.doc.header.mapType) ? tint : null;
  let cache = sessions.get(session);
  if (!cache) {
    cache = { generation: 0, images: new Map(), effects: undefined };
    sessions.set(session, cache);
  }
  if (cache.generation !== (useTint?.generation ?? 0)) {
    cache.images.clear();
    cache.generation = useTint?.generation ?? 0;
  }
  const missing: { actor: number; reason: string }[] = [];
  const player = actors.find(a => a.id === PLAYER_ID)?.graphicsId ?? 0;
  const images = cache.images;
  function load(key: string, read: () => RgbaImage | null): RgbaImage | null {
    if (images.has(key)) return images.get(key)!;
    const value = read();
    images.set(key, value);
    if (images.size > 128) images.delete(images.keys().next().value!);
    return value;
  }
  const drawn: SceneActor[] = [];
  if (!sprites) for (const actor of actors) if (actor.present && actor.visible && actor.graphicsId >= 0) missing.push({ actor: actor.id, reason: "graphics" });
  if (sprites) for (const actor of actors) {
    const result = resolveActorFrame(sprites, actor);
    if (!result.frame) {
      if (result.reason !== "hidden") missing.push({ actor: actor.id, reason: result.reason ?? "animation" });
      continue;
    }
    const frame = result.frame;
    const image = load(`${actor.graphicsId}:${frame.index}:${+frame.hFlip}:${+frame.vFlip}`, () => sprites.frameImage(actor.graphicsId, frame, useTint?.sprite ?? null));
    if (!image) { missing.push({ actor: actor.id, reason: "image" }); continue; }
    let shadow: RgbaImage | null = null;
    if (actor.shadow) {
      if (cache.effects === undefined) {
        try { cache.effects = OverworldEffects.read(session.project.rom, session.project.game.offsets.fieldEffectTemplateTablePointer, sprites); }
        catch { cache.effects = null; }
      }
      shadow = load(`shadow:${actor.graphicsId}:${player}`, () => cache.effects?.shadow(actor.graphicsId, player, useTint?.sprite ?? null) ?? null);
      if (!shadow) missing.push({ actor: actor.id, reason: "shadow" });
    }
    drawn.push({ state: actor, image, shadow });
  }
  const doc = map.doc;
  const blockAt = (x: number, y: number): number | null => {
    if (x >= 0 && y >= 0 && x < doc.width && y < doc.height) return doc.grid.getBlock(x, y);
    const neighbor = outside?.(x, y);
    if (neighbor !== null && neighbor !== undefined) return neighbor;
    const b = doc.border;
    if (!b.width || !b.height) return null;
    return b.getBlock(((x % b.width) + b.width) % b.width, ((y % b.height) + b.height) % b.height);
  };
  const cfru = session.projectDir !== null || hasTripleLayerBlocks(session.project.rom, session.project.game.offsets);
  const scene = renderGameScene(map.tiles.mapRenderer(doc.header.mapType, tint), view, blockAt, drawn, cfru, options);
  return { ...scene, missing };
}
