import type { MapId } from "@zigzagumap/core";
import { jaMapList as t } from "../i18n/ja.mapList";
import { showContextMenu } from "../ui/ContextMenu";

/** 右クリックのメニューが使う窓口。 */
export interface MapTreeMenuHost {
  openMap(id: MapId): Promise<void>;
  /** 文字をクリップボードへ（自動操作のときはクリップボードを書き換えない）。 */
  copyText(text: string): void;
  /** 同じバンクの最後に写す（「マップの追加/挿入」の追加と同じ）。 */
  duplicate(id: MapId): Promise<MapId | null>;
  setStatus(text: string): void;
}

/** 番号の書き方（`3.0`）。 */
export function mapIdText(id: MapId): string {
  return `${id.bank}.${id.map}`;
}

/**
 * マップ一覧の右クリック（Phase5 #401）: 開く、名前をコピー、番号をコピー、このマップを複製。`name` はコピーする名前。
 */
export function showMapTreeMenu(host: MapTreeMenuHost, id: MapId, name: string, x: number, y: number): void {
  const copy = (text: string): void => {
    host.copyText(text);
    host.setStatus(t.copied(text));
  };
  showContextMenu(x, y, [
    { id: "tree.open", label: t.menuOpen, run: () => void host.openMap(id) },
    { id: "tree.copyName", label: t.menuCopyName, run: () => copy(name) },
    { id: "tree.copyId", label: t.menuCopyId, run: () => copy(mapIdText(id)) },
    {
      id: "tree.duplicate",
      label: t.menuDuplicate,
      run: () =>
        void host.duplicate(id).then((to) => {
          if (to) host.setStatus(t.duplicated(to.bank, to.map, mapIdText(id)));
        }),
    },
  ]);
}
