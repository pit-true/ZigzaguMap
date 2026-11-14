/**
 * メインウィンドウとスクリプトエディタ（別ウィンドウ）のやり取りの形。
 *
 * - テキストファイル（`.s`・`.string`）の正本はディスク。開いている間の編集中のバッファはエディタだけが持つ
 *   （マップの編集と違い、CommandBus と履歴は通さない）。読み書きはエディタが `fs_read_text` / `fs_write_text` で直接行う。
 * - エディタ → メイン: `script-editor:request`（ScriptEditorEnvelope）。返事は `script-editor:reply`（同じ id）。
 * - メイン → エディタ: `script-editor:open`（開くファイル）と、`script-editor:query`（未保存の確認など。
 *   エディタは `script-editor:answer` で同じ id の返事を返す）。
 * - 要求・問い合わせの種類を足すときは、下の型に 1 行足し、受け手（ScriptHost / ScriptEditorWindow）の switch に足す。
 */

/** スクリプトエディタのウィンドウのラベル（Tauri）。 */
export const SCRIPT_EDITOR_WINDOW = "script-editor";

/** ファイルを開く指示（行は 1 から。省略で先頭か、開いていれば今の位置のまま）。 */
export interface ScriptOpenRequest {
  readonly path: string;
  readonly line?: number;
}

/** エディタ → メインの要求。 */
export type ScriptEditorRequest =
  /** 準備ができた。返事は、開くのを待っているファイル（ScriptEditorHello）。 */
  | { readonly type: "hello" }
  /** ファイルを保存した（メインはラベルの索引のそのファイルの分を読み直す）。 */
  | { readonly type: "saved"; readonly path: string };

/** `hello` の返事。 */
export interface ScriptEditorHello {
  readonly opens: readonly ScriptOpenRequest[];
}

/** 要求の封筒（返事は同じ id で返す）。 */
export interface ScriptEditorEnvelope {
  readonly id: number;
  readonly request: ScriptEditorRequest;
}

/** 返事（要求への返事と、問い合わせへの答えで同じ形）。 */
export type ScriptEditorReply =
  | { readonly id: number; readonly ok: true; readonly result: unknown }
  | { readonly id: number; readonly ok: false; readonly error: string };

/** メイン → エディタの問い合わせ。 */
export type ScriptEditorQuery =
  /** 未保存のファイルのパス（string[]）。 */
  | { readonly type: "dirty" }
  /** 未保存のファイルを全部保存する（全部保存できたら true）。 */
  | { readonly type: "saveAll" };

/** 問い合わせの封筒。 */
export interface ScriptEditorQueryEnvelope {
  readonly id: number;
  readonly query: ScriptEditorQuery;
}

/** イベント名。 */
export const ScriptEditorEvents = {
  /** エディタ → メイン: 要求。 */
  request: "script-editor:request",
  /** メイン → エディタ: 返事。 */
  reply: "script-editor:reply",
  /** メイン → エディタ: ファイルを開く（ScriptOpenRequest）。 */
  open: "script-editor:open",
  /** メイン → エディタ: 問い合わせ。 */
  query: "script-editor:query",
  /** エディタ → メイン: 問い合わせの答え。 */
  answer: "script-editor:answer",
} as const;

/** ウィンドウの大きさ（初めて開くとき。論理ピクセル）と最小の大きさ。 */
export const SCRIPT_EDITOR_SIZE = { width: 900, height: 640, minWidth: 420, minHeight: 260 } as const;
