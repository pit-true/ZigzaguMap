import { MAPSEC_FIRST, MAPSEC_NAMED_COUNT, MAPSEC_NONE, formatRomOffset, isRegionSection, type RegionMapDocument } from "@zigzagumap/core";
import { hex } from "../../i18n/ja";
import { jaWorldMap } from "../../i18n/ja.worldMap";
import { box, button, comboBox, edit, groupBox, label } from "./controls";

/** パネルが表示に使うもの。 */
export interface LayerPanelModel {
  readonly doc: RegionMapDocument;
  /** 地名 0x58〜0xC4 の名前。 */
  readonly names: readonly (string | null)[];
  /** 地名 0x58〜0xC4 の名前の文字列の位置。 */
  readonly nameOffsets: readonly number[];
}

/** パネルの入力欄の値（文字列のまま。読み取りは呼び出し側）。 */
export interface LayerPanelInput {
  readonly value: string;
  readonly x: string;
  readonly y: string;
  readonly width: string;
  readonly height: string;
  readonly name: string;
  readonly flag: string;
}

/** パネルのボタンと値の変化の受け手。 */
export interface LayerPanelEvents {
  /** マップの値（Txt_Wert かコンボ）が変わった。 */
  valueChanged(panel: LayerPanel, value: number): void;
  /** Txt_Wert に 16 進でない文字が入った（AdvanceMap の StrToInt のエラー）。 */
  invalidValue(text: string): void;
  savePosition(panel: LayerPanel): void;
  saveFlag(panel: LayerPanel): void;
}

/** 部品名の後ろに付ける文字（トップレイヤーは「2」）。 */
const SUFFIX = ["", "2"] as const;

/**
 * 「基本レイヤー」「トップレイヤー」のグループ（AdvanceMap の GroupBox_Wert / GroupBox_Wert2 と、
 * その中の ScrollBox_Wert・ScrollBox_FlugFlag）。マップの値、名前、座標、幅/高さ、人ID を出し、保存ボタンで確定する。
 */
export class LayerPanel {
  /** 表示している地名番号（16 進でない入力の間は直前の値）。 */
  value: number = MAPSEC_NONE;
  private readonly valueEdit: HTMLInputElement;
  private readonly combo: HTMLSelectElement;
  private readonly offsetEdit: HTMLInputElement;
  private readonly nameEdit: HTMLInputElement;
  private readonly xEdit: HTMLInputElement;
  private readonly yEdit: HTMLInputElement;
  private readonly widthEdit: HTMLInputElement;
  private readonly heightEdit: HTMLInputElement;
  private readonly flagEdit: HTMLInputElement;
  private readonly saveButton: HTMLButtonElement;
  private readonly flagButton: HTMLButtonElement;

  constructor(
    parent: HTMLElement,
    /** 0: 基本レイヤー、1: トップレイヤー。 */
    readonly layer: 0 | 1,
    left: number,
    private readonly events: LayerPanelEvents,
  ) {
    const s = SUFFIX[layer];
    const group = groupBox(parent, [left, 0, 209, 274], layer === 0 ? jaWorldMap.baseLayer : jaWorldMap.topLayer);
    const w = box(group, [8, layer === 0 ? 15 : 16, 199, 185]);
    label(w, [0, 8], jaWorldMap.mapValue);
    this.valueEdit = edit(w, [88, 0, 41, 19], `Txt_Wert${s}`);
    const names = layer === 0 ? [] : [jaWorldMap.unset];
    this.combo = comboBox(w, [0, 24, 193, 19], layer === 0 ? "Cbo_Wert_NamenListe" : "Cbo_Wert2_NamenListe", names, () => {
      const v = MAPSEC_FIRST + Number(this.combo.value);
      this.events.valueChanged(this, v);
    });
    label(w, [0, 48], jaWorldMap.nameHeader).classList.add("wm-heading");
    label(w, [0, 72], jaWorldMap.nameOffset);
    this.offsetEdit = edit(w, [88, 64, 105, 19], `Txt_Offset${s}`);
    this.offsetEdit.readOnly = true;
    label(w, [0, 96], jaWorldMap.name);
    this.nameEdit = edit(w, [88, 88, 105, 19], `Txt_Name${s}`);
    label(w, [0, 120], jaWorldMap.position);
    this.xEdit = edit(w, [88, 112, 41, 19], `Txt_PosX${s}`);
    this.yEdit = edit(w, [152, 112, 41, 19], `Txt_PosY${s}`);
    label(w, [0, 144], jaWorldMap.size);
    this.widthEdit = edit(w, [88, 136, 41, 19], `Txt_Breite${s}`);
    this.heightEdit = edit(w, [152, 136, 41, 19], `Txt_Hoehe${s}`);
    this.saveButton = button(w, [0, 160, 193, 25], jaWorldMap.savePosition, layer === 0 ? "Cmd_NameSpeichern" : "Cmd_Name2Speichern", () =>
      this.events.savePosition(this),
    );

    const f = box(group, [8, 200, 193, 65]);
    label(f, [0, 16], jaWorldMap.flagLabel);
    this.flagEdit = edit(f, layer === 0 ? [144, 8, 49, 19] : [152, 8, 41, 19], `Txt_FlugShowFlag${s}`);
    this.flagButton = button(f, [0, 40, 193, 25], jaWorldMap.saveFlag, `Cmd_SaveFlugShowFlag${s}`, () => this.events.saveFlag(this));

    this.valueEdit.maxLength = 2;
    this.valueEdit.addEventListener("input", () => {
      const text = this.valueEdit.value.trim();
      if (/^[0-9A-Fa-f]{1,2}$/.test(text)) this.events.valueChanged(this, parseInt(text, 16));
    });
    this.valueEdit.addEventListener("change", () => {
      const text = this.valueEdit.value.trim();
      if (!/^[0-9A-Fa-f]{1,2}$/.test(text)) this.events.invalidValue(text);
    });
  }

  /** 地名の名前を一覧に入れ直す（名前を変えたとき）。 */
  setNames(names: readonly (string | null)[]): void {
    const items = names.slice(0, MAPSEC_NAMED_COUNT).map((n) => n ?? "");
    if (this.layer === 1) items.push(jaWorldMap.unset);
    const selected = this.combo.selectedIndex;
    this.combo.length = 0;
    for (const [i, text] of items.entries()) this.combo.add(new Option(text, String(i)));
    this.combo.selectedIndex = selected < items.length ? selected : -1;
  }

  /** 地名番号の値を表示する。`keepValueText` なら Txt_Wert は書き換えない（打っている途中）。 */
  show(value: number, model: LayerPanelModel, keepValueText = false): void {
    this.value = value;
    if (!keepValueText) this.valueEdit.value = hex(value, 2);
    const index = value - MAPSEC_FIRST;
    const comboCount = this.combo.options.length;
    this.combo.selectedIndex = index >= 0 && index < comboCount ? index : -1;
    const named = index >= 0 && index < MAPSEC_NAMED_COUNT;
    const offset = named ? model.nameOffsets[index] : undefined;
    this.offsetEdit.value = offset !== undefined ? formatRomOffset(offset) : "";
    this.nameEdit.value = named ? (model.names[index] ?? "") : "";
    const section = model.doc.section(value);
    this.xEdit.value = section ? String(section.x) : "";
    this.yEdit.value = section ? String(section.y) : "";
    this.widthEdit.value = section ? String(section.width) : "";
    this.heightEdit.value = section ? String(section.height) : "";
    this.flagEdit.value = isRegionSection(value) ? hex(model.doc.flag(this.layer, value), 4) : "";
    const editable = isRegionSection(value) && value !== MAPSEC_NONE;
    this.saveButton.disabled = !editable;
    this.flagButton.disabled = !editable;
    this.nameEdit.disabled = !named;
    for (const e of [this.xEdit, this.yEdit, this.widthEdit, this.heightEdit, this.flagEdit]) e.disabled = !editable;
  }

  /** 入力欄の値。 */
  input(): LayerPanelInput {
    return {
      value: this.valueEdit.value,
      x: this.xEdit.value,
      y: this.yEdit.value,
      width: this.widthEdit.value,
      height: this.heightEdit.value,
      name: this.nameEdit.value,
      flag: this.flagEdit.value,
    };
  }
}
