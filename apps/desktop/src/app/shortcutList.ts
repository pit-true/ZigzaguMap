import { ja } from "../i18n/ja";
import { buildMenu, type MenuItem } from "./menuDefinition";

/** ショートカットの一覧の 1 行。 */
export interface ShortcutRow {
  /** キー（「Ctrl+G」など。複数あれば「、」で区切る）。 */
  readonly keys: string;
  /** 動作。 */
  readonly action: string;
  /** どこで使えるか（空ならどこでも）。 */
  readonly where: string;
}

/**
 * メニューに無いキー操作（`Shortcuts.ts`、`MenuBar.ts`、`MapTree.ts`、`Dialog.ts`、`form/controls.ts`、
 * `wild/WildTab.ts`、別ウィンドウの `startBlockTool.ts` と `WorldMapWindow.ts` で受けているもの）。
 * キーの処理を足したら、ここにも足す（README の「ショートカット」の節と同じ内容）。
 */
const OTHER_KEYS: readonly ShortcutRow[] = [
  { keys: "Ctrl+Z", action: ja.shortcuts.undo, where: ja.shortcuts.anywhere },
  { keys: "Ctrl+Y、Ctrl+Shift+Z", action: ja.shortcuts.redo, where: ja.shortcuts.anywhere },
  { keys: "Alt", action: ja.shortcuts.menuFocus, where: ja.shortcuts.mainWindow },
  { keys: "Alt+アクセスキー", action: ja.shortcuts.menuOpen, where: ja.shortcuts.mainWindow },
  { keys: "←→↑↓、Enter、Esc", action: ja.shortcuts.menuMove, where: ja.shortcuts.inMenu },
  { keys: "↑↓", action: ja.shortcuts.treeMove, where: ja.shortcuts.inTree },
  { keys: "→、←", action: ja.shortcuts.treeOpenClose, where: ja.shortcuts.inTree },
  { keys: "Enter", action: ja.shortcuts.treeEnter, where: ja.shortcuts.inTree },
  { keys: "Esc", action: ja.shortcuts.dialogClose, where: ja.shortcuts.inDialog },
  { keys: "↑↓", action: ja.shortcuts.spin, where: ja.shortcuts.inSpin },
  { keys: "←→、PageUp、PageDown、Home、End", action: ja.shortcuts.trackbar, where: ja.shortcuts.inTrackbar },
  { keys: "Esc", action: ja.shortcuts.stopPicker, where: ja.shortcuts.inPaletteEditor },
];

/** メニューの全項目から、ショートカットを持つものを「メニュー > 項目」の形で集める。 */
function menuRows(items: readonly MenuItem[], path: readonly string[]): ShortcutRow[] {
  return items.flatMap((item) => {
    const here = item.label ? [...path, item.label] : path;
    const own = item.shortcut && item.id ? [{ keys: item.shortcut.text, action: here.join(" > "), where: menuWhere(item.id) }] : [];
    return [...own, ...menuRows(item.children ?? [], here)];
  });
}

/** メニューのショートカットのうち、別ウィンドウの中でも使えるもの。 */
function menuWhere(id: string): string {
  return id === "file.export" ? ja.shortcuts.anywhere : ja.shortcuts.mainWindow;
}

/** 全ショートカット（メニューにあるもの → それ以外の順）。 */
export function shortcutRows(): ShortcutRow[] {
  return [...menuRows(buildMenu([]), []), ...OTHER_KEYS];
}

/** ヘルプに出す一覧（Markdown。ヘルプの Markdown の変換で表にする）。 */
export function shortcutMarkdown(): string {
  const s = ja.shortcuts;
  const rows = shortcutRows().map((r) => `| ${escapeCell(r.keys)} | ${escapeCell(r.action)} | ${escapeCell(r.where)} |`);
  return [`# ${s.title}`, "", s.note, "", `| ${s.keyHeader} | ${s.actionHeader} | ${s.whereHeader} |`, "|---|---|---|", ...rows, ""].join("\n");
}

function escapeCell(text: string): string {
  return text.replace(/\|/g, "\\|");
}
