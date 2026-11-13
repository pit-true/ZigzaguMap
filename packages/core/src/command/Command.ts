import type { BlockGrid } from "../map/BlockGrid.js";
import type { MapId } from "../map/types.js";

/** JSON にそのまま書ける値。 */
export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

/** JSON にそのまま書けるオブジェクト。コマンドの引数に使う。 */
export type JsonObject = { [key: string]: JsonValue };

/** コマンドが操作する対象（編集中のデータ）への入口。画面・操作列の再生・MCP で同じものを渡す。 */
export interface EditorContext {
  /** マップの編集中の配置を返す。 */
  grid(id: MapId): BlockGrid;
}

/** 操作コマンド。画面の操作はすべてこれを通す。 */
export interface Command<A extends JsonObject = JsonObject> {
  /** コマンド名（操作列の JSON に書く名前）。 */
  readonly name: string;
  /** 引数。JSON にして保存・再生できる。 */
  readonly args: A;
  /** 実行する。やり直し（リドゥ）でも呼ばれる。 */
  do(context: EditorContext): void;
  /** 実行前の状態に戻す。 */
  undo(context: EditorContext): void;
}

/** コマンドを JSON にしたもの（操作列の 1 行）。 */
export interface CommandRecord {
  readonly name: string;
  readonly args: JsonObject;
}
