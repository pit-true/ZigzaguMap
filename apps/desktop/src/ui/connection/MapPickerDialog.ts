import type { MapId } from "@zigzagumap/core";
import type { MapInfo } from "../../app/MapCatalog";
import { ja } from "../../i18n/ja";
import { jaNeighbors } from "../../i18n/ja.neighbors";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";

/** 一覧の 1 行の文字列（「3.19 1ばん どうろ」）。 */
function rowText(m: MapInfo): string {
  return `${m.id.bank}.${m.id.map} ${m.name ?? ja.noName}`;
}

/**
 * マップを選ぶダイアログ（辺のつまみの「既存のマップとつなぐ」など。#230）。上の欄に入れた文字で一覧を絞り込む
 * （番号「3.19」か名前の一部）。OK で選んだマップ（選んでいなければ絞り込んだ先頭）、キャンセルで null。
 * 自動操作からは `dialog` の `setInput`（絞り込み）と `press`（OK）で答える。
 */
export function pickMap(title: string, prompt: string, maps: readonly MapInfo[], exclude?: MapId): Promise<MapId | null> {
  return new Promise((resolve) => {
    const list = maps.filter((m) => !exclude || m.id.bank !== exclude.bank || m.id.map !== exclude.map);
    const finish = (value: MapId | null): void => {
      frame.remove();
      resolve(value);
    };
    const frame = createDialog({ title, width: 320, className: "input-dialog map-picker", onClose: () => finish(null) });
    const text = document.createElement("p");
    text.textContent = prompt;
    const filter = document.createElement("input");
    filter.type = "text";
    filter.placeholder = jaNeighbors.pickFilter;
    filter.dataset["autoId"] = "mapPicker.filter";
    const select = document.createElement("select");
    select.size = 12;
    select.style.width = "100%";
    select.dataset["autoId"] = "mapPicker.list";
    let shown: MapInfo[] = [];
    const refresh = (): void => {
      const q = filter.value.trim().toLowerCase();
      // 番号そのもの（3.19）は完全一致、それ以外は番号か名前の一部
      const exact = /^\d+\.\d+$/.test(q);
      shown = list.filter((m) => (exact ? `${m.id.bank}.${m.id.map}` === q : rowText(m).toLowerCase().includes(q)));
      select.replaceChildren(
        ...shown.map((m, i) => {
          const o = document.createElement("option");
          o.value = String(i);
          o.textContent = rowText(m);
          return o;
        }),
      );
      if (shown.length > 0) select.selectedIndex = 0;
    };
    const ok = (): void => {
      const m = shown[select.selectedIndex] ?? shown[0];
      if (m) finish(m.id);
    };
    filter.addEventListener("input", refresh);
    select.addEventListener("dblclick", ok);
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    buttons.append(dialogButton(ja.ok, ok), dialogButton(ja.cancel, () => finish(null)));
    frame.body.append(text, filter, select, buttons);
    handleDialogKeys(frame, () => finish(null), (e) => {
      if (e.key === "Enter") ok();
    });
    frame.register({
      title,
      text: prompt,
      ...pressable([
        { label: ja.ok, aliases: ["ok"], run: ok },
        { label: ja.cancel, aliases: ["cancel"], run: () => finish(null) },
      ]),
      setInput: (v) => {
        filter.value = v;
        refresh();
      },
      input: () => filter.value,
    });
    refresh();
    filter.focus();
  });
}
