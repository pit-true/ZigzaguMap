import { PRIMARY_BLOCK_COUNT, layerMode, unpackBlockAttribute } from "@zigzagumap/core";
import type { TilesetView } from "../../app/TilesetView";
import { hex } from "../../i18n/ja";
import { jaBlockEditor } from "../../i18n/ja.blockEditor";
import { jaPaletteInfo as t } from "../../i18n/ja.paletteInfo";

/** ブロックの情報の材料（`TilesetView` から引く。テストでは直接渡す）。 */
export interface BlockInfoSource {
  /** 属性（u32）。 */
  attribute(block: number): number;
  /** 3 層の情報。 */
  info(block: number): { readonly triple: boolean; readonly tripleChild: boolean; readonly unresolved: boolean; readonly undrawn: boolean };
  /** 3 層の 3 枚目に使う番号（3 層でなければ null）。 */
  thirdOf(block: number): number | null;
}

/** TilesetView から材料を作る。 */
export function blockInfoSource(tiles: TilesetView): BlockInfoSource {
  return { attribute: (b) => tiles.triple.attribute(b), info: (b) => tiles.triple.info(b), thirdOf: (b) => tiles.triple.thirdOf(b) };
}

/**
 * ブロックパレットに乗せたときの情報（#308。Bochi の BlockInfo と同じ項目）:
 * 「ブロック 0x… タイルセット1/2」「挙動: 名前」「重ね方: 名前」（改造後の値。3 層と 3 層の次の番号も）「野生: 草むら／水上」。
 * 挙動と重ね方の名前は、ブロックエディタのコンボと同じ文言。
 */
export function blockInfoText(source: BlockInfoSource, block: number): string {
  const attr = source.attribute(block);
  const fields = unpackBlockAttribute(attr);
  const parts = [t.block(block, block >= PRIMARY_BLOCK_COUNT), t.behavior(jaBlockEditor.behaviors[fields.behavior] ?? hex(fields.behavior, 3))];
  const mode = layerMode(attr);
  const info = source.info(block);
  let layer = t.layer(jaBlockEditor.backgrounds[mode << 4] ?? "");
  if (info.tripleChild) layer += t.tripleChild(block - 1);
  else if (info.unresolved) layer += t.tripleUnresolved;
  else if (info.triple) layer += t.tripleNext(source.thirdOf(block) ?? block + 1);
  else if (info.undrawn) layer += t.undrawn;
  parts.push(layer);
  const wild = t.wild[fields.encounterType];
  if (wild) parts.push(wild);
  return parts.join("  ");
}

