/**
 * 利用者のスクリプト（Phase5 #405）の、画面（ホスト）と Web Worker のあいだのメッセージ。
 * Worker は決めた API だけをこのメッセージで使う（Tauri の命令も DOM も使えない）。
 */

/** API の名前（ホストが答える。引数と返事はどれも JSON にできる値）。 */
export const USER_SCRIPT_METHODS = [
  // マップ（開いているマップ）
  "map.current",
  "map.getBlock",
  "map.setBlock",
  "map.getMovement",
  "map.setMovement",
  "map.getCells",
  "map.getBorder",
  "map.setBorder",
  "map.getHeader",
  "map.getTilesets",
  "map.fill",
  "map.shift",
  // ほかのマップ（読むだけ）
  "maps.list",
  "maps.getCells",
  // 名前の一覧
  "names.list",
  // 道具
  "ui.message",
  "ui.input",
  "ui.status",
  "ui.registerAction",
  "view.setGrid",
] as const;

export type UserScriptMethod = (typeof USER_SCRIPT_METHODS)[number];

/** 書き込む API（1 回の呼び出し（コールバック・登録した操作）の分を、1 回の「元に戻す」にまとめる）。 */
export const USER_SCRIPT_WRITES: ReadonlySet<UserScriptMethod> = new Set(["map.setBlock", "map.setMovement", "map.setBorder", "map.fill", "map.shift"]);

/** コールバックの名前。 */
export const USER_SCRIPT_EVENTS = ["projectOpened", "projectClosed", "mapOpened", "blocksChanged", "mapResized", "mapShifted", "hoverChanged", "tabChanged"] as const;

export type UserScriptEvent = (typeof USER_SCRIPT_EVENTS)[number];

/** ホストから Worker へ。 */
export type HostToWorker =
  /** スクリプトを読み込む（`name` はファイル名、`code` は中身）。 */
  | { readonly type: "load"; readonly name: string; readonly code: string }
  /** コールバックを呼ぶ。 */
  | { readonly type: "event"; readonly event: UserScriptEvent; readonly payload: unknown }
  /** 登録した操作を動かす。 */
  | { readonly type: "action"; readonly id: string }
  /** API の返事。 */
  | { readonly type: "reply"; readonly id: number; readonly ok: boolean; readonly value?: unknown; readonly error?: string };

/** Worker からホストへ。 */
export type WorkerToHost =
  /** API を呼ぶ。 */
  | { readonly type: "call"; readonly id: number; readonly method: UserScriptMethod; readonly args: readonly unknown[] }
  /** 1 回の呼び出し（コールバック・操作）を始める・終える（書き込みを 1 回の「元に戻す」にまとめる区切り）。 */
  | { readonly type: "begin"; readonly label: string }
  | { readonly type: "end"; readonly error?: string }
  /** スクリプトを読み込んだ（失敗なら `error`）。 */
  | { readonly type: "loaded"; readonly name: string; readonly error?: string }
  /** ログ（`console.log` と `zz.log`）。 */
  | { readonly type: "log"; readonly level: "log" | "warn" | "error"; readonly text: string };

/** API の名前か。 */
export function isUserScriptMethod(name: unknown): name is UserScriptMethod {
  return typeof name === "string" && (USER_SCRIPT_METHODS as readonly string[]).includes(name);
}
