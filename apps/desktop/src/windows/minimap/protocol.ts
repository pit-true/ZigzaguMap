/**
 * ミニマップ（別ウィンドウ。#542）とメインウィンドウのやり取り。マップ作成補助と同じく、専用のイベント名で
 * メイン側の MinimapHost（初めて開くときに読み込む）が答える。
 *
 * - 縮小図（長い辺 200 画素まで）とタウンマップの拡大は、メインが作り、変わったときだけ RGBA で送る（`thumb`・`town`）。
 * - 見えている範囲の枠は、スクロール・タブの切り替え・拡大のたびに小さな知らせ（`frame`）で送る。
 * - ウィンドウで縮小図を押すと `press`（縮小図の画素）を送り、メインがその位置を真ん中にスクロールする。
 */

/** ウィンドウのラベル（Tauri）。 */
export const MINIMAP_WINDOW = "minimap";
/** ウィンドウ → メイン。 */
export const MINIMAP_REQUEST_EVENT = "minimap-request";
/** メイン → ウィンドウ。 */
export const MINIMAP_MESSAGE_EVENT = "minimap-message";
/** ウィンドウの大きさ（論理ピクセル。縮小図だけのとき）と最小の大きさ。 */
export const MINIMAP_SIZE = { width: 240, height: 250, minWidth: 120, minHeight: 100 } as const;
/** タウンマップの拡大を出したときに、ウィンドウの高さに足す分（拡大の 160 と下の欄）。 */
export const MINIMAP_TOWN_HEIGHT = 190;

/** RGBA の画像（base64）。 */
export interface MinimapImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: string;
}

/** 見えている範囲の枠（縮小図の画素）。 */
export interface MinimapFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 縮小図（マップが無ければ `image` が null）。 */
export interface MinimapThumb {
  readonly image: MinimapImage | null;
  /** マップの名前（題名に出す）。 */
  readonly mapName: string;
}

/** 枠と、縮小図を出すタブか。 */
export interface MinimapView {
  /** マップ・移動エリア・イベントのタブで、縮小図があるとき。 */
  readonly frame: MinimapFrame | null;
  /** 縮小図を隠して出す文（出さなければ null）。 */
  readonly note: string | null;
}

/** タウンマップの拡大（出していなければ null）。 */
export interface MinimapTown {
  readonly image: MinimapImage | null;
  /** 下の欄の文字。 */
  readonly text: string;
}

/** 開いたとき（`hello` の返事）の全部。 */
export interface MinimapAll {
  readonly thumb: MinimapThumb;
  readonly view: MinimapView;
  readonly townShown: boolean;
  readonly town: MinimapTown | null;
}

/** ウィンドウ → メインの要求。 */
export type MinimapRequest = { readonly id: number } & (
  | { readonly op: "hello" }
  | { readonly op: "press"; readonly x: number; readonly y: number }
  | { readonly op: "town"; readonly on: boolean }
);

/** メイン → ウィンドウ。 */
export type MinimapMessage =
  | { readonly type: "reply"; readonly id: number; readonly ok: boolean; readonly result?: unknown; readonly error?: string }
  | { readonly type: "thumb"; readonly thumb: MinimapThumb }
  | { readonly type: "view"; readonly view: MinimapView }
  /** タウンマップの拡大（`shown` は「タウンマップも出す」の印。自動操作で変えたときもウィンドウの印を合わせる）。 */
  | { readonly type: "town"; readonly shown: boolean; readonly town: MinimapTown | null };
