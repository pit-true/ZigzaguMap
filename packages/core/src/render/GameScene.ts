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

/** `overlay`: 背景色と人物より下のBGを描かず、透明な画像に人物と、人物の上に来るBGだけを描く（マップ画像に重ねる用）。 */
export interface SceneOptions {
  readonly overlay?: boolean;
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
  options: SceneOptions = {},
): { readonly image: RgbaImage; readonly unknownBlocks: readonly number[] } {
  if (!Number.isInteger(view.width) || !Number.isInteger(view.height) || view.width < 1 || view.height < 1 || view.width > 4096 || view.height > 4096 || !Number.isFinite(view.x) || !Number.isFinite(view.y)) {
    throw new RangeError("Scene view must have finite coordinates and dimensions from 1 to 4096");
  }
  const image = createImage(view.width, view.height);
  if (!options.overlay) {
    const [r, g, b, a] = renderer.backdropColor();
    new Uint32Array(image.data.buffer, image.data.byteOffset, image.data.length >> 2).fill(new Uint32Array(new Uint8Array([r, g, b, a]).buffer)[0]!);
  }
  const unknown = new Set<number>();
  const visible = actors.filter(a => a.state.visible && a.state.present && a.state.graphicsId >= 0)
    .map(actor => ({
      actor,
      priority: actor.priority ?? actorBgPriority(actor.state.elevation),
      subpriority: actor.subpriority ?? actor.state.subpriority ?? actorSubpriority(actor.state.elevation, actor.state.pixelY, view.y),
    }))
    .sort((a, b) => b.subpriority - a.subpriority || b.actor.state.id - a.actor.state.id);
  const top = Math.max(-1, ...visible.map(v => v.priority));
  const objects = visible.flatMap(entry => [
    { ...entry, effect: false, order: entry.actor.state.id },
    ...(entry.actor.mark && entry.actor.state.mark ? [{ ...entry, priority: 1, subpriority: 0x53, effect: true, order: 0x100 + entry.actor.state.id }] : []),
  ]).sort((a, b) => b.subpriority - a.subpriority || b.order - a.order);
  for (const plane of [3, 2, 1, 0] as const) {
    // 重ね描きでは、人物より上に来るBGだけを描く（下のBGは呼び出し側のマップ画像にある）。
    if (plane && (!options.overlay || plane < top)) {
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
  const s = source.data, d = dest.data;
  const x0 = Math.max(0, -ox), x1 = Math.min(source.width, dest.width - ox);
  for (let y = Math.max(0, -oy); y < Math.min(source.height, dest.height - oy); y++) {
    let from = (y * source.width + x0) * 4, to = ((y + oy) * dest.width + x0 + ox) * 4;
    for (let x = x0; x < x1; x++, from += 4, to += 4) {
      if (!s[from + 3]) continue;
      d[to] = s[from]!; d[to + 1] = s[from + 1]!; d[to + 2] = s[from + 2]!; d[to + 3] = s[from + 3]!;
    }
  }
}
