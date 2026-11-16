import type { PlaybackActorState } from "../script/playback/PlaybackState.js";
import { actorImagePosition } from "../sprite/ActorFrame.js";
import type { BlockRenderer } from "./BlockRenderer.js";
import { createImage, type RgbaImage } from "./color.js";
import { actorBgPriority, actorSubpriority } from "./ActorPriority.js";

export interface SceneActor {
  readonly state: PlaybackActorState;
  readonly image: RgbaImage;
  /** 固定中は固定を始めた時の値を渡す。省略時は現在のelevationから決める。 */
  readonly priority?: number;
  readonly subpriority?: number;
  /** 影と頭上の印もROMから読んだ画像を渡す。影はジャンプで上へ動かさない。 */
  readonly shadow?: RgbaImage | null;
  readonly mark?: RgbaImage | null;
  readonly markOffsetY?: number;
}

/** マップのブロックの代わりに描くマス（ドアの仮のブロック。#474）。`entries` は 8 個のタイル指定、`mode` は重ね方。 */
export interface SceneCell {
  readonly entries: ArrayLike<number>;
  readonly mode: number;
}

export interface SceneView {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 同じ描画を画面・画像書き出しで使う。範囲外の境界ブロックもblockAt側で供給できる。 */
export function renderGameScene(
  renderer: BlockRenderer,
  view: SceneView,
  blockAt: (x: number, y: number) => number | null,
  actors: readonly SceneActor[],
  cfru: boolean,
  cellAt?: (x: number, y: number) => SceneCell | null,
): { readonly image: RgbaImage; readonly unknownBlocks: readonly number[] } {
  if (!Number.isInteger(view.width) || !Number.isInteger(view.height) || view.width < 1 || view.height < 1 || view.width > 4096 || view.height > 4096 || !Number.isFinite(view.x) || !Number.isFinite(view.y)) {
    throw new RangeError("Scene view must have finite coordinates and dimensions from 1 to 4096");
  }
  const image = createImage(view.width, view.height);
  const color = renderer.backdropColor();
  for (let at = 0; at < image.data.length; at += 4) image.data.set(color, at);
  const unknown = new Set<number>();
  const visible = actors.filter(a => a.state.visible && a.state.present && a.state.graphicsId >= 0)
    .map(actor => ({
      actor,
      priority: actor.priority ?? actorBgPriority(actor.state.elevation),
      subpriority: actor.subpriority ?? actor.state.subpriority ?? actorSubpriority(actor.state.elevation, actor.state.pixelY, view.y),
    }))
    .sort((a, b) => b.subpriority - a.subpriority || b.actor.state.id - a.actor.state.id);
  const objects = visible.flatMap(entry => [
    { ...entry, effect: false, order: entry.actor.state.id },
    ...(entry.actor.mark && entry.actor.state.mark ? [{ ...entry, priority: 1, subpriority: 0x53, effect: true, order: 0x100 + entry.actor.state.id }] : []),
  ]).sort((a, b) => b.subpriority - a.subpriority || b.order - a.order);
  for (const plane of [3, 2, 1, 0] as const) {
    if (plane) {
      for (let y = Math.floor(view.y / 16); y < Math.ceil((view.y + view.height) / 16); y++) {
        for (let x = Math.floor(view.x / 16); x < Math.ceil((view.x + view.width) / 16); x++) {
          const cell = cellAt?.(x, y);
          if (cell) {
            const pixels = renderer.renderGameCell(cell.entries, cell.mode, plane, cfru);
            if (pixels) blit(image, { width: 16, height: 16, data: pixels }, x * 16 - view.x, y * 16 - view.y);
            continue;
          }
          const block = blockAt(x, y);
          if (block === null) continue;
          const pixels = renderer.renderGamePlane(block, plane, cfru);
          if (pixels) blit(image, { width: 16, height: 16, data: pixels }, x * 16 - view.x, y * 16 - view.y);
          else unknown.add(block);
        }
      }
    }
    // 影はAddActorBottomで作られるため、同じBG優先度の人物より先に描く。
    for (const { actor, priority } of visible) {
      if (priority !== plane) continue;
      const state = actor.state;
      if (actor.shadow && state.shadow) {
        const at = actorImagePosition({ ...state, height: 0 }, actor.shadow.width, actor.shadow.height);
        blit(image, actor.shadow, at.x - view.x, at.y - view.y);
      }
    }
    for (const { actor, priority, effect } of objects) {
      if (priority !== plane) continue;
      const state = actor.state;
      const at = actorImagePosition(state, actor.image.width, actor.image.height);
      if (effect && actor.mark) blit(image, actor.mark, state.pixelX + (16 - actor.mark.width) / 2 - view.x, at.y + actor.image.height / 2 - 16 - actor.mark.height / 2 + (actor.markOffsetY ?? 0) - view.y);
      else blit(image, actor.image, at.x - view.x, at.y - view.y);
    }
  }
  return { image, unknownBlocks: [...unknown] };
}

/** 画像の外を切り取り、透明でない画素を上書きする（ROMの画像はalphaが0か255）。 */
function blit(dest: RgbaImage, source: { readonly width: number; readonly height: number; readonly data: Uint8ClampedArray }, left: number, top: number): void {
  const ox = Math.round(left), oy = Math.round(top);
  for (let y = Math.max(0, -oy); y < Math.min(source.height, dest.height - oy); y++) {
    for (let x = Math.max(0, -ox); x < Math.min(source.width, dest.width - ox); x++) {
      const from = (y * source.width + x) * 4;
      if (!source.data[from + 3]) continue;
      dest.data.set(source.data.subarray(from, from + 4), ((y + oy) * dest.width + x + ox) * 4);
    }
  }
}
