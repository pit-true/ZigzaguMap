import { fileNameOf } from "./FileDialogs";
import type { SettingsData } from "./Settings";
import { ja } from "../i18n/ja";
import { jaNeighbors } from "../i18n/ja.neighbors";
import { jaTimeOfDay } from "../i18n/ja.timeOfDay";
import { jaComposite } from "../i18n/ja.composite";
import { jaTransplant } from "../i18n/ja.transplant";
import { jaScriptsTable } from "../i18n/ja.scriptsTable";
import { jaPlayback } from "../i18n/ja.playback";
import { jaBuild } from "../i18n/ja.build";
import { jaMapFind } from "../i18n/ja.mapFind";
import { jaClone } from "../i18n/ja.clone";
import { jaBlockUsage } from "../i18n/ja.blockUsage";
import { jaEventView } from "../i18n/ja.eventView";
import { jaTownMini } from "../i18n/ja.townMini";
import { jaPointers } from "../i18n/ja.pointers";
import { jaPaletteInfo } from "../i18n/ja.paletteInfo";
import { jaThumbnails } from "../i18n/ja.thumbnails";
import { TOGGLE_EVENT_KINDS, eventKindActionId } from "../ui/event/eventVisibility";
import { jaPen } from "../i18n/ja.pen";
import { jaAssist } from "../i18n/ja.assist";
import { jaUserScript } from "../i18n/ja.userScript";
import { jaTools } from "../i18n/ja.tools";
import { jaPreviewPlayer } from "../i18n/ja.previewPlayer";
import { jaNpcMotion } from "../i18n/ja.npcMotion";
import { jaShortcutEdit } from "../i18n/ja.shortcutEdit";
import { isKeyAction, keyText } from "./keymap";
import { jaCommands } from "../i18n/ja.commands";
import { jaSettingsWindow } from "../i18n/ja.settingsWindow";
import { jaProjectWatch } from "../i18n/ja.projectWatch";
import { jaMapExport } from "../i18n/ja.mapExport";
import { jaWildTools } from "../i18n/ja.wildTools";

/** メニューに出すショートカットキー（`app/keymap.ts` の表の今のキーから作る。#392）。 */
export interface Shortcut {
  /** メニューに出す表記（キーが 2 つなら「、」で区切る）。 */
  readonly text: string;
}

/** 押せる条件（AdvanceMap の「ROM なし／ROM のみ／マップ表示中」の 3 段階）。 */
export type EnableWhen = "always" | "rom" | "map";

/** メニューの 1 項目。 */
export interface MenuItem {
  /** アクションの ID（区切り線とサブメニューの親には無い）。 */
  readonly id?: string;
  readonly label?: string;
  /** アクセスキー（括弧で下線つきで出す文字）。 */
  readonly accel?: string;
  /** アクセスキーを括弧で足さず、ラベルの先頭の文字に下線を引く（最近開いたもの「1 xxx.gba」用）。 */
  readonly inlineAccel?: boolean;
  readonly shortcut?: Shortcut;
  readonly enable?: EnableWhen;
  readonly separator?: true;
  readonly children?: readonly MenuItem[];
}

const sep: MenuItem = { separator: true };

/** 表（`app/keymap.ts`）にある項目へ、今のキーの表記を付ける。 */
function withKeys(items: readonly MenuItem[]): MenuItem[] {
  return items.map((item) => {
    const children = item.children ? withKeys(item.children) : undefined;
    const text = item.id && isKeyAction(item.id) ? keyText(item.id) : "";
    return { ...item, ...(children ? { children } : {}), ...(text ? { shortcut: { text } } : {}) };
  });
}

/**
 * メニューの全項目（AdvanceMap 1.92 日本語版のアクセスキー・ショートカットをもとにした）。
 * ユーザーの要望で「表示」を足し、「設定」にあった見た目の項目を移した（ファイル・表示・設定・ツール・ヘルプ）。
 * 最近開いたもの（`recent.N`）は `recentItems` で差し込む。
 * 「オブジェクトの表示」の Ctrl+Z はアンドゥに使うため外した。
 * ショートカットキーは `app/keymap.ts` の表に置き、ここでは付けない（#392。利用者が変えられる）。
 */
export function buildMenu(recentItems: readonly MenuItem[], scriptItems: readonly MenuItem[] = []): MenuItem[] {
  return withKeys([
    {
      label: ja.menuFile,
      accel: "Z",
      children: [
        { id: "file.open", label: ja.openRom, accel: "R" },
        { id: "file.openProject", label: ja.openProject, accel: "P" },
        { id: "file.reload", label: ja.reloadRom, accel: "O" },
        sep,
        { id: "file.export", label: ja.exportMaps, accel: "M" },
        { id: "file.exportTo", label: ja.exportMapsTo, accel: "W" },
        { id: "file.backup", label: ja.createBackup, accel: "X", enable: "map" },
        // マップの画像の書き出し（Phase5 #403。ZigzaguMap 独自）
        { id: "image.export", label: jaMapExport.menu, enable: "map" },
        sep,
        {
          label: ja.mapMenu,
          accel: "Y",
          enable: "map",
          children: [
            { id: "map.new", label: ja.newMap, enable: "rom" },
            { id: "map.openCreated", label: ja.openCreatedMap, enable: "rom" },
            { id: "map.saveCreatedAs", label: ja.saveCreatedMapAs, enable: "rom" },
            { id: "map.insert", label: ja.insertMap, enable: "map" },
          ],
        },
        sep,
        ...recentItems,
        sep,
        { id: "file.exit", label: ja.exit, accel: "Z" },
      ],
    },
    {
      // 表示（ZigzaguMap 独自。AdvanceMap の「設定」にあった見た目の項目をここへ移した）
      label: ja.menuView,
      accel: "V",
      children: [
        { id: "view.grid", label: ja.showGrid, accel: "J", enable: "map" },
        // グリッドの形・カーソルの枠・プレイヤーの視界の枠（Phase5 #391。ZigzaguMap 独自）
        { id: "view.gridSettings", label: jaTools.gridSettingsMenu, enable: "map" },
        { id: "view.cursorFrame", label: jaTools.cursorFrameMenu },
        { id: "view.playerView", label: jaTools.playerViewMenu },
        { id: "view.previewPlayer", label: jaPreviewPlayer.menu, enable: "map" },
        // 人物の移動タイプの再生（Phase6 #471。ZigzaguMap 独自）。既定はオフ
        { id: "view.npcMotion", label: jaNpcMotion.menu, enable: "map" },
        // 移動範囲とトレーナーの視界（Phase6 #472）。既定はオフ
        { id: "view.npcRanges", label: jaNpcMotion.rangesMenu, enable: "map" },
        { id: "view.objects", label: ja.showObjects, accel: "K" },
        // イベントの種類ごとの表示（#304。ZigzaguMap 独自）: チェックを外した種類はイベントタブで描かず、クリックでも選ばない
        { label: jaEventView.menu, children: TOGGLE_EVENT_KINDS.map((kind) => ({ id: eventKindActionId(kind), label: jaEventView.kinds[kind]! })) },
        {
          // 隣のマップの帯（Phase3。ZigzaguMap 独自）
          label: jaNeighbors.menu,
          accel: "B",
          children: [
            { id: "neighbors.band", label: jaNeighbors.viewBand },
            { id: "neighbors.all", label: jaNeighbors.viewAll },
            { id: "neighbors.off", label: jaNeighbors.viewOff },
          ],
        },
        // 時間帯（Phase6 #434。ZigzaguMap 独自）: CFRU の昼夜の色で見せる。起動したときはいつも昼
        {
          label: jaTimeOfDay.menu,
          enable: "map",
          children: (["morning", "day", "evening", "night"] as const).map((id) => ({ id: `time.${id}`, label: jaTimeOfDay.names[id]!, enable: "map" as const })),
        },
        // 移動許可だけ違うマスと、選んだ移動許可のマスの印（Phase3 #235。ZigzaguMap 独自）
        { id: "view.usageMarks", label: jaBlockUsage.menuMarks },
        // 3 層の次の番号が置かれているマスの印（Phase4 #301。ZigzaguMap 独自）
        { id: "view.tripleChildMarks", label: jaPen.tripleChildMarks },
        // オートペンで描けるブロックの色（Phase4 #310。ZigzaguMap 独自）
        { id: "view.autoPenTint", label: jaPen.autoPenTint },
        // クローン（Phase3 #242。ZigzaguMap 独自）: 印を付けたときだけ、隣のマップへクローンを自動で作り、帯の上に見せる
        { id: "view.clones", label: jaClone.menu },
        // タウンマップの小窓（#306。ZigzaguMap 独自）
        { id: "view.townMap", label: jaTownMini.menu, enable: "rom" },
        // 履歴の窓（Phase5 #402。ZigzaguMap 独自）
        { id: "view.history", label: jaCommands.menu, enable: "rom" },
        {
          label: ja.mapSize,
          accel: "M",
          children: [
            { id: "zoom.map", label: ja.zoomMap },
            { id: "zoom.movement", label: ja.zoomMovement },
            { id: "zoom.event", label: ja.zoomEvent },
            { id: "zoom.palette", label: ja.zoomBlockPalette },
            { id: "zoom.movementPalette", label: ja.zoomMovementPalette },
          ],
        },
        { id: "view.opacity", label: ja.movementOpacity, accel: "Q" },
        { id: "view.paletteWidth", label: ja.blockPaletteWidth, accel: "P" },
        // パレットのタイルセット 1・2 の境目（#308。ZigzaguMap 独自）
        { id: "view.paletteBoundary", label: jaPaletteInfo.boundaryMenu },
        sep,
        { id: "view.toolbar", label: ja.showToolbar, accel: "S" },
        { id: "view.combobox", label: ja.comboBox, accel: "N" },
        // マップ一覧のサムネイル（#315。ZigzaguMap 独自。既定オフ）
        { id: "view.treeThumbnails", label: jaThumbnails.menu },
        {
          label: ja.mapDisplay,
          accel: "O",
          enable: "rom",
          children: [{ label: ja.headerSort, children: ja.sortModes.map((label, i) => ({ id: `sort.${i}`, label })) }],
        },
        { id: "view.hideEventPanel", label: ja.hideEventPanel, accel: "L" },
        { id: "opt.advancedHeader", label: ja.advancedHeader, accel: "W", enable: "rom" },
      ],
    },
    {
      label: ja.menuSettings,
      accel: "Y",
      children: [
        { id: "opt.rememberLast", label: ja.rememberLast, accel: "U" },
        { id: "opt.autoSearch", label: ja.autoSearchOffset, accel: "V" },
        { id: "opt.backupOnOpen", label: ja.backupOnOpen, accel: "X" },
        { id: "opt.romShortcut", label: ja.createRomShortcut, accel: "R" },
        { id: "opt.contextMenu", label: ja.addContextMenu, accel: "A" },
        // ZigzaguMap 独自（Phase3）。コネクションマネージャーでずれを変えたとき相手側もそろえる
        { id: "opt.alignConnections", label: jaNeighbors.alignConnections, accel: "C" },
        // ROM を開いたとき、前回のプロジェクトフォルダを窓を出さずに開く（ユーザーの要望 #278。ZigzaguMap 独自）
        { id: "opt.rememberRomProject", label: ja.rememberRomProject },
        // ファイルの変化の監視（Phase5 #404。ZigzaguMap 独自）
        { id: "opt.watchProject", label: jaProjectWatch.menu },
        // 利用者の JavaScript のスクリプト（Phase5 #405。ZigzaguMap 独自）
        { id: "scripts.manage", label: jaUserScript.menu, enable: "rom" },
        {
          label: ja.recentSettings,
          accel: "Z",
          children: [
            { id: "recent.max", label: ja.recentMax },
            { id: "recent.clear", label: ja.recentClear },
            { id: "recent.showPath", label: ja.recentShowPath },
          ],
        },
        // ZigzaguMap 独自（Phase2）。メインと道具のウィンドウの配色（スクリプトエディタは自分のテーマを持つ）。
        {
          label: ja.themeMenu,
          accel: "T",
          children: [
            { id: "theme.light", label: ja.themeLight, accel: "L" },
            { id: "theme.dark", label: ja.themeDark, accel: "D" },
          ],
        },
        // ショートカットの変更（Phase5 #392。ZigzaguMap 独自）
        { id: "opt.shortcuts", label: jaShortcutEdit.menu },
        // すべての設定（Phase5 #404。ZigzaguMap 独自。表示と設定のメニューの項目とプロジェクトの設定を 1 つの窓に並べる）
        { id: "opt.allSettings", label: jaSettingsWindow.menu },
      ],
    },
    {
      label: ja.menuTools,
      accel: "X",
      children: [
        { id: "tools.blockEditor", label: ja.blockEditor, accel: "R", enable: "map" },
        { id: "tools.connections", label: ja.connections, accel: "S", enable: "map" },
        { id: "tools.worldMap", label: ja.worldMapEditor, accel: "T", enable: "rom" },
        // ZigzaguMap 独自（Phase4 #312）。オートペンのパーツを作る・直す、範囲を塗る・整える。
        { id: "tools.mapAssist", label: jaAssist.menu, accel: "H", enable: "map" },
        // ZigzaguMap 独自（Phase2 #201）。maps\scripts.json の対応表。
        { id: "tools.scriptsTable", label: jaScriptsTable.menu, accel: "Q", enable: "rom" },
        { id: "playback.open", label: jaPlayback.menu, enable: "map" },
        // ZigzaguMap 独自（Phase4 #314）。別の ROM のタイルセットを新しいタイルセットとして取り込む。
        { id: "tools.transplant", label: jaTransplant.menu, accel: "I", enable: "map" },
        // ZigzaguMap 独自（Phase5 #398）。種族を選び、全マップの野生からその種族が出る枠を探す。
        { id: "tools.wildSearch", label: jaWildTools.searchMenu, accel: "G", enable: "rom" },
        // ZigzaguMap 独自（Phase2 #198）。設定のビルドの手順を、スクリプトエディタの下の欄で動かす。
        { id: "tools.build", label: jaBuild.menu, accel: "B", enable: "rom" },
        { id: "tools.previousMap", label: ja.previousMap, accel: "U" },
        // ZigzaguMap 独自（Phase3 #237）。マップの履歴を進む（以前開いたマップを開くは「戻る」になった）。
        { id: "view.forward", label: jaMapFind.forward, enable: "rom" },
        { id: "tools.desktopShortcut", label: ja.desktopShortcut, accel: "V" },
        sep,
        { id: "tools.openMap", label: ja.openMapByNumber, accel: "W", enable: "rom" },
        // ZigzaguMap 独自（Phase3 #237）。マップ名の一部で探して開く（HexManiacAdvance の Ctrl+G。ZigzaguMap の Ctrl+G はグリッド）。
        { id: "map.find", label: jaMapFind.find, enable: "rom" },
        // ZigzaguMap 独自（Phase4 #307）。今のマップのポインタと、ROM の参照元の検索（読むだけの調査の道具）
        { id: "tools.pointers", label: jaPointers.menu, enable: "map" },
        // 利用者のスクリプトが登録した操作（Phase5 #405。`scripts.run.N` は `scriptItems` で差し込む）
        { label: jaUserScript.toolsMenu, enable: "rom", children: [...scriptItems, ...(scriptItems.length > 0 ? [sep] : []), { id: "scripts.manage", label: jaUserScript.menu, enable: "rom" }] },
        {
          label: ja.dummyData,
          accel: "X",
          enable: "map",
          children: [
            { id: "dummy.bankHeader", label: ja.moveBankHeader },
            { id: "dummy.bank", label: ja.moveBank },
            { id: "dummy.connections", label: ja.moveConnections },
            { id: "dummy.wildHeader", label: ja.moveWildHeader },
            { id: "dummy.manage", label: ja.manageBankHeader },
          ],
        },
        sep,
        { id: "image.map", label: ja.saveMapImage, accel: "Y", enable: "map" },
        { id: "image.mapEvent", label: ja.saveMapEventImage, enable: "map" },
        { id: "image.palette", label: ja.savePaletteImage, accel: "Z", enable: "map" },
        // ZigzaguMap 独自（Phase3 #246）。画像をクリップボードへ
        {
          label: jaComposite.menuCopyMap,
          enable: "map",
          children: [
            { id: "image.copyMap.none", label: jaComposite.eventsNone, enable: "map" },
            { id: "image.copyMap.persons", label: jaComposite.eventsPersons, enable: "map" },
            { id: "image.copyMap.all", label: jaComposite.eventsAll, enable: "map" },
          ],
        },
        {
          label: jaComposite.menuCopyWhole,
          enable: "map",
          children: [
            { id: "image.copyWhole.none", label: jaComposite.eventsNone, enable: "map" },
            { id: "image.copyWhole.persons", label: jaComposite.eventsPersons, enable: "map" },
            { id: "image.copyWhole.all", label: jaComposite.eventsAll, enable: "map" },
          ],
        },
      ],
    },
    {
      label: ja.menuHelp,
      accel: "W",
      children: [
        { id: "help.readme", label: ja.readMe, accel: "R" },
        { id: "help.shortcuts", label: ja.shortcutListMenu, accel: "S" },
        { id: "help.about", label: ja.aboutApp, accel: "A" },
        { id: "help.eula", label: ja.eula, accel: "Z" },
      ],
    },
  ]);
}

/** ファイル > 最近開いたもの（登録されている分だけ。最大数を超えた分は出さない）。 */
export function recentMenuItems(s: Pick<SettingsData, "recent" | "recentMax" | "recentShowPath">): MenuItem[] {
  return s.recent.slice(0, s.recentMax).map((entry, i): MenuItem => {
    const text = s.recentShowPath
      ? entry.rom + (entry.project ? ` + ${entry.project}` : "")
      : fileNameOf(entry.rom) + (entry.project ? ` + ${fileNameOf(entry.project)}` : "");
    return { id: `recent.${i}`, label: `${i + 1} ${text}`, accel: String(i + 1), inlineAccel: true };
  });
}

/** ツールバーのボタンの名前（操作の記録とステータスバーに出す）。 */
export function toolbarLabel(id: string): string {
  const map: Record<string, string> = {
    "map.new": ja.toolbar.newMap,
    "map.insert": ja.toolbar.insertMap,
    "view.objects": ja.toolbar.showObjects,
    "tools.blockEditor": ja.toolbar.blockEditor,
    "tools.connections": ja.toolbar.connections,
    "tools.worldMap": ja.toolbar.worldMap,
    "tools.find": ja.toolbar.find,
    "help.about": ja.toolbar.about,
  };
  return map[id] ?? id;
}

/** メニューの全項目を平らにする（ショートカットの検索用）。 */
export function flattenMenu(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...flattenMenu(item.children ?? [])]);
}
