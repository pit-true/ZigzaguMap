import { settle } from "../../../app/automation/registry";
import { currentDiagnostics, externalDiagnosticsOf, relint } from "../extensions/lint";
import { requireActive, type EditorCommandTable } from "./common";

/** 波線と保存時の幅検査（`editor.diagnostics` / `editor.widthCheck`）。 */
export const diagnosticsCommands: EditorCommandTable = {
  "editor.diagnostics": async (w) => {
    requireActive(w);
    await w.project.load();
    w.project.flushBuffers();
    relint(w.view);
    await settle(200);
    return { path: w.active!.path, diagnostics: currentDiagnostics(w.view.state), external: externalDiagnosticsOf(w.active!.path) };
  },

  "editor.widthCheck": async (w, req) => {
    // 保存時の幅検査の結果（`wait` が true なら、動いている検査が終わるまで待つ）
    if (req["wait"] === true) await w.widthCheck.idle();
    return { busy: w.widthCheck.busy, runs: w.widthCheck.runs, last: w.widthCheck.last, log: w.widthCheck.log.slice(-200) };
  },
};
