import type { App } from "../App";
import type { MenuItem } from "../menuDefinition";
import { listDialogs } from "./dialogs";
import { settle, type AutomationRequest, type CommandTable } from "./registry";

/**
 * メインメニュー（`menu.list` / `menu.run`）。
 * - `menu.list`: 全項目の階層（`path`: 文言の列。最近開いたものも含む）、アクション ID、有効か（親が無効なら無効）、チェック、ショートカット。区切り線は出さない。
 * - `menu.run {path}`: 階層の文字列（`"設定 > グリッドの表示"` か `["設定", "グリッドの表示"]`）か `id` で項目を実行する。
 *   メニューバーで選んだときと同じく、無効な項目は実行しない（Error）。返事はステータスバーと開いているダイアログ。
 */

interface FlatItem {
  readonly path: string[];
  readonly id: string | null;
  readonly enabled: boolean;
  readonly checked: boolean;
  readonly submenu: boolean;
  readonly shortcut: string | null;
}

function flatten(app: App, items: readonly MenuItem[], parent: string[], parentEnabled: boolean, out: FlatItem[]): FlatItem[] {
  for (const item of items) {
    if (item.separator) continue;
    const path = [...parent, item.label ?? ""];
    const enabled = parentEnabled && app.actions.isEnabled(item);
    out.push({
      path,
      id: item.id ?? null,
      enabled,
      checked: item.id ? app.actions.isChecked(item.id) : false,
      submenu: item.children !== undefined,
      shortcut: item.shortcut?.text ?? null,
    });
    if (item.children) flatten(app, item.children, path, enabled, out);
  }
  return out;
}

export function menuItems(app: App): FlatItem[] {
  return flatten(app, app.menuItems(), [], true, []);
}

function wantedPath(req: AutomationRequest): string[] | null {
  const p = req["path"];
  if (Array.isArray(p)) return p.map(String);
  if (typeof p === "string") return p.split(">").map((s) => s.trim());
  return null;
}

async function run(app: App, req: AutomationRequest): Promise<unknown> {
  const items = menuItems(app);
  const path = wantedPath(req);
  const id = typeof req["id"] === "string" ? req["id"] : null;
  const item = path ? items.find((i) => i.path.length === path.length && i.path.every((p, k) => p === path[k])) : items.find((i) => i.id === id);
  if (!item) throw new Error(`メニューの項目がありません: ${path ? path.join(" > ") : String(id)}`);
  if (item.submenu || !item.id) throw new Error(`サブメニューは実行できません: ${item.path.join(" > ")}`);
  if (!item.enabled) throw new Error(`無効な項目です: ${item.path.join(" > ")}`);
  app.actions.run(item.id, item.path[item.path.length - 1]);
  await settle(typeof req["wait"] === "number" ? req["wait"] : 100);
  return { id: item.id, status: app.state.status, dialogs: listDialogs() };
}

export const menuCommands: CommandTable = {
  "menu.list": (app) => menuItems(app),
  "menu.run": run,
};
