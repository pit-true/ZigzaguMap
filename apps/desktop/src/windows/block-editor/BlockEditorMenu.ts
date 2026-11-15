import type { MenuItem } from "../../app/menuDefinition";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { jaBlockTools as tt } from "../../i18n/ja.blockTools";
import { MenuBar } from "../../ui/MenuBar";

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
      { id: "edit.copy", label: tt.copy, accel: "C", shortcut: { key: "c", ctrl: true, text: "Ctrl+C" } },
      { id: "edit.cut", label: tt.cut, accel: "T", shortcut: { key: "x", ctrl: true, text: "Ctrl+X" } },
      { id: "edit.paste", label: tt.paste, accel: "P", shortcut: { key: "v", ctrl: true, text: "Ctrl+V" } },
      { separator: true },
      { id: "edit.swap", label: tt.swap, accel: "S", shortcut: { key: "x", text: "X" } },
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

/**
 * メニューの項目のうち、ショートカットのキーを持つものを、押されたキーで探す（入力欄の中は呼ぶ側で除く）。
 * Ctrl の有無まで合わせる。
 */
export function menuShortcut(e: KeyboardEvent): string | null {
  const find = (items: readonly MenuItem[]): string | null => {
    for (const item of items) {
      const s = item.shortcut;
      if (item.id && s && s.key.toLowerCase() === e.key.toLowerCase() && !!s.ctrl === e.ctrlKey && !!s.shift === e.shiftKey && !e.altKey) return item.id;
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
    items: () => [...BLOCK_EDITOR_MENU],
    isEnabled: () => true,
    isChecked,
    run: (id) => {
      const action = actions[id];
      if (action) Promise.resolve().then(action).catch(onError);
    },
  });
}
