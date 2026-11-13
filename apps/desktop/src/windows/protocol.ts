/**
 * メインウィンドウと別ウィンドウ（ブロックエディタなど）のやり取りの形。
 *
 * - 編集の状態（CommandBus とタイルセット）はメインウィンドウだけが持つ。別ウィンドウは写しを表示する。
 * - 別ウィンドウ → メイン: イベント `tool-request`（ToolRequest）。操作はコマンドの JSON（name と args）で送り、
 *   メインが CommandBus で実行する（アンドゥ・リドゥはメインと同じ履歴に入る）。
 * - メイン → 別ウィンドウ: イベント `tool-message`（ToolMessage）。返事、タイルセットの写し（snapshot）、
 *   ウィンドウどうしで共有する表示の状態（ui）。
 * - 自動操作の要求は、Rust が `window` 付きの要求を直接そのウィンドウへ送る（toolAutomation.ts）。
 */

/** 別ウィンドウの種類（Tauri のウィンドウのラベル）。 */
export type ToolKind = "block-editor" | "palette-editor" | "block-adjust";

/** 別ウィンドウ → メインのイベント名。 */
export const TOOL_REQUEST_EVENT = "tool-request";
/** メイン → 別ウィンドウのイベント名。 */
export const TOOL_MESSAGE_EVENT = "tool-message";

/** タイルセット 1 つの写し。 */
export interface TilesetData {
  /** マップのヘッダーのポインタ値（コマンドの `tileset`）。 */
  readonly pointer: number;
  readonly secondary: boolean;
  /** AdvanceMap のタイルセット番号（表に無ければ null）。 */
  readonly index: number | null;
  /** 4bpp タイル（base64）。 */
  readonly tiles: string;
  /** パレット（BGR555 × 256）。 */
  readonly palettes: number[];
  /** ブロック定義（u16 リトルエンディアンの base64）。 */
  readonly blocks: string;
  /** 属性（u32）。 */
  readonly attributes: number[];
  /** ブロック数の上限（主 640、副 384）。 */
  readonly blockCapacity: number;
  /** タイル数の上限（主 640、副 384）。 */
  readonly tileCapacity: number;
  /** ベース ROM でのブロック定義の位置（Offset 欄。ROM に無ければ null）。 */
  readonly romBlocksOffset: number | null;
}

/** 表示中のマップのタイルセットの写し。 */
export interface ToolSnapshot {
  /** 写しを作るたびに増える番号。 */
  readonly version: number;
  readonly map: { readonly bank: number; readonly map: number } | null;
  readonly primary: TilesetData | null;
  readonly secondary: TilesetData | null;
}

/** ウィンドウどうしで共有する表示の状態。 */
export interface ToolUiState {
  /** 選んでいるパレット（ブロックエディタの Palette 欄とパレットエディタで同じ）。 */
  readonly palette: number;
  /** 一時適用した色（パレット番号 → 16 色）。「パレットの変更を反映する」でコマンドになる。 */
  readonly preview: Readonly<Record<number, readonly number[]>>;
}

/** 別ウィンドウ → メインの要求。 */
export type ToolRequest =
  | { readonly from: ToolKind; readonly id: number; readonly op: "hello" }
  | { readonly from: ToolKind; readonly id: number; readonly op: "execute"; readonly name: string; readonly args: Record<string, unknown> }
  | { readonly from: ToolKind; readonly id: number; readonly op: "undo" | "redo" | "export" | "commitPreview" }
  | { readonly from: ToolKind; readonly id: number; readonly op: "setUi"; readonly palette?: number; readonly preview?: Record<number, readonly number[]> }
  | { readonly from: ToolKind; readonly id: number; readonly op: "open"; readonly kind: ToolKind };

/** メイン → 別ウィンドウの知らせ。 */
export type ToolMessage =
  | { readonly type: "reply"; readonly id: number; readonly ok: boolean; readonly result?: unknown; readonly error?: string }
  | { readonly type: "snapshot"; readonly snapshot: ToolSnapshot; readonly ui: ToolUiState }
  | { readonly type: "ui"; readonly ui: ToolUiState };

/** 別ウィンドウの大きさ（内側）。AdvanceMap の外寸から題名の帯と枠を除いた値。 */
export const TOOL_WINDOW_SIZES: Readonly<Record<ToolKind, { readonly width: number; readonly height: number }>> = {
  "block-editor": { width: 823, height: 253 },
  "palette-editor": { width: 286, height: 186 },
  "block-adjust": { width: 264, height: 461 },
};
