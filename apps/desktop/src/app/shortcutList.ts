import { ja } from "../i18n/ja";
import { jaEventDelete } from "../i18n/ja.eventDelete";
import { jaEventMulti } from "../i18n/ja.eventMulti";
import { jaEventLimit } from "../i18n/ja.eventLimit";
import { jaMapFind } from "../i18n/ja.mapFind";
import { jaPaint } from "../i18n/ja.paint";
import { jaNeighbors } from "../i18n/ja.neighbors";
import { jaPen } from "../i18n/ja.pen";
import { jaScriptEditorAssist } from "../i18n/ja.scriptEditorAssist";
import { jaMapZoom } from "../i18n/ja.mapZoom";
import { jaPaletteInfo } from "../i18n/ja.paletteInfo";
import { jaSeams } from "../i18n/ja.seams";
import { jaTownMini } from "../i18n/ja.townMini";
import { jaPointers } from "../i18n/ja.pointers";
import { jaAssist } from "../i18n/ja.assist";
import { jaBlockEditor } from "../i18n/ja.blockEditor";
import { blockToolShortcutRows } from "../i18n/ja.blockTools";
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
 * `wild/WildTab.ts`、Phase4 の欄と窓（`ui/map/RecentBlocks.ts`・`ui/view/TownMiniView.ts`・`ui/pointer/PointerDialog.ts`・
 * `ui/connection/SeamNotice.ts`）、別ウィンドウの `startBlockTool.ts`・`BlockEditPanel.ts`・`MapAssistWindow.ts` と `WorldMapWindow.ts` で受けているもの）。
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
  { keys: "Delete", action: jaEventDelete.shortcut, where: jaEventDelete.shortcutWhere },
  // イベントの複数選択・まとめての移動・複製（Phase5 #399。ui/event/EventTab.ts・app/Shortcuts.ts）
  { keys: "Shift＋クリック", action: jaEventMulti.shortcutToggle, where: jaEventMulti.shortcutWhere },
  { keys: "Shift＋ドラッグ（空いた所から）", action: jaEventMulti.shortcutRect, where: jaEventMulti.shortcutWhere },
  { keys: "ドラッグ（選んだイベントの上で）", action: jaEventMulti.shortcutGroupDrag, where: jaEventMulti.shortcutWhere },
  { keys: "Ctrl+D", action: jaEventMulti.shortcutDuplicate, where: jaEventMulti.shortcutWhere },
  // ルーラー（Phase5 #400。ui/event/RulerLayer.ts）
  { keys: "Shift＋右ドラッグ", action: jaEventLimit.shortcutRuler, where: jaEventLimit.shortcutWhere },
  { keys: jaMapFind.mouseBack, action: jaMapFind.shortcutBack, where: ja.shortcuts.mainWindow },
  { keys: jaMapFind.mouseForward, action: jaMapFind.shortcutForward, where: ja.shortcuts.mainWindow },
  { keys: "Esc", action: jaMapFind.filterClear, where: jaMapFind.filterWhere },
  { keys: "↓、Enter", action: jaMapFind.filterToTree, where: jaMapFind.filterWhere },
  // マップタブのコピーと貼り付け（Phase3 #225。input/StampClipboard.ts）
  { keys: "Ctrl+C", action: jaPaint.shortcutCopy, where: jaPaint.shortcutWhere },
  { keys: "Ctrl+V", action: jaPaint.shortcutPaste, where: jaPaint.shortcutWhere },
  // 矩形塗りと入れ替え（Phase3 #233。input/BlockDragTools.ts・MovementPainter.ts）
  { keys: "Ctrl＋左ドラッグ", action: jaPaint.shortcutRectFill, where: jaPaint.shortcutDragWhere },
  { keys: "Alt＋左ドラッグ", action: jaPaint.shortcutSwap, where: jaPaint.shortcutWhere },
  { keys: "Esc", action: jaPaint.shortcutCancel, where: jaPaint.shortcutDragWhere },
  // ダイブ先・浮上先の重ね表示（Phase3 #232。ui/map/DiveOverlay.ts）
  { keys: "Space（押している間）", action: jaNeighbors.shortcutDive, where: jaNeighbors.shortcutDiveWhere },
  // ミキシングバッグ（Phase3 #236。ui/map/BlockPaletteView.ts・MixingBagView.ts）
  { keys: "Ctrl＋左クリック", action: jaPaint.shortcutBag, where: jaPaint.shortcutBagWhere },
  { keys: "Ctrl＋クリック", action: jaPaint.shortcutBagClear, where: jaPaint.shortcutBagClearWhere },
  // 矩形の選択（移動許可も拾う。#225）と、Ctrl を押している間の表示（#238。ui/map/ctrlPeek.ts）
  { keys: "Ctrl＋右ドラッグ", action: jaPaint.shortcutPick, where: jaPaint.shortcutPickWhere },
  // ブロックパレットの矩形の選択（Phase3。3 層の扱いは Phase4 #300。ui/map/BlockPaletteView.ts）
  { keys: jaPen.shortcutPalettePickKeys, action: jaPen.shortcutPalettePick, where: jaPen.shortcutPalettePickWhere },
  { keys: "Ctrl（押している間）", action: jaPaint.shortcutPeek, where: jaPaint.shortcutPeekWhere },
  { keys: "Ctrl＋右クリック", action: jaPaint.shortcutPeekPick, where: jaPaint.shortcutPeekPickWhere },
  // 自動ペン（Phase4 #310。app/penExtras.ts）
  { keys: "P", action: jaPen.shortcutAutoPen, where: jaPen.shortcutAutoPenWhere },
  // 最近使ったブロック（Phase4 #308。ui/map/RecentBlocks.ts）
  { keys: jaPaletteInfo.shortcutRecentKeys, action: jaPaletteInfo.shortcutRecent, where: jaPaletteInfo.shortcutRecentWhere },
  // 接続のつまみと隣の帯（#223・#229〜#231。ui/map/ConnectionHandles.ts・EdgeHandles.ts・NeighborLayer.ts）
  { keys: jaNeighbors.shortcutCornerKeys, action: jaNeighbors.shortcutCorner, where: jaNeighbors.shortcutCornerWhere },
  { keys: jaNeighbors.shortcutEdgeMenuKeys, action: jaNeighbors.shortcutEdgeMenu, where: jaNeighbors.shortcutEdgeWhere },
  { keys: jaNeighbors.shortcutEdgeDragKeys, action: jaNeighbors.shortcutEdgeDrag, where: jaNeighbors.shortcutEdgeWhere },
  { keys: jaNeighbors.shortcutBandKeys, action: jaNeighbors.shortcutBand, where: jaNeighbors.shortcutBandWhere },
  // マップの拡大と中ボタンのスクロール（Phase4 #316。ui/map/MapZoomControls.ts）
  { keys: jaMapZoom.shortcutZoomKeys, action: jaMapZoom.shortcutZoom, where: jaMapZoom.shortcutWhere },
  { keys: jaMapZoom.shortcutScrollKeys, action: jaMapZoom.shortcutScroll, where: jaMapZoom.shortcutWhere },
  // 接続の境目の注意（Phase4 #305。ui/connection/SeamNotice.ts）
  { keys: jaSeams.shortcutKeys, action: jaSeams.shortcut, where: jaSeams.shortcutWhere },
  // タウンマップの小窓（Phase4 #306。ui/view/TownMiniView.ts）
  { keys: jaTownMini.shortcutKeys, action: jaTownMini.shortcut, where: jaTownMini.shortcutWhere },
  { keys: jaTownMini.shortcutMenuKeys, action: jaTownMini.shortcutMenu, where: jaTownMini.shortcutWhere },
  { keys: jaTownMini.shortcutDragKeys, action: jaTownMini.shortcutDrag, where: jaTownMini.shortcutWhere },
  // ポインタ一覧と参照元の検索（Phase4 #307。ui/pointer/PointerDialog.ts）
  { keys: jaPointers.shortcutRowKeys, action: jaPointers.shortcutRow, where: jaPointers.shortcutWhere },
  { keys: jaPointers.shortcutCopyKeys, action: jaPointers.shortcutCopy, where: jaPointers.shortcutWhere },
  { keys: "Enter", action: jaPointers.shortcutSearch, where: jaPointers.shortcutSearchWhere },
  // イベントタブの右クリックのメニュー（ui/event/EventTab.ts）
  { keys: "右クリック", action: jaEventDelete.shortcutMenu, where: jaEventDelete.shortcutWhere },
  // ブロックエディタの 8 マスと 3 層目の 4 マス（Phase4 #302。windows/block-editor/BlockEditPanel.ts）
  { keys: jaBlockEditor.shortcutTileKeys, action: jaBlockEditor.shortcutTile, where: jaBlockEditor.shortcutTileWhere },
  // ブロックエディタの Phase5 の操作（#393〜#395。windows/block-editor/）
  ...blockToolShortcutRows(),
  // マップ作成補助の窓（Phase4 #312・#338。windows/map-assist/MapAssistWindow.ts）
  { keys: jaAssist.shortcutPickKeys, action: jaAssist.shortcutPick, where: jaAssist.shortcutPickWhere },
  ...scriptEditorKeys(),
];

/** スクリプトエディタ（別ウィンドウ）のキー（`windows/script-editor/` の ScriptEditorWindow.ts と extensions/ で受けているもの）。 */
function scriptEditorKeys(): ShortcutRow[] {
  const s = jaScriptEditorAssist.shortcuts;
  const rows: [string, string][] = [
    ["Ctrl+S", s.save],
    ["Ctrl+Shift+S", s.saveAll],
    ["Ctrl+W", s.closeTab],
    ["Ctrl+Tab、Ctrl+Shift+Tab", s.cycleTab],
    ["Ctrl+Space", s.complete],
    ["F12", s.definition],
    ["Ctrl+クリック", s.ctrlClick],
    ["Alt+←", s.back],
    ["Ctrl+F", s.find],
    ["Ctrl+H", s.replace],
    ["F3、Shift+F3", s.findNext],
    ["Ctrl+D", s.nextOccurrence],
    ["Ctrl+Shift+L", s.allOccurrences],
    ["Alt+ドラッグ", s.rectangle],
    ["Ctrl+Alt+↑↓", s.addCursor],
    ["Alt+↑↓", s.moveLine],
    ["Shift+Alt+↑↓", s.copyLine],
    ["Ctrl+/", s.comment],
    ["F8", s.nextDiagnostic],
    ["Ctrl+Shift+M", s.diagnostics],
    ["Ctrl+Alt+G", s.gotoLine],
    ["Tab", s.indent],
    ["Ctrl+Z", s.undo],
    ["Ctrl+Y、Ctrl+Shift+Z", s.redo],
    ["F2", s.rename],
    ["Ctrl+B", s.build],
    ["Esc", s.closeHover],
    ["Ctrl+Enter", s.applyString],
    ["Enter", s.stringEnter],
  ];
  return rows.map(([keys, action]) => ({ keys, action, where: s.where }));
}

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
