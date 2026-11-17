import { ALL_LAYERS, LAYER_BOTTOM, LAYER_THIRD, LAYER_TOP } from "@zigzagumap/core";
import { jaLayers as t } from "../i18n/ja.layers";
import type { Actions } from "./Actions";
import type { EditorState } from "./EditorState";
import { activeLayers, setActiveLayers } from "./layerVisibility";

/** 表示 > レイヤーの表示 の 3 項目（メニューの ID の後ろと、core のビット）。 */
export const LAYER_ITEMS = [
  ["bottom", LAYER_BOTTOM],
  ["top", LAYER_TOP],
  ["third", LAYER_THIRD],
] as const;

export type LayerName = (typeof LAYER_ITEMS)[number][0];

/** メニューの ID（`view.layer.bottom` など）。 */
export function layerActionId(name: LayerName): string {
  return `view.layer.${name}`;
}

/** 外しているレイヤーの名前（ステータスバーの文）。全部出していれば空。 */
export function hiddenLayerNames(mask: number): string[] {
  return LAYER_ITEMS.filter(([, bit]) => (mask & bit) === 0).map(([name]) => t.short[name]!);
}

/** 外の機能（App が渡す）。 */
export interface LayerTogglesHost {
  /** 隣のマップの帯を描き直す。 */
  rebuildNeighbors(): void;
  /** ステータスバーに部品を置く。 */
  addStatusSlot(element: HTMLElement): void;
}

/**
 * レイヤーごとの表示の切り替え（Phase7 #513）。表示 > レイヤーの表示 の 3 つのチェック（既定は全部オン。個人設定に残さない）。
 * 外したレイヤーを描かずに、マップ（マップ・移動エリア・イベントのタブ）と隣のマップの帯、画像の書き出しを描き直す。
 * ブロックパレットとブロックエディタは今のまま。外しているレイヤーがあるあいだは、ステータスバーに「レイヤー: 上を隠しています」を出す。
 */
export class LayerToggles {
  readonly element: HTMLElement;

  constructor(
    private readonly state: EditorState,
    actions: Actions,
    private readonly host: LayerTogglesHost,
  ) {
    this.element = document.createElement("span");
    this.element.className = "status-panel";
    this.element.dataset["autoId"] = "status.layers";
    this.element.title = t.hint;
    this.element.hidden = true;
    host.addStatusSlot(this.element);
    for (const [name, bit] of LAYER_ITEMS) {
      const id = layerActionId(name);
      actions.registerCheck(id, () => (activeLayers() & bit) !== 0);
      actions.register(id, () => this.set(activeLayers() ^ bit));
    }
  }

  /** 今描くレイヤー（core のビット）。 */
  get mask(): number {
    return activeLayers();
  }

  /** 描くレイヤーを変えて描き直す。 */
  set(mask: number): void {
    const next = mask & ALL_LAYERS;
    if (next === activeLayers()) return;
    setActiveLayers(next);
    const names = hiddenLayerNames(next);
    this.element.hidden = names.length === 0;
    this.element.textContent = names.length === 0 ? "" : t.status(names);
    const state = this.state;
    state.mapImage?.redrawAll();
    state.emit("cells");
    this.host.rebuildNeighbors();
    state.emit("view");
  }
}
