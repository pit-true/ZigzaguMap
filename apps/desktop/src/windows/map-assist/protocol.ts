import type { AutoPenPart } from "@zigzagumap/core";

/**
 * マップ作成補助（別ウィンドウ。#312）とメインウィンドウのやり取り。ブロックエディタの ToolWindowHost とは別の
 * イベント名で、メイン側の MapAssistHost（開いたときに初めて読み込む）が答える。
 */

/** ウィンドウのラベル（Tauri）。 */
export const MAP_ASSIST_WINDOW = "map-assist";
/** ウィンドウ → メイン。 */
export const MAP_ASSIST_REQUEST_EVENT = "map-assist-request";
/** メイン → ウィンドウ。 */
export const MAP_ASSIST_MESSAGE_EVENT = "map-assist-message";
/** ウィンドウの大きさ（論理ピクセル）。 */
export const MAP_ASSIST_SIZE = { width: 940, height: 560 } as const;

/** RGBA の画像（base64）。 */
export interface AssistImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: string;
}

/** メインで選んでいる範囲（Ctrl＋右ドラッグで選んだ矩形。主マップの座標）。 */
export interface AssistRange {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** ウィンドウに渡す、今のマップのタイルセットの組のこと。 */
export interface AssistData {
  /** タイルセットの組の鍵（変わったら一覧を読み直す）。 */
  readonly key: string;
  /** マップの名前（題名に出す）。 */
  readonly mapName: string;
  /** ブロックパレットの画像（1 行 8 個。主の 640 個のあとに副）。 */
  readonly palette: AssistImage;
  /** 副タイルセットのブロック数。 */
  readonly secondaryCount: number;
  /** マップの大きさと配置（u16）。 */
  readonly map: { readonly width: number; readonly height: number; readonly cells: readonly number[] };
  /** 今の組のパーツ（保存したもの、無ければ同梱の既定かマップから作った候補）。 */
  readonly parts: readonly AutoPenPart[];
  /** パーツが保存していないもの（既定か候補）か。 */
  readonly unsaved: boolean;
  /** メインで選んでいる範囲（無ければ null）。 */
  readonly range: AssistRange | null;
}

/** 範囲を整えるときの指定。 */
export interface TidyOptions {
  readonly edges: boolean;
  readonly repeats: boolean;
  readonly movement: boolean;
}

/** ウィンドウ → メインの要求。 */
export type AssistRequest = { readonly id: number } & (
  | { readonly op: "hello" }
  | { readonly op: "mapImage" }
  | { readonly op: "save"; readonly parts: readonly AutoPenPart[] }
  | { readonly op: "analyze" }
  | { readonly op: "importBochi" }
  | { readonly op: "fill"; readonly part: AutoPenPart }
  | { readonly op: "tidy"; readonly options: TidyOptions }
  | { readonly op: "undo" }
);

/** メイン → ウィンドウ。 */
export type AssistMessage =
  | { readonly type: "reply"; readonly id: number; readonly ok: boolean; readonly result?: unknown; readonly error?: string }
  | { readonly type: "data"; readonly data: AssistData }
  | { readonly type: "range"; readonly range: AssistRange | null };
