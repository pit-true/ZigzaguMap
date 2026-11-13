import { SetWildRateCommand, SetWildSlotCommand, WILD_SLOT_COUNTS, WildTime, type Command, type WildArea, type WildEncounters } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { commit, watchCommands } from "../form/commit";
import { autoId, button, combo, edit, label, panel, place } from "../form/controls";
import { clampByte, toByte } from "../form/inputErrors";
import { checkOnInput, tryInteger } from "../form/integerInput";
import { FR_SPECIES_COUNT, SpeciesOptions } from "./SpeciesNames";

/** 1 枠の欄。 */
interface SlotRow {
  readonly parts: HTMLElement[];
  readonly min: HTMLInputElement;
  readonly max: HTMLInputElement;
  readonly species: HTMLSelectElement;
}

/** トラックバーの PageUp / PageDown の幅（AdvanceMap の PageSize）。 */
const PAGE_SIZE = 25;

/** 表示する時間帯の野生（素の ROM は昼だけ。昼が無ければ先頭）。 */
export function shownWild(wild: readonly WildEncounters[]): WildEncounters | null {
  return wild.find((w) => w.time === WildTime.Day) ?? wild[0] ?? null;
}

/**
 * 出現ポケモンタブ（AdvanceMap の Frame_WildePokemon と同じ並び）。
 * - タイプを選ぶとそのタイプの出現確率と各枠を出す（保存前の編集は捨てる）。データの無いタイプでは部品を隠す。
 * - 出現確率の欄とトラックバーと百分率が連動する（0〜255 に丸める）。
 * - 「設定の保存」で、表示中のタイプの確率と各枠（最小 Lv・最大 Lv・種族）を編集中の状態へ反映する。
 *   Lv は検査せず 1 バイトに切り詰める（300 → 44）。空欄は元の値のまま。
 * - 野生データの無いマップでは「このマップには野生ポケモンが存在しません」と「野生ポケモンの追加」を出す。
 */
export class WildTab {
  readonly element: HTMLElement;
  private readonly frame: HTMLElement;
  private readonly sorry: HTMLElement;
  private readonly type: HTMLSelectElement;
  private readonly save: HTMLButtonElement;
  private readonly rate: HTMLInputElement;
  private readonly percent: HTMLElement;
  private readonly bar: HTMLInputElement;
  private readonly areaParts: HTMLElement[];
  private readonly rows: SlotRow[] = [];
  private readonly speciesOptions: SpeciesOptions;
  private stale = true;
  private shownMap = "";

  constructor(private readonly state: EditorState) {
    const w = ja.wild;
    this.element = document.createElement("div");
    this.element.className = "wild-tab am-scroll";
    this.speciesOptions = new SpeciesOptions(() => state.session);

    this.frame = panel("wild-frame", 537, 433);
    this.type = combo("wild.type", w.areas, 144, 8, 97);
    this.save = button("wild.save", w.save, 256, 8, 81, 25, () => this.saveArea());
    const addType = button("wild.addType", w.addType, 256, 32, 81, 25, () => void this.openAddDialog());
    this.rate = edit("wild.rate", 144, 32, 57);
    this.percent = autoId(label("", 201, 40, 40), "wild.percent");
    this.percent.style.textAlign = "right";
    this.bar = autoId(place(document.createElement("input"), 0, 56, 249, 25), "wild.rateBar");
    this.bar.type = "range";
    this.bar.min = "0";
    this.bar.max = "255";
    this.bar.step = "1";
    this.bar.classList.add("am-trackbar");
    const levelHead = label(w.level, 88, 88);
    const speciesHead = label(w.species, 176, 88);
    // データの無いタイプでは百分率とトラックバーを隠す（出現確率の欄は空にして残す。AdvanceMap と同じ）。
    this.areaParts = [this.percent, this.bar];
    for (let i = 0; i < 12; i++) {
      const y = 104 + i * 24;
      const min = edit(`wild.min.${i + 1}`, 96, y, 25);
      const max = edit(`wild.max.${i + 1}`, 120, y, 25);
      // AdvanceMap は Lv の欄も入力のたびに読む（読めなければエラー。範囲は確かめない）。
      checkOnInput(min, "int");
      checkOnInput(max, "int");
      const species = combo(`wild.species.${i + 1}`, [], 144, y, 97);
      this.rows.push({ parts: [label(w.slot(i + 1), 8, y + 2), min, max, species], min, max, species });
    }
    this.frame.append(label(w.type, 8, 8), this.type, this.save, addType, label(w.rate, 8, 32), this.rate, levelHead, speciesHead, ...this.areaParts, ...this.rows.flatMap((r) => r.parts));

    this.sorry = panel("wild-sorry", 537, 80);
    this.sorry.append(label(w.noWild, 8, 8), button("wild.create", w.create, 24, 24, 225, 41, () => void this.openAddDialog()));
    this.element.append(this.frame, this.sorry);

    this.type.addEventListener("change", () => this.showArea());
    // 入力のたびに読んでトラックバーと百分率を合わせる（読めなければエラー）。確定したら丸めた値を出し直す。
    checkOnInput(this.rate, "int", (n) => this.showRate(clampByte(n), false));
    this.rate.addEventListener("change", () => {
      const n = tryInteger(this.rate.value, "int");
      if (n !== null) this.showRate(clampByte(n), true);
    });
    this.bar.addEventListener("input", () => this.showRate(Number(this.bar.value), true));
    this.bar.addEventListener("keydown", (e) => {
      if (e.key !== "PageUp" && e.key !== "PageDown") return;
      e.preventDefault();
      this.showRate(clampByte(Number(this.bar.value) + (e.key === "PageUp" ? PAGE_SIZE : -PAGE_SIZE)), true);
    });

    const refresh = (): void => {
      this.stale = true;
      this.render();
    };
    state.on("map", refresh);
    state.on("tab", () => this.render());
    watchCommands(state, refresh);
  }

  private get wild(): WildEncounters | null {
    return shownWild(this.state.map?.doc.wild ?? []);
  }

  private get area(): WildArea | null {
    const a = this.wild?.areas[this.type.selectedIndex];
    return a && a.slots.length > 0 ? a : null;
  }

  private render(): void {
    if (!this.stale || this.state.tab !== "wild") return;
    this.stale = false;
    const map = this.state.map;
    const hasData = !!this.wild?.areas.some((a) => a.slots.length > 0);
    this.frame.hidden = !map || !hasData;
    this.sorry.hidden = !map || hasData;
    if (!map || !hasData) {
      // AdvanceMap と同じく、データの無いマップではタイプを選んでいない状態にする
      this.type.selectedIndex = -1;
      this.shownMap = "";
      return;
    }
    const key = `${map.id.bank}.${map.id.map}`;
    if (key !== this.shownMap) {
      this.shownMap = key;
      this.type.selectedIndex = 0;
    }
    this.showArea();
  }

  /** 選んでいるタイプのデータを欄に出す（編集中の値は捨てる）。 */
  private showArea(): void {
    const area = this.area;
    this.save.disabled = !area;
    for (const el of this.areaParts) el.hidden = !area;
    const count = area ? (WILD_SLOT_COUNTS[this.type.selectedIndex] ?? area.slots.length) : 0;
    if (!area) {
      // AdvanceMap と同じく、データの無いタイプでは確率の欄と百分率を空にする
      this.rate.value = "";
      this.percent.textContent = "";
    } else this.showRate(area.rate, true);
    const maxSpecies = Math.max(FR_SPECIES_COUNT - 1, ...(area?.slots.map((s) => s.species) ?? []));
    const template = area ? this.speciesOptions.options(maxSpecies + 1) : null;
    this.rows.forEach((row, i) => {
      const slot = area?.slots[i];
      const visible = !!slot && i < count;
      for (const el of row.parts) el.hidden = !visible;
      if (!visible || !template) return;
      row.min.value = String(slot.minLevel);
      row.max.value = String(slot.maxLevel);
      if (row.species.options.length !== template.options.length || row.species.dataset["key"] !== template.dataset["key"]) {
        row.species.replaceChildren(...[...template.options].map((o) => o.cloneNode(true)));
        row.species.dataset["key"] = template.dataset["key"];
      }
      row.species.selectedIndex = slot.species;
    });
  }

  /** 出現確率を欄・トラックバー・百分率に出す。 */
  private showRate(rate: number, toText: boolean): void {
    if (toText) this.rate.value = String(rate);
    this.bar.value = String(rate);
    this.percent.textContent = ja.wild.percent(rate);
  }

  private saveArea(): void {
    const map = this.state.map;
    const area = this.area;
    const wild = this.wild;
    if (!map || !area || !wild) return;
    const base = { bank: map.id.bank, map: map.id.map, time: wild.time, area: this.type.selectedIndex };
    const commands: Command[] = [];
    // 読めない欄は入力のときにエラーを出してあるので、元の値のままにする。
    const rateValue = tryInteger(this.rate.value, "int");
    if (rateValue !== null) {
      const rate = clampByte(rateValue);
      if (rate !== area.rate) commands.push(new SetWildRateCommand({ ...base, rate }));
    }
    for (let i = 0; i < area.slots.length && i < this.rows.length; i++) {
      const slot = area.slots[i]!;
      const row = this.rows[i]!;
      const level = (input: HTMLInputElement, old: number): number => {
        const n = tryInteger(input.value, "int");
        return n === null ? old : toByte(n);
      };
      const minLevel = level(row.min, slot.minLevel);
      const maxLevel = level(row.max, slot.maxLevel);
      const species = row.species.selectedIndex < 0 ? slot.species : row.species.selectedIndex;
      if (minLevel !== slot.minLevel || maxLevel !== slot.maxLevel || species !== slot.species) {
        commands.push(new SetWildSlotCommand({ ...base, slot: i, minLevel, maxLevel, species }));
      }
    }
    commit(this.state, commands);
  }

  /** 「タイプの追加」「野生ポケモンの追加」のダイアログ（開いたときに読み込む）。 */
  private async openAddDialog(): Promise<void> {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const { openWildAddDialog } = await import("./WildAddDialog");
    const added = await openWildAddDialog(this.state, session, map.id);
    if (added !== null) {
      this.stale = true;
      this.type.selectedIndex = added;
      this.shownMap = `${map.id.bank}.${map.id.map}`;
      this.render();
    }
  }
}
