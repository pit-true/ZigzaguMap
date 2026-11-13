import { parseIntInput } from "@zigzagumap/core";
import "../../styles/newmap.css";
import { jaNewMap } from "../../i18n/ja.newMap";
import { createDialog, handleDialogKeys, pressable } from "../Dialog";
import { button, combo, edit, label, panel, selectIndex } from "../form/controls";
import { showNewMapError } from "./newMapErrors";

/** ダイアログに入れたもの（幅・高さは空なら null、タイルセットは未選択なら null）。 */
export interface NewMapInput {
  readonly name: string;
  readonly width: number | null;
  readonly height: number | null;
  /** AdvanceMap のタイルセット番号。 */
  readonly tileset1: number | null;
  readonly tileset2: number | null;
}

/** 新規マップの作成ダイアログの初期値と、作成を押したときの処理。 */
export interface NewMapDialogOptions {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  /** タイルセットの数（コンボの 0〜n-1）。 */
  readonly tilesetCount: number;
  /** 作成する。入力エラーなら例外を投げる（ダイアログは開いたまま）。 */
  readonly create: (input: NewMapInput) => void;
}

/**
 * 「新しいマップ」ダイアログ（AdvanceMap の TMapForm）。初期値は今のマップの名前と大きさ、タイルセットは未選択。
 * 作成を押したときに確かめる（AdvanceMap と同じく 1 文字ごとには確かめない）: 幅・高さが整数でなければ
 * 「'abc' is not a valid integer value.」、空・0 以下・未選択があれば「すべて記入してください」、大きすぎれば
 * 「The max map height at a map width of …」。エラーのときは閉じない。作成できたら true、キャンセルなら false。
 */
export function openNewMapDialog(options: NewMapDialogOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const t = jaNewMap;
    const finish = (created: boolean): void => {
      frame.remove();
      resolve(created);
    };
    const frame = createDialog({ title: t.dialogTitle, width: 227, className: "new-map-dialog", onClose: () => finish(false) });
    const body = panel("new-map", 225, 219);
    const name = edit("newMap.name", 80, 16, 137, 21);
    const width = edit("newMap.width", 80, 48, 137, 21);
    const height = edit("newMap.height", 80, 80, 137, 21);
    const numbers = Array.from({ length: options.tilesetCount }, (_, i) => String(i));
    const tileset1 = combo("newMap.tileset1", numbers, 80, 112, 137);
    const tileset2 = combo("newMap.tileset2", numbers, 80, 144, 137);
    for (const c of [tileset1, tileset2]) {
      c.style.height = "21px";
      selectIndex(c, -1);
    }
    name.value = options.name;
    width.value = String(options.width);
    height.value = String(options.height);

    let busy = false;
    const create = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        const size = (text: string): number | null => (text === "" ? null : parseIntInput(text));
        options.create({
          name: name.value,
          width: size(width.value),
          height: size(height.value),
          tileset1: tileset1.selectedIndex < 0 ? null : tileset1.selectedIndex,
          tileset2: tileset2.selectedIndex < 0 ? null : tileset2.selectedIndex,
        });
        finish(true);
      } catch (e) {
        await showNewMapError(e);
      } finally {
        busy = false;
      }
    };
    body.append(
      label(t.name, 16, 20),
      label(t.width, 16, 52),
      label(t.height, 16, 84),
      label(t.tileset1, 16, 116),
      label(t.tileset2, 16, 148),
      name,
      width,
      height,
      tileset1,
      tileset2,
      button("newMap.create", t.create, 16, 176, 97, 33, () => void create()),
      button("newMap.cancel", t.cancel, 120, 176, 97, 33, () => finish(false)),
    );
    frame.body.append(body);
    handleDialogKeys(frame, () => finish(false), (e) => {
      if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement)) void create();
    });
    frame.register({
      title: t.dialogTitle,
      text: "",
      ...pressable([
        { label: t.create, run: () => void create() },
        { label: t.cancel, run: () => finish(false) },
      ]),
    });
    name.focus();
    name.select();
  });
}
