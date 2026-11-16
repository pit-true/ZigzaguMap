import { EmotionSprites, ProjectEmotes, emotionRise, hasTripleLayerBlocks, OverworldEffects, PLAYER_ID, renderGameScene, resolveActorFrame, type PlaybackActorState, type RgbaImage, type SceneActor, type SceneOptions, type SceneView } from "@zigzagumap/core";
import type { OpenMap, ProjectSession } from "./ProjectSession";
import { activeTint, type ActiveTint } from "./timeOfDay/activeTint";
import { sceneAnimation } from "./animation/sceneAnimation";
import { sceneWeather } from "./weather/sceneWeather";

interface Assets {
  generation: number;
  images: Map<string, RgbaImage | null>;
  effects: OverworldEffects | null | undefined;
  emotions: EmotionSprites | null | undefined;
  emotes: ProjectEmotes | null;
  loading?: Promise<void>;
}
const sessions = new WeakMap<ProjectSession, Assets>();
function assets(session: ProjectSession): Assets {
  let value = sessions.get(session);
  if (!value) { value = { generation: 0, images: new Map(), effects: undefined, emotions: undefined, emotes: null }; sessions.set(session, value); }
  return value;
}
/** PNGの読み込みは再生・NPCを始める時だけ行う。描画の関数は同期のままにする。 */
export async function prepareActorScene(session: ProjectSession): Promise<void> {
  const value = assets(session);
  value.loading ??= (async () => { value.emotes = session.projectDir ? await ProjectEmotes.read(session.files) : null; value.images.clear(); })();
  await value.loading;
}

/** 人物の絵の写しを手放す（仮の主人公・人物を動かすを止めたとき。次に描くときに読み直す。#496）。 */
export function releaseActorScene(session: ProjectSession | null): void {
  const value = session ? sessions.get(session) : undefined;
  if (!value) return;
  value.images.clear(); value.effects = undefined; value.emotions = undefined;
}

/** NPC・再生・仮の主人公の画面と書き出しが共用する、ROMの人物と前景の合成。 */
export function renderActorScene(
  session: ProjectSession,
  map: OpenMap,
  view: SceneView,
  actors: readonly PlaybackActorState[],
  tint: ActiveTint | null = activeTint(),
  outside?: (x: number, y: number) => number | null,
  options?: SceneOptions,
  /** ROM の絵でない人物（連れ歩き #477）。画面の範囲を受け取って、描く形で返す。 */
  extra?: (view: SceneView) => readonly SceneActor[],
) {
  const sprites = session.overworldSprites;
  // 天候（#498）。重ね描き（人物の層）には入れない。表示していなければ null で、今までと同じ。
  const weather = options?.overlay ? null : sceneWeather()?.forScene(session, map, view, tint) ?? null;
  if (weather) {
    tint = weather.tint;
    if (weather.objects) options = { ...options, objects: weather.objects };
  }
  const useTint = tint?.tintsMapType(map.doc.header.mapType) ? tint : null;
  const cache = assets(session);
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
    let mark: RgbaImage | null = null;
    if (actor.mark) {
      if (cache.emotions === undefined) {
        try { cache.emotions = EmotionSprites.read(session.project.rom, session.project.game.offsets.emotionTemplatePointer, sprites); }
        catch { cache.emotions = null; }
      }
      const effect = actor.mark;
      mark = load(`mark:${effect.mark}:${effect.frame}:${player}`, () => effect.mark.startsWith("emote_") ? cache.emotes?.frame(effect.mark, effect.frame, useTint?.sprite ?? null) ?? null : cache.emotions?.frame(effect.mark, effect.frame, player, useTint?.sprite ?? null) ?? null);
      if (!mark) missing.push({ actor: actor.id, reason: "mark" });
    }
    drawn.push({ state: actor, image, shadow, mark, markOffsetY: actor.mark ? emotionRise(actor.mark.frame) : 0 });
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
  // タイルアニメとドア（#473・#474）。動かしていなければ null で、今までと同じ描き手を使う。
  const animation = sceneAnimation()?.forScene(session, map, tint) ?? null;
  const scene = renderGameScene(animation?.renderer ?? map.tiles.mapRenderer(doc.header.mapType, tint), view, blockAt, extra ? [...drawn, ...extra(view)] : drawn, cfru, animation?.cellAt, options);
  return { ...scene, missing };
}
