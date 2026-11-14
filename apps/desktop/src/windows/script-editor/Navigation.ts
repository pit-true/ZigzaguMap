import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { ScriptEditorWindow } from "./ScriptEditorWindow";

/** 「戻る」の履歴の数の上限。 */
const MAX_BACK = 100;

/** 定義へ移動などで別の場所へ移ることと、「戻る」（Alt+←）の履歴。 */
export class Navigation {
  /** 「戻る」の履歴（移る前の位置）。 */
  private readonly backStack: { path: string; pos: number }[] = [];

  constructor(private readonly w: ScriptEditorWindow) {}

  /** 戻る履歴の数（自動操作用）。 */
  get depth(): number {
    return this.backStack.length;
  }

  /** 今の位置を「戻る」の履歴に積んでから、ファイルの行（と桁）へ移る。 */
  async navigate(path: string, line: number, column?: number): Promise<boolean> {
    const w = this.w;
    const from = w.active ? { path: w.active.path, pos: w.view.state.selection.main.head } : null;
    if (!(await w.open(path, line))) return false;
    if (from) this.backStack.push(from);
    if (this.backStack.length > MAX_BACK) this.backStack.shift();
    if (column !== undefined && column > 1) {
      const l = w.view.state.doc.line(Math.max(1, Math.min(w.view.state.doc.lines, line)));
      w.view.dispatch({ selection: EditorSelection.cursor(Math.min(l.to, l.from + column - 1)) });
    }
    return true;
  }

  /** 「戻る」（Alt+←）。戻る場所が無ければ false。 */
  async back(): Promise<boolean> {
    const w = this.w;
    const to = this.backStack.pop();
    if (!to) return false;
    if (!(await w.open(to.path))) return false;
    const pos = Math.min(to.pos, w.view.state.doc.length);
    w.view.dispatch({ selection: EditorSelection.cursor(pos), effects: EditorView.scrollIntoView(pos, { y: "center" }) });
    return true;
  }
}
