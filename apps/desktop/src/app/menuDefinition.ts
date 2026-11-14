import { ja } from "../i18n/ja";
import { jaNeighbors } from "../i18n/ja.neighbors";
import { jaScriptsTable } from "../i18n/ja.scriptsTable";
import { jaBuild } from "../i18n/ja.build";
import { jaMapFind } from "../i18n/ja.mapFind";
import { jaBlockUsage } from "../i18n/ja.blockUsage";

/** ショートカットキー。`key` は KeyboardEvent.key を大文字にしたもの（"O"、"F5"、"BACKSPACE" など）。 */
export interface Shortcut {
  readonly key: string;
  readonly ctrl?: boolean;
  readonly alt?: boolean;
  readonly shift?: boolean;
  /** メニューに出す表記。 */
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

const ctrl = (key: string): Shortcut => ({ key, ctrl: true, text: `Ctrl+${key}` });
const fkey = (key: string): Shortcut => ({ key, text: key });

/**
 * メニューの全項目（AdvanceMap 1.92 日本語版のアクセスキー・ショートカットをもとにした）。
 * ユーザーの要望で「表示」を足し、「設定」にあった見た目の項目を移した（ファイル・表示・設定・ツール・ヘルプ）。
 * 最近開いたもの（`recent.N`）は `recentItems` で差し込む。
 * 「オブジェクトの表示」の Ctrl+Z はアンドゥに使うため外した。
 */
export function buildMenu(recentItems: readonly MenuItem[]): MenuItem[] {
  return [
    {
      label: ja.menuFile,
      accel: "Z",
      children: [
        { id: "file.open", label: ja.openRom, accel: "R", shortcut: ctrl("O") },
        { id: "file.openProject", label: ja.openProject, accel: "P" },
        { id: "file.reload", label: ja.reloadRom, accel: "O", shortcut: fkey("F5") },
        sep,
        { id: "file.export", label: ja.exportMaps, accel: "M", shortcut: ctrl("S") },
        { id: "file.exportTo", label: ja.exportMapsTo, accel: "W" },
        { id: "file.backup", label: ja.createBackup, accel: "X", enable: "map" },
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
        { id: "view.grid", label: ja.showGrid, accel: "J", shortcut: ctrl("G"), enable: "map" },
        { id: "view.objects", label: ja.showObjects, accel: "K" },
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
        // 移動許可だけ違うマスと、選んだ移動許可のマスの印（Phase3 #235。ZigzaguMap 独自）
        { id: "view.usageMarks", label: jaBlockUsage.menuMarks },
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
        { id: "view.paletteWidth", label: ja.blockPaletteWidth, accel: "P", shortcut: ctrl("P") },
        sep,
        { id: "view.toolbar", label: ja.showToolbar, accel: "S", shortcut: ctrl("T") },
        { id: "view.combobox", label: ja.comboBox, accel: "N" },
        {
          label: ja.mapDisplay,
          accel: "O",
          enable: "rom",
          children: [{ label: ja.headerSort, children: ja.sortModes.map((label, i) => ({ id: `sort.${i}`, label })) }],
        },
        { id: "view.hideEventPanel", label: ja.hideEventPanel, accel: "L" },
        { id: "opt.advancedHeader", label: ja.advancedHeader, accel: "W", shortcut: ctrl("H"), enable: "rom" },
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
      ],
    },
    {
      label: ja.menuTools,
      accel: "X",
      children: [
        { id: "tools.blockEditor", label: ja.blockEditor, accel: "R", shortcut: ctrl("B"), enable: "map" },
        { id: "tools.connections", label: ja.connections, accel: "S", shortcut: ctrl("A"), enable: "map" },
        { id: "tools.worldMap", label: ja.worldMapEditor, accel: "T", shortcut: ctrl("W"), enable: "rom" },
        // ZigzaguMap 独自（Phase2 #201）。maps\scripts.json の対応表。
        { id: "tools.scriptsTable", label: jaScriptsTable.menu, accel: "Q", enable: "rom" },
        // ZigzaguMap 独自（Phase2 #198）。設定のビルドの手順を、スクリプトエディタの下の欄で動かす。
        { id: "tools.build", label: jaBuild.menu, accel: "B", shortcut: fkey("F7"), enable: "rom" },
        { id: "tools.previousMap", label: ja.previousMap, accel: "U", shortcut: { key: "BACKSPACE", alt: true, text: "Alt+BkSp" } },
        // ZigzaguMap 独自（Phase3 #237）。マップの履歴を進む（以前開いたマップを開くは「戻る」になった）。
        { id: "view.forward", label: jaMapFind.forward, shortcut: { key: "BACKSPACE", alt: true, shift: true, text: "Alt+Shift+BkSp" }, enable: "rom" },
        { id: "tools.desktopShortcut", label: ja.desktopShortcut, accel: "V" },
        sep,
        { id: "tools.openMap", label: ja.openMapByNumber, accel: "W", shortcut: ctrl("M"), enable: "rom" },
        // ZigzaguMap 独自（Phase3 #237）。マップ名の一部で探して開く（HexManiacAdvance の Ctrl+G。ZigzaguMap の Ctrl+G はグリッド）。
        { id: "map.find", label: jaMapFind.find, shortcut: ctrl("F"), enable: "rom" },
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
      ],
    },
    {
      label: ja.menuHelp,
      accel: "W",
      children: [
        { id: "help.readme", label: ja.readMe, accel: "R" },
        { id: "help.shortcuts", label: ja.shortcutListMenu, accel: "S" },
        { id: "help.about", label: ja.aboutApp, accel: "A", shortcut: fkey("F1") },
        { id: "help.eula", label: ja.eula, accel: "Z", shortcut: fkey("F2") },
      ],
    },
  ];
}

/** メニューの全項目を平らにする（ショートカットの検索用）。 */
export function flattenMenu(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((item) => [item, ...flattenMenu(item.children ?? [])]);
}
