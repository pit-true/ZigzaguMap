import { SetHeaderFieldsCommand, type MapHeaderFields } from "@zigzagumap/core";
import { FR_MUSIC } from "../../app/data/frMusic";
import { hex, ja } from "../../i18n/ja";
import { commit } from "../form/commit";
import { combo, edit, group, label, selectIndex } from "../form/controls";
import { checkOnInput, tryInteger } from "../form/integerInput";
import { choices16, type HeaderContext } from "./HeaderContext";

/** 選ぶとすぐ反映するコンボ（項目名とコンボ）。 */
type FieldCombo = readonly [keyof MapHeaderFields, HTMLSelectElement];

/**
 * 「マップオプション:」の枠（GroupBox2）。音楽（コンボと 16 進 4 桁の欄が連動）、明るさ、天候、マップタイプ、戦闘背景。
 * AdvanceMap と同じく、選んだ（入れた）時点でヘッダーへ反映する（AdvanceMap はメモリ上、ZigzaguMap は編集中の状態）。
 */
export class OptionsGroup {
  readonly element: HTMLElement;
  private readonly music: HTMLSelectElement;
  private readonly musicNo: HTMLInputElement;
  private readonly combos: readonly FieldCombo[];
  private ctx: HeaderContext | null = null;

  constructor() {
    const h = ja.header;
    this.element = group(h.options, 8, 176, 465, 169);
    // 先頭は空欄（AdvanceMap の Cbo_Musik と同じ並び）。
    this.music = combo("header.music", ["", ...FR_MUSIC.map(([id, name]) => `${hex(id, 4)} ${name}`)], 16, 40, 353);
    this.musicNo = edit("header.musicNo", 376, 40, 73);
    const cave = combo("header.cave", choices16(ja.caveTypes), 16, 88, 201);
    const weather = combo("header.weather", choices16(ja.weathers), 248, 88, 201);
    const mapType = combo("header.mapType", choices16(ja.mapTypes), 16, 136, 201);
    const battle = combo("header.battleType", choices16(ja.battleTypes), 248, 136, 201);
    this.combos = [
      ["cave", cave],
      ["weather", weather],
      ["mapType", mapType],
      ["battleType", battle],
    ];
    const musicNoLabel = label(h.musicNo, 376, 24, 73);
    musicNoLabel.style.textAlign = "right";
    this.element.append(
      label(h.music, 16, 24),
      this.music,
      musicNoLabel,
      this.musicNo,
      label(h.cave, 16, 72),
      cave,
      label(h.weather, 248, 72),
      weather,
      label(h.mapType, 16, 120),
      mapType,
      label(h.battle, 248, 120),
      battle,
    );
    this.music.addEventListener("change", () => {
      const entry = FR_MUSIC[this.music.selectedIndex - 1];
      if (entry) this.set({ music: entry[0] });
    });
    // AdvanceMap と同じく入力のたびに 16 進として読み、コンボを合わせる（読めなければエラー）。反映は欄の確定時。
    checkOnInput(this.musicNo, "hex", () => this.showMusicCombo());
    this.musicNo.addEventListener("change", () => {
      const value = tryInteger(this.musicNo.value, "hex");
      if (value !== null) this.set({ music: value & 0xffff });
    });
    for (const [field, select] of this.combos) {
      select.addEventListener("change", () => {
        if (select.selectedIndex >= 0) this.set({ [field]: select.selectedIndex });
      });
    }
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const header = ctx.doc.header;
    this.musicNo.value = hex(header.music, 4);
    this.showMusicCombo();
    for (const [field, select] of this.combos) selectIndex(select, header[field]);
  }

  /** 音楽の欄の値に合わせてコンボを選ぶ（一覧に無い値なら空）。 */
  private showMusicCombo(): void {
    const value = parseInt(this.musicNo.value.replace(/^\$/, ""), 16);
    const i = FR_MUSIC.findIndex(([id]) => id === value);
    selectIndex(this.music, i < 0 ? -1 : i + 1);
  }

  private set(fields: Record<string, number>): void {
    const c = this.ctx;
    if (!c) return;
    const changed = Object.entries(fields).some(([k, v]) => (c.doc.header as unknown as Record<string, number>)[k] !== v);
    if (!changed) return;
    commit(c.state, [new SetHeaderFieldsCommand({ bank: c.map.id.bank, map: c.map.id.map, fields })]);
  }
}
