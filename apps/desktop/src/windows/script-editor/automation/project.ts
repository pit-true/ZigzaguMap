import { jsHeapBytes } from "../../../util/jsHeap";
import type { ScriptEditorWindow } from "../ScriptEditorWindow";
import { needPos, type EditorCommandTable } from "./common";

/** このウィンドウの JavaScript のヒープ（MB。小数 1 桁）。 */
function heapMb(): number | null {
  const m = jsHeapBytes();
  return m ? Math.round((m.used / 1048576) * 10) / 10 : null;
}

/** 1 字ずつ打ったときの、画面の更新までの時間（ms）。打った字は最後に消す（履歴にも残さない）。 */
async function measureTyping(w: ScriptEditorWindow, at: number, count: number): Promise<{ count: number; averageMs: number; maxMs: number; lines: number }> {
  const view = w.view;
  const before = view.state;
  const times: number[] = [];
  for (let i = 0; i < count; i++) {
    const p = Math.min(at + i, view.state.doc.length);
    const t0 = performance.now();
    view.dispatch({ changes: { from: p, insert: "a" }, selection: { anchor: p + 1 }, userEvent: "input.type" });
    // 画面の測りと描き直しを済ませる（次のフレームまで待つ）
    view.dom.getBoundingClientRect();
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
    times.push(performance.now() - t0);
  }
  view.setState(before);
  w.active!.state = before;
  w.project.updateBuffer(w.active!.path, before.doc);
  const sum = times.reduce((a, b) => a + b, 0);
  return { count, averageMs: Math.round((sum / Math.max(1, count)) * 10) / 10, maxMs: Math.round(Math.max(...times) * 10) / 10, lines: before.doc.lines };
}

/** プロジェクトの知識と計測（`editor.project` / `editor.perf`）。 */
export const projectCommands: EditorCommandTable = {
  "editor.project": async (w, req) => {
    if (req["wait"] !== false) await w.project.load();
    const a = w.project.assist;
    return {
      loaded: w.project.loaded,
      loadMs: w.project.loadMs,
      problems: w.project.problems,
      dialect: w.project.config?.dialect ?? null,
      commands: a.commands?.commands.length ?? 0,
      labels: a.index.labelNames().length,
      equs: a.index.equNames().length,
      strings: a.strings.labels().length,
      stringFiles: a.strings.paths().length,
      /** このウィンドウの JavaScript のヒープ（MB。Chromium の performance.memory。GC の前の値）。 */
      heapMb: heapMb(),
    };
  },

  "editor.perf": async (w, req) => {
    // 打鍵から描画までの時間（line・column の位置に count 字打って測る。打った字は消す）
    const p = needPos(w, req);
    return measureTyping(w, p, typeof req["count"] === "number" ? req["count"] : 30);
  },
};
