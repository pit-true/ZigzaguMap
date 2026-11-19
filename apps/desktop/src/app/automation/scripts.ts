import type { App } from "../App";
import { ensureScriptFile, openNewScriptDialog } from "../../ui/script/NewScriptDialog";
import { ScriptsTableDialog, scriptsTableView } from "../../ui/script/ScriptsTableDialog";
import { jaScriptsTable } from "../../i18n/ja.scriptsTable";
import { linkMapScript, mapScriptLink, unlinkMapScript } from "../../ui/script/MapScriptFileLink";
import { listDialogs } from "./dialogs";
import { int, settle, type AutomationRequest, type CommandTable } from "./registry";

/** 対応表のコマンドの名前（`action` → CommandRegistry の名前）。 */
const EDIT_ACTIONS: Readonly<Record<string, string>> = {
  add: "addScriptsTableEntry",
  set: "setScriptsTableEntry",
  remove: "removeScriptsTableEntry",
  move: "moveScriptsTableEntry",
};

function session(app: App): NonNullable<App["state"]["session"]> {
  const s = app.state.session;
  if (!s) throw new Error("ROM を開いていません");
  return s;
}

/** 対応表の今の状態と、画面が開いているか・選んでいる行・開いているダイアログ。 */
function describe(app: App): Record<string, unknown> {
  const dialog = ScriptsTableDialog.current();
  return {
    ...scriptsTableView(session(app).scriptsTable),
    open: dialog !== null,
    selected: dialog?.selectedIndex ?? -1,
    dialogs: listDialogs(),
  };
}

/** `entry` などの引数を CommandRegistry のコマンドの引数にする（`cmd`・`action` を除く）。 */
function commandArgs(req: AutomationRequest): Record<string, unknown> {
  const { cmd: _cmd, action: _action, ...rest } = req;
  return rest;
}

/**
 * `scripts.table`: maps\scripts.json の対応表。`action` で動きを選ぶ（省略で読むだけ）。
 * 編集（add / set / remove / move）はメインの CommandBus で実行するので、アンドゥ・出力は画面からの編集と同じ。
 */
async function scriptsTable(app: App, req: AutomationRequest): Promise<unknown> {
  const action = req["action"] === undefined ? "get" : String(req["action"]);
  const s = session(app);
  const edit = EDIT_ACTIONS[action];
  if (edit) {
    s.bus.execute(s.registry.create({ name: edit, args: commandArgs(req) }));
    return describe(app);
  }
  switch (action) {
    case "get":
      return describe(app);
    case "open":
      // プロジェクトフォルダが無ければ、案内のダイアログを出さずにエラーで返す（#380）
      if (!s.projectDir) throw new Error(jaScriptsTable.noProject);
      await ScriptsTableDialog.get(app).open();
      return describe(app);
    case "close":
      ScriptsTableDialog.current()?.close();
      return describe(app);
    case "select": {
      const dialog = ScriptsTableDialog.current();
      if (!dialog) throw new Error("対応表の画面が開いていません（action: open で開く）");
      dialog.select(int(req, "index"));
      return describe(app);
    }
    case "resolve":
      return s.scriptsTable.document.resolve(int(req, "bank"), int(req, "map"));
    case "newScript":
    case "ensure": {
      // ファイル名の入力は人が答えるまで閉じないので、待たずに返す（dialog / setField / click で答える）。
      const bank = req["bank"] === undefined ? null : int(req, "bank");
      const map = req["map"] === undefined || req["map"] === null ? null : int(req, "map");
      if (action === "ensure") {
        if (bank === null || map === null) throw new Error("ensure には bank と map が要ります");
        const found = s.scriptsTable.document.resolve(bank, map);
        if (found) return { resolved: found, ...describe(app) };
        // ラベルから自動で決まる .s（#562）があれば、入力は出さずにそれを返す（索引を先に作っておき、入力が出るのを待てるようにする）
        const auto = await app.scripts.files.mapScriptOf(bank, map);
        if (auto) return { resolved: auto, ...describe(app) };
        void ensureScriptFile(app.state, bank, map);
      } else {
        const fileName = typeof req["fileName"] === "string" ? req["fileName"] : undefined;
        void openNewScriptDialog(app.state, { bank, map, ...(fileName !== undefined ? { fileName } : {}) });
      }
      await settle();
      return { resolved: null, ...describe(app) };
    }
    default:
      throw new Error(`知らない action です: ${action}`);
  }
}

/**
 * `scripts.mapLink`: マップと `.s` の紐づけ（#555。場所の設定タブの「このマップの .s」と同じ）。`bank`・`map`（省略で表示中のマップ）。
 * `action`: `get`（省略時）、`set`（`path`。絶対パスかプロジェクトフォルダからの相対）、`clear`。返事は今の紐づけ。
 */
async function mapLink(app: App, req: AutomationRequest): Promise<unknown> {
  const action = req["action"] === undefined ? "get" : String(req["action"]);
  const current = app.state.map?.id;
  const id = req["bank"] !== undefined ? { bank: int(req, "bank"), map: int(req, "map") } : current;
  if (!id) throw new Error("マップを開いていません（bank と map を指定してください）");
  if (action === "set") {
    if (typeof req["path"] !== "string") throw new Error("path を指定してください");
    await linkMapScript(app.state, id, req["path"]);
  } else if (action === "clear") unlinkMapScript(app.state, id);
  else if (action !== "get") throw new Error(`知らない action です: ${action}`);
  const s = session(app);
  const link = mapScriptLink(app.state, id) ?? { script: null, from: "none", row: -1 };
  // 紐づけが無ければ、ラベルから自動で決めた .s（#562。保存しない）
  const chosen = link.script === null ? await app.scripts.files.mapScriptOf(id.bank, id.map) : null;
  const auto = chosen?.from === "auto" ? chosen.script : null;
  const labels = s.labels.store.labelsOfMap(id.bank, id.map);
  const candidates = await app.scripts.files.autoCandidates(id.bank, id.map);
  return { bank: id.bank, map: id.map, ...link, auto, labels, candidates, modified: s.scriptsTable.isModified() };
}

/** scripts.json の対応表の命令。 */
export const scriptsCommands: CommandTable = {
  "scripts.table": scriptsTable,
  "scripts.mapLink": mapLink,
};
