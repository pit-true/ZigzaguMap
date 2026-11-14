import type { SettingsData } from "./Settings";

/** 拡大を持つタブ。 */
export type ZoomTab = "map" | "movement" | "event";

/** タブごとの「拡大表示」のチェック（表示 > マップの表示サイズ）の設定の名前。 */
export const ZOOM_TOGGLE: Readonly<Record<ZoomTab, "zoomMap" | "zoomMovement" | "zoomEvent">> = {
  map: "zoomMap",
  movement: "zoomMovement",
  event: "zoomEvent",
};

/**
 * タブの表示倍率（1〜8。#316）。Ctrl＋ホイールで決めた倍率（個人設定 `mapZoom`）があればそれ、無ければ（0 なら）
 * 今までどおり「拡大表示」のチェックで 1 倍か 2 倍。
 */
export function tabZoom(s: SettingsData, tab: ZoomTab): number {
  const z = s.mapZoom?.[tab] ?? 0;
  return z > 0 ? z : s[ZOOM_TOGGLE[tab]] ? 2 : 1;
}

/** Ctrl＋ホイールで倍率を変えたときの設定（倍率を覚え、「拡大表示」のチェックは 2 倍以上かに合わせる）。 */
export function zoomPatch(s: SettingsData, tab: ZoomTab, zoom: number): Partial<SettingsData> {
  return { mapZoom: { ...s.mapZoom, [tab]: zoom }, [ZOOM_TOGGLE[tab]]: zoom >= 2 };
}

/** メニューの「拡大表示」を押したときの設定（チェックを切り替え、Ctrl＋ホイールの倍率は忘れる）。 */
export function togglePatch(s: SettingsData, tab: ZoomTab): Partial<SettingsData> {
  return { [ZOOM_TOGGLE[tab]]: !s[ZOOM_TOGGLE[tab]], mapZoom: { ...s.mapZoom, [tab]: 0 } };
}
