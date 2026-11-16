import type { MenuItem } from "../../app/menuDefinition";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { jaBlockTools as tt } from "../../i18n/ja.blockTools";
import { jaTileImport } from "../../i18n/ja.tileImport";
import { MenuBar } from "../../ui/MenuBar";
import { isKeyAction, keyText, matchesKey } from "../../app/keymap";

/**
 * ブロックエディタのメニューバー（AdvanceMap と同じ 3 つのメニューとアクセスキー。後ろに ZigzaguMap だけのメニューを足す）。
 * 項目の ID は自動操作の `action` でも使う。
 */
export const BLOCK_EDITOR_MENU: readonly MenuItem[] = [
  {
    label: t.menuTiles,
    accel: "Z",
    children: [
      { id: "tiles.save1", label: t.saveTileset1, accel: "V" },
      { id: "tiles.open1", label: t.openTileset1, accel: "W" },
      { id: "tiles.save2", label: t.saveTileset2, accel: "X" },
      { id: "tiles.open2", label: t.openTileset2, accel: "Y" },
      { id: "tiles.reload", label: t.reloadBlocks, accel: "Z" },
      // ZigzaguMap だけの項目（#395）
      { separator: true },
      { id: "tiles.exportBlocks", label: tt.exportMenu, accel: "E" },
      { id: "tiles.newTileset", label: tt.newTilesetMenu, accel: "N" },
      // Phase6 #444
      { id: "tiles.importImage", label: jaTileImport.menu, accel: "I" },
    ],
  },
  {
    label: t.menuBlocks,
    accel: "Y",
    children: [
      { id: "blocks.save1", label: t.saveTileset1, accel: "V" },
      { id: "blocks.open1", label: t.openTileset1, accel: "W" },
      { id: "blocks.save2", label: t.saveTileset2, accel: "X" },
      { id: "blocks.open2", label: t.openTileset2, accel: "Y" },
      { id: "blocks.amount", label: t.blockAmount, accel: "Z" },
    ],
  },
  {
    label: t.menuPalette,
    accel: "X",
    children: [
      { id: "palette.editor", label: t.showPaletteEditor, accel: "W" },
      { id: "palette.commit", label: t.commitPalette, accel: "R" },
      { id: "palette.save", label: t.savePaletteFile, accel: "X" },
      { id: "palette.open", label: t.openPaletteFile, accel: "Y" },
      { id: "palette.remap", label: t.remapPalettes, accel: "Z" },
    ],
  },
  // ここから下は ZigzaguMap だけのメニュー（Phase5。AdvanceMap の 3 つのメニューの後ろに足す）
  {
    label: tt.menuEdit,
    accel: "E",
    children: [
      // キーは app/keymap.ts の表（`blockEditor.edit.*`。#392）
      { id: "edit.copy", label: tt.copy, accel: "C" },
      { id: "edit.cut", label: tt.cut, accel: "T" },
      { id: "edit.paste", label: tt.paste, accel: "P" },
      { separator: true },
      { id: "edit.swap", label: tt.swap, accel: "S" },
    ],
  },
  {
    label: tt.menuView,
    accel: "V",
    children: [
      { id: "view.usage", label: tt.viewUsage, accel: "U" },
      { id: "view.unusedBlocks", label: tt.viewUnusedBlocks, accel: "B" },
      { id: "view.unusedTiles", label: tt.viewUnusedTiles, accel: "T" },
    ],
  },
];

/** 項目の、キーの表（app/keymap.ts）での ID。 */
function keyId(id: string): string {
  return `blockEditor.${id}`;
}

/** 表にある項目へ、今のキーの表記を付けたメニュー。 */
function withKeys(items: readonly MenuItem[]): MenuItem[] {
  return items.map((item) => {
    const children = item.children ? withKeys(item.children) : undefined;
    const text = item.id && isKeyAction(keyId(item.id)) ? keyText(keyId(item.id)) : "";
    return { ...item, ...(children ? { children } : {}), ...(text ? { shortcut: { text } } : {}) };
  });
}

/**
 * メニューの項目のうち、押されたキーの項目を探す（入力欄の中は呼ぶ側で除く）。修飾キーまで合わせる。
 * キーは app/keymap.ts の表から引く（設定 > ショートカットの変更… で変えたもの。#392）。
 */
export function menuShortcut(e: KeyboardEvent): string | null {
  const find = (items: readonly MenuItem[]): string | null => {
    for (const item of items) {
      if (item.id && isKeyAction(keyId(item.id)) && matchesKey(keyId(item.id), e)) return item.id;
      if (item.children) {
        const hit = find(item.children);
        if (hit) return hit;
      }
    }
    return null;
  };
  return find(BLOCK_EDITOR_MENU);
}

/** メニューバーを作る。`actions` は項目の ID → 処理。 */
export function createBlockEditorMenu(actions: Readonly<Record<string, () => unknown>>, onError: (e: unknown) => void, isChecked: (id: string) => boolean = () => false): MenuBar {
  return new MenuBar({
    items: () => withKeys(BLOCK_EDITOR_MENU),
    isEnabled: () => true,
    isChecked,
    run: (id) => {
      const action = actions[id];
      if (action) Promise.resolve().then(action).catch(onError);
    },
  });
}
