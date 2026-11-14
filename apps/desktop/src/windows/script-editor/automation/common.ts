import type { EditorState, SelectionRange } from "@codemirror/state";
import { listDialogs } from "../../../app/automation/dialogs";
import type { AutomationRequest, CommandTable } from "../../../app/automation/registry";
import type { EditorFileContext } from "../extensions";
import { currentDiagnostics } from "../extensions/lint";
import { currentEditorTheme } from "../extensions/themes";
import type { ScriptEditorWindow } from "../ScriptEditorWindow";

/** スクリプトエディタの自動操作の要求（JSON 1 件）。 */
export type Req = AutomationRequest;

/** 機能ごとのファイルが登録する、スクリプトエディタの命令の表。 */
export type EditorCommandTable = CommandTable<ScriptEditorWindow>;

/** 開いているファイルが無ければ Error。 */
export function requireActive(w: ScriptEditorWindow): void {
  if (!w.active) throw new Error("開いているファイルがありません");
}

/** 位置（0 始まりの文字の位置）を、行と桁（どちらも 1 から）にする。 */
export function lineColumn(state: EditorState, pos: number): { line: number; column: number; offset: number } {
  const line = state.doc.lineAt(pos);
  return { line: line.number, column: pos - line.from + 1, offset: pos };
}

/** `line`・`column`（1 から）か `offset`（`prefix` が `to` なら `toLine`・`toColumn`・`toOffset`）を、文字の位置にする。無ければ null。 */
export function positionOf(state: EditorState, req: Req, prefix: "" | "to" = ""): number | null {
  const key = (name: string): string => (prefix ? prefix + name[0]!.toUpperCase() + name.slice(1) : name);
  const offset = req[key("offset")];
  if (typeof offset === "number") return Math.max(0, Math.min(state.doc.length, offset));
  const line = req[key("line")];
  if (typeof line !== "number") return null;
  const l = state.doc.line(Math.max(1, Math.min(state.doc.lines, line)));
  const column = typeof req[key("column")] === "number" ? (req[key("column")] as number) : 1;
  return Math.min(l.to, l.from + Math.max(0, column - 1));
}

/** 表示中のファイルの、要求で指した位置（無ければ Error）。 */
export function needPos(w: ScriptEditorWindow, req: Req): number {
  requireActive(w);
  const p = positionOf(w.view.state, req);
  if (p === null) throw new Error("line（と column）か offset を指定してください");
  return p;
}

/** 表示中のタブの拡張に渡しているもの（無ければ Error）。 */
export function ctxOf(w: ScriptEditorWindow): EditorFileContext {
  requireActive(w);
  return w.fileContext(w.active!);
}

/** 選択の範囲（行と桁と、選んだ文字）。 */
export function describeSelection(state: EditorState): unknown[] {
  return state.selection.ranges.map((r: SelectionRange) => ({ anchor: lineColumn(state, r.anchor), head: lineColumn(state, r.head), text: state.sliceDoc(r.from, r.to) }));
}

/** 下の帯のメッセージ。 */
export function messageText(): string {
  return document.querySelector('[data-auto-id="se.message"]')?.textContent ?? "";
}

/** `state` の返事（タブ・カーソル・選択・波線・テーマ・ダイアログ）。 */
export function describe(w: ScriptEditorWindow): Record<string, unknown> {
  const active = w.active;
  const state = w.view.state;
  return {
    tabs: w.tabs.map((tab) => ({ path: tab.path, kind: tab.kind, dirty: tab.dirty, missing: tab.missing, lineEnding: tab.lineEnding, bom: tab.bom, lines: tab.state.doc.lines, rom: tab.rom !== null, readOnly: tab.state.readOnly })),
    active: active?.path ?? null,
    dirty: active?.dirty ?? false,
    cursor: active ? lineColumn(state, state.selection.main.head) : null,
    selection: active ? describeSelection(state) : [],
    message: messageText(),
    diagnostics: active ? currentDiagnostics(state) : [],
    theme: currentEditorTheme(),
    title: document.title,
    dialogs: listDialogs(),
  };
}
