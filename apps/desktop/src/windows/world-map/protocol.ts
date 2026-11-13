import type { CommandRecord, RegionMapGraphicsData, RegionMapSnapshot } from "@zigzagumap/core";

/** ワールドマップエディターのウィンドウのラベル（Tauri）。 */
export const WORLD_MAP_WINDOW = "world-map";

/** メインウィンドウ → エディター: 編集中の状態（表と名前）。 */
export interface WorldMapState {
  readonly snapshot: RegionMapSnapshot;
  /** 地名 0x58〜0xC4 の名前（編集後）。 */
  readonly names: (string | null)[];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/** メインウィンドウで開いているマップ。 */
export interface WorldMapCurrent {
  readonly bank: number;
  readonly map: number;
  /** そのマップの地名番号。 */
  readonly section: number;
}

/** 開いたときに渡すもの。 */
export interface WorldMapInit extends WorldMapState {
  readonly graphics: RegionMapGraphicsData;
  /** 地名 0x58〜0xC4 の名前の文字列の位置（ROM 先頭から）。 */
  readonly nameOffsets: number[];
  readonly current: WorldMapCurrent | null;
}

/** エディター → メインウィンドウの要求。 */
export type WorldMapRequest =
  | { readonly type: "load" }
  | { readonly type: "command"; readonly record: CommandRecord }
  | { readonly type: "undo" }
  | { readonly type: "redo" }
  | { readonly type: "export" }
  | { readonly type: "openMap"; readonly bank: number; readonly map: number };

/** 要求の封筒（返事は同じ id で返す）。 */
export interface WorldMapEnvelope {
  readonly id: number;
  readonly request: WorldMapRequest;
}

/** 返事。 */
export type WorldMapReply = { readonly id: number; readonly ok: true; readonly result: unknown } | { readonly id: number; readonly ok: false; readonly error: string };

/** イベント名。 */
export const WorldMapEvents = {
  /** エディター → メイン: 要求。 */
  request: "world-map:request",
  /** メイン → エディター: 返事。 */
  reply: "world-map:reply",
  /** メイン → エディター: 状態が変わった（WorldMapState）。 */
  state: "world-map:state",
  /** メイン → エディター: 開いているマップが変わった（WorldMapCurrent | null）。 */
  current: "world-map:current",
  /** メイン → エディター: ROM を開き直した（読み直す）。 */
  reset: "world-map:reset",
} as const;
