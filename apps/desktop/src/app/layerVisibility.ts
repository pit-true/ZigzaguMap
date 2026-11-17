import { ALL_LAYERS } from "@zigzagumap/core";

/**
 * マップの表示で描くレイヤー（Phase7 #513。表示 > レイヤーの表示）。core の LAYER_BOTTOM・LAYER_TOP・LAYER_THIRD の組み合わせ。
 * 全部（ALL_LAYERS）のときは今までと同じ描き手を使う。個人設定には残さず、起動したときはいつも全部。
 * ブロックパレットとブロックエディタには適用しない（TilesetView.mapRenderer だけが読む）。
 */
let layers = ALL_LAYERS;

/** 今描くレイヤー。 */
export function activeLayers(): number {
  return layers;
}

/** 描くレイヤーを変える（描き直しは呼ぶ側が行う）。 */
export function setActiveLayers(value: number): void {
  layers = value & ALL_LAYERS;
}
