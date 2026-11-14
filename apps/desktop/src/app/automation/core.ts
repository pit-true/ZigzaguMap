import { openedUrls } from "../../util/externalLinks";
import type { App } from "../App";
import { TAB_ORDER, type TabId } from "../EditorState";
import { timings } from "../timings";
import { listDialogs } from "./dialogs";
import { findField } from "./ui";
import { int, settle, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * ROM・マップ・タブ・コマンド・履歴・出力・キー・状態（`open` / `selectMap` / `tab` / `command` / `undo` / `redo` / `export` /
 * `selectBlock` / `action` / `key` / `cells` / `state` / `setting`）。
 */

function requireSession(app: App): NonNullable<App["state"]["session"]> {
  const s = app.state.session;
  if (!s) throw new Error("ROM が開かれていません");
  return s;
}

/** JavaScript のヒープの使用量（MB。WebView2 の performance.memory。メモリの計測用）。 */
function jsHeap(): { used: number; total: number } | null {
  const m = (performance as unknown as { memory?: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
  return m ? { used: Math.round(m.usedJSHeapSize / 10485.76) / 100, total: Math.round(m.totalJSHeapSize / 10485.76) / 100 } : null;
}

/** `state` の返事。 */
export function describeState(app: App): unknown {
  const s = app.state;
  const session = s.session;
  return {
    rom: session?.romPath ?? null,
    project: session?.projectDir ?? null,
    map: s.map ? { bank: s.map.id.bank, map: s.map.id.map, name: s.map.doc.mapNameText(), width: s.map.doc.width, height: s.map.doc.height } : null,
    tab: s.tab,
    selection: s.selection,
    movement: s.movement,
    dirty: [...s.dirty].sort(),
    canUndo: session?.bus.canUndo ?? false,
    canRedo: session?.bus.canRedo ?? false,
    history: session?.bus.history().length ?? 0,
    status: s.status,
    dialogs: listDialogs(),
    settings: s.settings.data,
    profile: app.profileDir,
    title: document.title,
    timings: timings.toJson(),
    jsHeap: jsHeap(),
    /** 開こうとした外部の URL（新しい順。自動操作中はブラウザを開かない）。 */
    openedUrls,
  };
}

async function command(app: App, req: AutomationRequest): Promise<unknown> {
  const session = requireSession(app);
  const record = { name: str(req, "name"), args: (req["args"] ?? {}) as Record<string, unknown> };
  const bank = record.args["bank"];
  const map = record.args["map"];
  if (typeof bank === "number" && typeof map === "number") await session.openMap({ bank, map });
  session.bus.execute(session.registry.create(record));
  return null;
}

function key(_app: App, req: AutomationRequest): null {
  // キー操作をまねる（メニューの確認用）。押して離すまでを送る。
  const init = { key: str(req, "key"), ctrlKey: req["ctrl"] === true, altKey: req["alt"] === true, shiftKey: req["shift"] === true, bubbles: true, cancelable: true };
  const target = typeof req["id"] === "string" ? findField(req["id"]) : (document.activeElement ?? document.body);
  target.dispatchEvent(new KeyboardEvent("keydown", init));
  target.dispatchEvent(new KeyboardEvent("keyup", init));
  return null;
}

export const coreCommands: CommandTable = {
  open: async (app, req) => {
    await app.openSession(str(req, "rom"), typeof req["project"] === "string" ? req["project"] : null);
    return describeState(app);
  },
  selectMap: async (app, req) => {
    const id = { bank: int(req, "bank"), map: int(req, "map") };
    if (!app.state.session?.catalog.has(id)) throw new Error(`マップ ${id.bank}.${id.map} はありません`);
    await app.openMap(id);
    return { switchMs: timings.lastMapSwitchMs };
  },
  tab: (app, req) => {
    const name = str(req, "name") as TabId;
    if (!TAB_ORDER.includes(name)) throw new Error(`タブの名前が違います: ${name}`);
    app.state.setTab(name);
    return null;
  },
  command,
  undo: (app) => requireSession(app).bus.undo(),
  redo: (app) => requireSession(app).bus.redo(),
  export: async (app, req) => {
    const dir = typeof req["dir"] === "string" ? req["dir"] : undefined;
    const session = requireSession(app);
    if (dir === undefined && !session.projectDir) throw new Error("出力先 dir を指定してください");
    const result = await session.export(dir);
    app.checkDirty(true);
    return result;
  },
  selectBlock: (app, req) => {
    const blocks = Array.isArray(req["blocks"]) ? (req["blocks"] as number[]) : [int(req, "block")];
    const width = typeof req["width"] === "number" ? req["width"] : 1;
    app.state.select({ width, height: Math.ceil(blocks.length / width), blocks });
    return null;
  },
  action: async (app, req) => {
    app.actions.run(str(req, "id"));
    await settle();
    return { status: app.state.status, dialogs: listDialogs() };
  },
  key,
  cells: (app) => {
    const map = app.state.map;
    if (!map) throw new Error("マップが開かれていません");
    return { width: map.doc.width, height: map.doc.height, cells: [...map.doc.grid.cells], border: [...map.doc.border.cells] };
  },
  state: (app) => {
    app.checkDirty(true);
    return describeState(app);
  },
  setting: (app, req) => {
    // 個人設定の値をこのセッションの間だけ変える（ファイルには保存しない）。
    (app.state.settings.data as unknown as Record<string, unknown>)[str(req, "key")] = req["value"];
    // テーマはすぐに画面（と道具のウィンドウ）へ当てる。ほかの設定は次に描くときに使われる。
    app.syncTheme();
    return null;
  },
};
