import { listDialogs } from "../../../app/automation/dialogs";
import { settle, str, waitAtMost } from "../../../app/automation/registry";
import { describe, requireActive, type EditorCommandTable } from "./common";

/**
 * タブとファイル（`state` / `editor.open` / `editor.text` / `editor.setText` / `editor.save` / `editor.closeTab` / `editor.activate` /
 * `editor.checkExternal` / `editor.rename` / `editor.import` / `close`）。
 */
export const tabCommands: EditorCommandTable = {
  state: (w) => describe(w),
  "editor.state": (w) => describe(w),
  "editor.open": async (w, req) => {
    // 開けないときはダイアログを出したまま返す（`dialogs` で見て、`dialog` で閉じる）
    const ok = await waitAtMost(w.open(str(req, "path"), typeof req["line"] === "number" ? req["line"] : undefined), 1500);
    return { opened: ok === true, ...describe(w) };
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
  "editor.save": async (w) => {
    requireActive(w);
    const ok = await waitAtMost(w.save(), 3000);
    return { saved: ok === true, ...describe(w) };
  },
  "editor.closeTab": async (w, req) => {
    const tab = typeof req["path"] === "string" ? w.tabs.find((x) => x.path === req["path"]) : w.active;
    if (!tab) throw new Error("閉じるタブがありません");
    // 未保存なら確認のダイアログが出たまま返る
    await waitAtMost(w.closeTab(tab), 300);
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
    await waitAtMost(w.checkExternal(), 1500);
    return describe(w);
  },
  "editor.rename": async (w, req) => {
    // ラベル名の変更（F2 と同じ。`to` を渡すと名前を聞かない）
    const result = await w.renameLabel(str(req, "from"), typeof req["to"] === "string" ? req["to"] : undefined);
    return { result, ...describe(w) };
  },
  "editor.import": async (w, req) => {
    // 表示中の ROM のタブを取り込む。`rename`（自動で付けた名前 → 新しい名前）を渡すと一覧を出さない。渡さなければ一覧を出したまま返す
    const tab = typeof req["key"] === "string" ? w.tabs.find((x) => x.path === req["key"]) : w.active;
    if (!tab?.rom) throw new Error("ROM のタブがありません");
    const rename = req["rename"] && typeof req["rename"] === "object" ? (req["rename"] as Record<string, string>) : undefined;
    const result = await waitAtMost(w.importRom(tab, rename), rename ? 30000 : 400);
    return { result: result ?? null, rom: { key: tab.rom.key, importable: tab.rom.importable, items: tab.rom.items }, ...describe(w) };
  },
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
};
