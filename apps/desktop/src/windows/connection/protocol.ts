import type { CommandRecord, MapConnection } from "@zigzagumap/core";

/**
 * コネクションマネージャー（別ウィンドウ。#561）とメインウィンドウのやり取り。ミニマップ（#542）と同じく、専用のイベント名で
 * メイン側の ConnectionHost（初めて開くときに読み込む）が答える。
 *
 * - 接続の一覧の見本はメインの編集中の状態。ウィンドウは表（下書き）を持ち、「保存」でコマンドの JSON を送る。メインが CommandBus で実行する。
 * - 接続先の絵（今のマップと接続先の境目）はメインが作り、ウィンドウが欄を変えたときに頼む。同じ接続・同じ絵なら送らない。
 */

/** ウィンドウのラベル（Tauri）。 */
export const CONNECTION_WINDOW = "connection";
/** ウィンドウ → メイン。 */
export const CONNECTION_REQUEST_EVENT = "connection-request";
/** メイン → ウィンドウ。 */
export const CONNECTION_MESSAGE_EVENT = "connection-message";
/** ウィンドウの大きさ（論理ピクセル）と最小の大きさ。上が AdvanceMap と同じ欄（402×233）、下が接続先の絵。 */
export const CONNECTION_SIZE = { width: 410, height: 470, minWidth: 410, minHeight: 300 } as const;

/** 今のマップの接続。 */
export interface ConnectionData {
  /** 今のマップ（`3.0` の形。マップが無ければ ""）。 */
  readonly key: string;
  /** マップの名前（題名に出す）。 */
  readonly mapName: string;
  readonly connections: readonly MapConnection[];
  /** マップを切り替えた・ROM を開き直した（表を読み直して 1 番目を選ぶ）。 */
  readonly force: boolean;
  /** マップの絵や接続先が変わるたびに増える番号（変わったら絵を頼み直す）。 */
  readonly generation: number;
}

/** RGBA の画像（base64）。 */
export interface ConnectionImage {
  readonly width: number;
  readonly height: number;
  readonly rgba: string;
}

/** 接続先の絵。 */
export interface ConnectionPreview {
  /** 絵（出せなければ null）。 */
  readonly image: ConnectionImage | null;
  /** 絵の範囲（今のマップの左上が原点のマス）。 */
  readonly region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  /** 接続先の帯の置き場所（今のマップの左上が原点のマス）。 */
  readonly bandAt: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  /** 接続先のマップのうち、見えている部分（接続先の左上が原点のマス）。 */
  readonly band: { readonly x: number; readonly y: number; readonly width: number; readonly height: number } | null;
  /** 絵の 1 マスの画素（16 なら等倍。大きいマップは縮める）。 */
  readonly cell: number;
  /** 絵の下の欄の文字（接続先の名前、出せない理由）。 */
  readonly text: string;
}

/** 絵を頼むときの接続（向き・ずれ・相手）。 */
export interface PreviewTarget {
  readonly direction: number;
  readonly offset: number;
  readonly bank: number;
  readonly map: number;
}

/** ウィンドウ → メインの要求。 */
export type ConnectionRequest = { readonly id: number } & (
  | { readonly op: "hello" }
  /** 表の変更（`key` のマップのもの）。メインが相手のずれもそろえてから、1 回の操作で実行する。 */
  | { readonly op: "save"; readonly key: string; readonly commands: readonly CommandRecord[] }
  /** 矢印ボタン: 相手のマップを開く。 */
  | { readonly op: "follow"; readonly bank: number; readonly map: number }
  /** 接続先の絵（同じなら返事は `{ unchanged: true }`）。`target` が null なら絵を消す。 */
  | { readonly op: "preview"; readonly key: string; readonly generation: number; readonly target: PreviewTarget | null }
);

/** メイン → ウィンドウ。 */
export type ConnectionMessage =
  | { readonly type: "reply"; readonly id: number; readonly ok: boolean; readonly result?: unknown; readonly error?: string }
  | { readonly type: "data"; readonly data: ConnectionData };
