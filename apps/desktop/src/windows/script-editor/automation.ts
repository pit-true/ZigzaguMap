import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { EditorSelection } from "@codemirror/state";
import { listDialogs, operateDialog } from "../../app/automation/dialogs";
import { click, findField, getField, listFields, setField } from "../../app/automation/ui";
import { nextFrame, settle, str } from "../../app/automation/registry";
import { errorText } from "../../util/errors";
import { FEATURE_COMMANDS } from "./automationFeatures";
import { currentDiagnostics } from "./extensions/lint";
import { currentEditorTheme } from "./extensions/themes";
import type { ScriptEditorWindow } from "./ScriptEditorWindow";

/** Rust から届く要求。 */
interface AutomationEvent {
  readonly id: number;
  readonly request: Record<string, unknown>;
}

/** 命令 1 つ。 */
type Handler = (w: ScriptEditorWindow, req: Record<string, unknown>) => unknown;

/**
 * スクリプトエディタの自動操作の入口（`"window": "script-editor"`）。仕組みはほかの別ウィンドウと同じ
 * （Rust が `automation-request-window` で送り、`automation_reply` で返す）。自動操作で起動したときだけ動く。
 * 命令を足すときは `COMMANDS` に 1 行足す（後の issue の `editor.hover` など）。
 */
export async function startScriptEditorAutomation(w: ScriptEditorWindow): Promise<void> {
  if ((await invoke<number | null>("automation_port")) === null) return;
  await getCurrentWebviewWindow().listen<AutomationEvent>("automation-request-window", (event) => {
    const { id, request } = event.payload;
    void (async () => {
      let reply: unknown;
      try {
        const handler = COMMANDS[String(request["cmd"])];
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

/** 位置（0 始まりの文字の位置）を、行と桁（どちらも 1 から）にする。 */
function lineColumn(w: ScriptEditorWindow, pos: number): { line: number; column: number; offset: number } {
  const line = w.view.state.doc.lineAt(pos);
  return { line: line.number, column: pos - line.from + 1, offset: pos };
}

/** `line`・`column`（1 から）か `offset`（`prefix` が `to` なら `toLine`・`toColumn`・`toOffset`）を、文字の位置にする。無ければ null。 */
function positionOf(w: ScriptEditorWindow, req: Record<string, unknown>, prefix: "" | "to" = ""): number | null {
  const key = (name: string): string => (prefix ? prefix + name[0]!.toUpperCase() + name.slice(1) : name);
  const doc = w.view.state.doc;
  const offset = req[key("offset")];
  if (typeof offset === "number") return Math.max(0, Math.min(doc.length, offset));
  const line = req[key("line")];
  if (typeof line !== "number") return null;
  const l = doc.line(Math.max(1, Math.min(doc.lines, line)));
  const column = typeof req[key("column")] === "number" ? (req[key("column")] as number) : 1;
  return Math.min(l.to, l.from + Math.max(0, column - 1));
}

function requireActive(w: ScriptEditorWindow): void {
  if (!w.active) throw new Error("開いているファイルがありません");
}

function describe(w: ScriptEditorWindow): unknown {
  const active = w.active;
  const sel = w.view.state.selection;
  return {
    tabs: w.tabs.map((tab) => ({ path: tab.path, kind: tab.kind, dirty: tab.dirty, missing: tab.missing, lineEnding: tab.lineEnding, bom: tab.bom, lines: tab.state.doc.lines, rom: tab.rom !== null, readOnly: tab.state.readOnly })),
    active: active?.path ?? null,
    dirty: active?.dirty ?? false,
    cursor: active ? lineColumn(w, sel.main.head) : null,
    selection: active
      ? sel.ranges.map((r) => ({ anchor: lineColumn(w, r.anchor), head: lineColumn(w, r.head), text: w.view.state.sliceDoc(r.from, r.to) }))
      : [],
    message: document.querySelector('[data-auto-id="se.message"]')?.textContent ?? "",
    diagnostics: active ? currentDiagnostics(w.view.state) : [],
    theme: currentEditorTheme(),
    title: document.title,
    dialogs: listDialogs(),
  };
}

const COMMANDS: Readonly<Record<string, Handler>> = {
  state: (w) => describe(w),
  "editor.state": (w) => describe(w),
  "editor.open": async (w, req) => {
    // 開けないときはダイアログを出したまま返す（`dialogs` で見て、`dialog` で閉じる）
    const opening = w.open(str(req, "path"), typeof req["line"] === "number" ? req["line"] : undefined);
    const ok = await Promise.race([opening, settle(1500).then(() => null)]);
    return { opened: ok === true, ...(describe(w) as object) };
  },
  "editor.text": (w, req) => {
    if (typeof req["path"] === "string") {
      const tab = w.tabs.find((x) => x.path === req["path"]);
      if (!tab) throw new Error(`開いていません: ${String(req["path"])}`);
      return { path: tab.path, text: tab.state.doc.toString() };
    }
    requireActive(w);
    return { path: w.active!.path, text: w.view.state.doc.toString() };
  },
  "editor.setText": (w, req) => {
    requireActive(w);
    const text = str(req, "text");
    w.view.dispatch({ changes: { from: 0, to: w.view.state.doc.length, insert: text }, userEvent: "input" });
    return describe(w);
  },
  "editor.select": (w, req) => {
    requireActive(w);
    const anchor = positionOf(w, req);
    if (anchor === null) throw new Error("line（と column）か offset を指定してください");
    const head = positionOf(w, req, "to") ?? anchor;
    w.view.dispatch({ selection: EditorSelection.range(anchor, head), scrollIntoView: true });
    w.view.focus();
    return describe(w);
  },
  "editor.type": (w, req) => {
    // 入力した文字を、今の選択と置き換える（キーを押して入力したときと同じ取引。IME は通さない）
    requireActive(w);
    const at = positionOf(w, req);
    if (at !== null) w.view.dispatch({ selection: EditorSelection.cursor(at) });
    w.view.dispatch(w.view.state.replaceSelection(str(req, "text")), { userEvent: "input.type", scrollIntoView: true });
    return describe(w);
  },
  "editor.key": async (w, req) => {
    // エディタの本文へキーを送る（Ctrl+S・Ctrl+Z・Enter など、キーの割り当てを通る）。本文が無ければウィンドウへ送る
    const init = { key: str(req, "key"), ctrlKey: req["ctrl"] === true, altKey: req["alt"] === true, shiftKey: req["shift"] === true, bubbles: true, cancelable: true };
    const target = w.active ? w.view.contentDOM : document.body;
    if (w.active) w.view.focus();
    target.dispatchEvent(new KeyboardEvent("keydown", init));
    target.dispatchEvent(new KeyboardEvent("keyup", init));
    await settle(200);
    return describe(w);
  },
  "editor.save": async (w) => {
    requireActive(w);
    const ok = await Promise.race([w.save(), settle(3000).then(() => null)]);
    return { saved: ok === true, ...(describe(w) as object) };
  },
  "editor.closeTab": async (w, req) => {
    const tab = typeof req["path"] === "string" ? w.tabs.find((x) => x.path === req["path"]) : w.active;
    if (!tab) throw new Error("閉じるタブがありません");
    // 未保存なら確認のダイアログが出たまま返る
    await Promise.race([w.closeTab(tab), settle(300)]);
    return describe(w);
  },
  "editor.activate": (w, req) => {
    const tab = w.tabs.find((x) => x.path === str(req, "path"));
    if (!tab) throw new Error(`開いていません: ${str(req, "path")}`);
    w.activate(tab);
    return describe(w);
  },
  "editor.checkExternal": async (w) => {
    // 1 秒ごとの見張りを待たずに外部の変更を調べる（聞くダイアログが出たらそこで返る）
    await Promise.race([w.checkExternal(), settle(1500)]);
    return describe(w);
  },
  "build.run": async (w, req) => {
    // 動かし始めて返す（`wait: true` なら終わるまで待つ）。保存・出力の確認のダイアログが出たらそこで返る
    const running = w.build.run({ skipConfirm: req["confirm"] === false });
    if (req["wait"] === true) await running;
    else await Promise.race([running, settle(500)]);
    return { ...w.build.status, dialogs: listDialogs() };
  },
  "build.state": (w) => w.build.status,
  "editor.rename": async (w, req) => {
    // ラベル名の変更（F2 と同じ。`to` を渡すと名前を聞かない）
    const result = await w.renameLabel(str(req, "from"), typeof req["to"] === "string" ? req["to"] : undefined);
    return { result, ...(describe(w) as object) };
  },
  "editor.import": async (w, req) => {
    // 表示中の ROM のタブを取り込む。`rename`（自動で付けた名前 → 新しい名前）を渡すと一覧を出さない。渡さなければ一覧を出したまま返す
    const tab = typeof req["key"] === "string" ? w.tabs.find((x) => x.path === req["key"]) : w.active;
    if (!tab?.rom) throw new Error("ROM のタブがありません");
    const rename = req["rename"] && typeof req["rename"] === "object" ? (req["rename"] as Record<string, string>) : undefined;
    const result = await Promise.race([w.importRom(tab, rename), settle(rename ? 30000 : 400).then(() => undefined)]);
    return { result: result ?? null, rom: { key: tab.rom.key, importable: tab.rom.importable, items: tab.rom.items }, ...(describe(w) as object) };
  },
  "build.log": (w, req) => ({ lines: w.build.lines(typeof req["from"] === "number" ? req["from"] : 0) }),
  "build.stop": async (w) => {
    await w.build.stop();
    return w.build.status;
  },
  key: async (w, req) => COMMANDS["editor.key"]!(w, req),
  close: async (w) => {
    // × と同じ。未保存が無ければ返事を送ってから閉じる。あれば確認のダイアログを出したまま返る（`dialog` で答える）
    if (!w.tabs.some((x) => x.dirty)) {
      setTimeout(() => void w.closeWindow(), 300);
      return { closing: true, dialogs: [] };
    }
    void w.closeWindow();
    await settle(300);
    return { closing: false, dialogs: listDialogs() };
  },
  dialogs: () => ({ dialogs: listDialogs() }),
  getField: (_w, req) => getField(str(req, "id")),
  setField: async (_w, req) => {
    const r = setField(str(req, "id"), req["value"]);
    await settle();
    return { ...r, dialogs: listDialogs() };
  },
  click: async (_w, req) => {
    click(str(req, "id"));
    await settle(200);
    return { dialogs: listDialogs(), ...(describe(_w) as object) };
  },
  "ui.list": (_w, req) => listFields(typeof req["root"] === "string" ? findField(req["root"]) : document),
  dialog: async (_w, req) => {
    const result = await operateDialog(req);
    await settle(200);
    return result;
  },
  ...FEATURE_COMMANDS,
};
