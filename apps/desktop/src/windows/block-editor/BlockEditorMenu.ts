import type { MenuItem } from "../../app/menuDefinition";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { MenuBar } from "../../ui/MenuBar";

/**
 * ブロックエディタのメニューバー（AdvanceMap と同じ 3 つのメニューとアクセスキー）。
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
];

/** メニューバーを作る。`actions` は項目の ID → 処理。 */
export function createBlockEditorMenu(actions: Readonly<Record<string, () => unknown>>, onError: (e: unknown) => void): MenuBar {
  return new MenuBar({
    items: () => [...BLOCK_EDITOR_MENU],
    isEnabled: () => true,
    isChecked: () => false,
    run: (id) => {
      const action = actions[id];
      if (action) Promise.resolve().then(action).catch(onError);
    },
  });
}
