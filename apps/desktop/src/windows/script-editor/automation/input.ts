import { startCompletion } from "@codemirror/autocomplete";
import { addCursorAbove, addCursorBelow, copyLineDown, copyLineUp, moveLineDown, moveLineUp, redo, toggleComment, undo } from "@codemirror/commands";
import { closeLintPanel, openLintPanel } from "@codemirror/lint";
import { selectNextOccurrence, selectSelectionMatches } from "@codemirror/search";
import { EditorSelection } from "@codemirror/state";
import type { Command } from "@codemirror/view";
import { settle, str } from "../../../app/automation/registry";
import type { ScriptEditorWindow } from "../ScriptEditorWindow";
import { describe, describeSelection, needPos, positionOf, requireActive, type EditorCommandTable, type Req } from "./common";

/** `editor.command` で呼べる CodeMirror の命令。 */
const COMMAND_BY_NAME: Readonly<Record<string, Command>> = {
  moveLineUp,
  moveLineDown,
  copyLineUp,
  copyLineDown,
  toggleComment,
  selectNextOccurrence,
  selectSelectionMatches,
  addCursorAbove,
  addCursorBelow,
  undo,
  redo,
  startCompletion,
  openLintPanel,
  closeLintPanel,
};

/** エディタの本文へキーを送る（Ctrl+S・Ctrl+Z・Enter など、キーの割り当てを通る）。本文が無ければウィンドウへ送る。 */
async function sendKey(w: ScriptEditorWindow, req: Req): Promise<unknown> {
  const init = { key: str(req, "key"), ctrlKey: req["ctrl"] === true, altKey: req["alt"] === true, shiftKey: req["shift"] === true, bubbles: true, cancelable: true };
  const target = w.active ? w.view.contentDOM : document.body;
  if (w.active) w.view.focus();
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  await settle(200);
  return describe(w);
}

/** 入力（`editor.type` / `editor.key` / `key` / `editor.command` / `editor.mouse`）。 */
export const inputCommands: EditorCommandTable = {
  "editor.type": (w, req) => {
    // 入力した文字を、今の選択と置き換える（キーを押して入力したときと同じ取引。IME は通さない）
    requireActive(w);
    const at = positionOf(w.view.state, req);
    if (at !== null) w.view.dispatch({ selection: EditorSelection.cursor(at) });
    w.view.dispatch(w.view.state.replaceSelection(str(req, "text")), { userEvent: "input.type", scrollIntoView: true });
    return describe(w);
  },
  "editor.key": sendKey,
  key: sendKey,

  "editor.command": async (w, req) => {
    requireActive(w);
    const name = str(req, "name");
    const cmd = COMMAND_BY_NAME[name];
    if (!cmd) throw new Error(`知らない name です: ${name}（${Object.keys(COMMAND_BY_NAME).join(", ")}）`);
    w.view.focus();
    const done = cmd(w.view);
    await settle(100);
    return { done, text: w.view.state.doc.toString(), selection: describeSelection(w.view.state) };
  },

  "editor.mouse": async (w, req) => {
    // 本文の位置でマウスを押す（Ctrl+クリックの定義へ移動・カーソルを足す、Alt+ドラッグの矩形選択）。toLine があればドラッグ
    const p = needPos(w, req);
    const view = w.view;
    view.dispatch({ effects: [] });
    const at = (q: number) => {
      const c = view.coordsAtPos(q);
      if (!c) throw new Error("その位置は画面に出ていません");
      return { x: c.left + 1, y: (c.top + c.bottom) / 2 };
    };
    const start = at(p);
    const mods = { ctrlKey: req["ctrl"] === true, altKey: req["alt"] === true, shiftKey: req["shift"] === true };
    const init = (x: number, y: number, buttons: number) => ({ clientX: x, clientY: y, button: 0, buttons, bubbles: true, cancelable: true, view: window, detail: 1, ...mods });
    view.contentDOM.dispatchEvent(new MouseEvent("mousedown", init(start.x, start.y, 1)));
    const to = positionOf(view.state, req, "to");
    if (to !== null) {
      const end = at(to);
      for (let i = 1; i <= 4; i++) {
        const x = start.x + ((end.x - start.x) * i) / 4;
        const y = start.y + ((end.y - start.y) * i) / 4;
        document.dispatchEvent(new MouseEvent("mousemove", init(x, y, 1)));
        await settle(30);
      }
    }
    const last = to !== null ? at(to) : start;
    document.dispatchEvent(new MouseEvent("mouseup", init(last.x, last.y, 0)));
    await settle(250);
    return { active: w.active?.path ?? null, selection: w.active ? describeSelection(w.view.state) : [], back: w.backDepth };
  },
};
