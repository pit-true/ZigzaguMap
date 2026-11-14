import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CommandRegistry, nextFrame } from "../../../app/automation/registry";
import { errorText } from "../../../util/errors";
import type { ScriptEditorWindow } from "../ScriptEditorWindow";
import { buildCommands } from "./build";
import { completionCommands } from "./completion";
import { definitionCommands } from "./definition";
import { diagnosticsCommands } from "./diagnostics";
import { hoverCommands } from "./hover";
import { inputCommands } from "./input";
import { lookCommands } from "./look";
import { projectCommands } from "./project";
import { searchCommands } from "./search";
import { selectionCommands } from "./selection";
import { stringEditCommands } from "./stringEdit";
import { tabCommands } from "./tabs";
import { uiCommands } from "./ui";

/** Rust から届く要求。 */
interface AutomationEvent {
  readonly id: number;
  readonly request: Record<string, unknown>;
}

/** 命令の登録表（機能ごとのファイルの表をまとめたもの。同じ名前を 2 か所で登録したら起動時に Error）。 */
const registry = new CommandRegistry<ScriptEditorWindow>([
  tabCommands,
  inputCommands,
  selectionCommands,
  buildCommands,
  uiCommands,
  projectCommands,
  lookCommands,
  hoverCommands,
  completionCommands,
  definitionCommands,
  searchCommands,
  diagnosticsCommands,
  stringEditCommands,
]);

/**
 * スクリプトエディタの自動操作の入口（`"window": "script-editor"`）。仕組みはほかの別ウィンドウと同じ
 * （Rust が `automation-request-window` で送り、`automation_reply` で返す）。自動操作で起動したときだけ動く。
 * 命令を足すときは、その機能のファイルの表（`tabs.ts`・`hover.ts` など）に 1 行足す。新しい機能なら、表のファイルを作って上の
 * `registry` に足す。行と桁は 1 から。
 */
export async function startScriptEditorAutomation(w: ScriptEditorWindow): Promise<void> {
  if ((await invoke<number | null>("automation_port")) === null) return;
  await getCurrentWebviewWindow().listen<AutomationEvent>("automation-request-window", (event) => {
    const { id, request } = event.payload;
    void (async () => {
      let reply: unknown;
      try {
        const handler = registry.get(String(request["cmd"]));
        if (!handler) throw new Error(`知らない cmd です: ${String(request["cmd"])}`);
        const result = await handler(w, request);
        await nextFrame();
        reply = { ok: true, result: result ?? null };
      } catch (e) {
        reply = { ok: false, error: errorText(e) };
      }
      await invoke("automation_reply", { id, body: JSON.stringify(reply) });
    })();
  });
  await invoke("automation_ready");
}
