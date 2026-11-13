import { REGION_MAP_PAGES } from "@zigzagumap/core";
import { jaWorldMap } from "../../i18n/ja.worldMap";
import { box, button, comboBox, edit, label } from "./controls";

/**
 * 「タウンマップNo」の欄（AdvanceMap の ScrollBox_WorldMapNr）。1: カントー、2: 1〜3のしま、3: 4〜5のしま、4: 6〜7のしま。
 * 「ワールドマップ番号の管理」と横の欄は AdvanceMap でも押せない（BPRJ では使わない）ので無効のまま置く。
 */
export class TownMapNoPanel {
  private readonly combo: HTMLSelectElement;

  constructor(parent: HTMLElement, onChange: (page: number) => void) {
    const b = box(parent, [469, 274, 212, 88]);
    label(b, [8, 8], jaWorldMap.townMapNo);
    this.combo = comboBox(
      b,
      [8, 24, 145, 19],
      "Cbo_Anzahl",
      REGION_MAP_PAGES.map((_, i) => String(i + 1)),
      () => onChange(Number(this.combo.value)),
    );
    edit(b, [160, 24, 41, 19], "Txt_WorldMap1Bis").disabled = true;
    button(b, [8, 56, 193, 25], jaWorldMap.manageNumbers, "Cmd_NameWeltkartenNrZuordnen", () => undefined).disabled = true;
  }

  /** 選んでいる面（0〜3）。 */
  get page(): number {
    return Number(this.combo.value);
  }

  set page(value: number) {
    this.combo.value = String(value);
  }
}
