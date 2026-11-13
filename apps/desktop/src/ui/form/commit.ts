import type { Command } from "@zigzagumap/core";
import { CommandGroup } from "../../app/CommandGroup";
import type { EditorState } from "../../app/EditorState";
import { showEditError } from "./inputErrors";

/**
 * 編集中の状態へ反映する（AdvanceMap の「保存」ボタン類の読み替え。ROM へは書かない）。
 * コマンドが 2 つ以上なら 1 回の操作にまとめる。入力エラーはダイアログで出し、何も変えずに false を返す。
 * コマンドが無ければ何もせず true。
 */
export function commit(state: EditorState, commands: readonly Command[]): boolean {
  const bus = state.session?.bus;
  if (!bus) return false;
  if (commands.length === 0) return true;
  try {
    bus.execute(commands.length === 1 ? commands[0]! : new CommandGroup(commands));
    return true;
  } catch (e) {
    void showEditError(e);
    return false;
  }
}

/**
 * 操作（実行・アンドゥ・リドゥ）があったら呼ぶ。開き直したセッションにも付け直す。
 * 画面の部品が自分の表示を読み直すのに使う。
 */
export function watchCommands(state: EditorState, listener: () => void): void {
  let unsubscribe: (() => void) | null = null;
  const attach = (): void => {
    unsubscribe?.();
    unsubscribe = state.session?.bus.subscribe(listener) ?? null;
  };
  state.on("session", attach);
  attach();
}
