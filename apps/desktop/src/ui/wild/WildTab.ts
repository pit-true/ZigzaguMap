import {
  SetWildRateCommand,
  SetWildSlotCommand,
  SetWildTableCommand,
  WILD_SLOT_COUNTS,
  WILD_TIMES,
  WildAreaKind,
  WildTime,
  hasWildData,
  rateGroup,
  slotRate,
  wildOfTime,
  type Command,
  type WildArea,
  type WildEncounters,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { jaWildTools as wt } from "../../i18n/ja.wildTools";
import { jaWildTime as tt } from "../../i18n/ja.wildTime";
import { commit, watchCommands } from "../form/commit";
import { autoId, button, combo, edit, label, panel, place } from "../form/controls";
import { clampByte, toByte } from "../form/inputErrors";
import { checkOnInput, tryInteger } from "../form/integerInput";
import { FR_SPECIES_COUNT, SpeciesOptions, speciesLabel, speciesNameProvider } from "./SpeciesNames";

/** 1 枠の欄。 */
interface SlotRow {
  readonly parts: HTMLElement[];
  readonly min: HTMLInputElement;
  readonly max: HTMLInputElement;
  readonly species: HTMLSelectElement;
  /** 枠の割合（ゲームの処理で決まる値。#398）。 */
  readonly rate: HTMLElement;
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
  private namesSession: unknown = null;
  private shownMap = "";
  /** 時間帯のタブ（Phase6 #436。プロジェクトフォルダを開いているときだけ出す）。 */
  private readonly times: HTMLElement;
  private readonly timeButtons: HTMLButtonElement[];
  private readonly removeTime: HTMLButtonElement;
  /** 表の無い時間帯の案内（作る・写すボタン）。 */
  private readonly missing: HTMLElement;
  private readonly missingText: HTMLElement;
  private readonly copyDay: HTMLButtonElement;
  /** 見ている時間帯（Wild[].Time。既定は昼）。 */

  constructor(private readonly state: EditorState) {
    const w = ja.wild;
    this.element = document.createElement("div");
    this.element.className = "wild-tab am-scroll";
    this.speciesOptions = new SpeciesOptions(() => state.session);

    this.frame = panel("wild-frame", 537, 433);
    this.type = combo("wild.type", w.areas, 144, 8, 97);
    this.save = button("wild.save", w.save, 256, 8, 81, 25, () => this.saveArea());
    const addType = button("wild.addType", w.addType, 256, 32, 81, 25, () => void this.openAddDialog());
    // ZigzaguMap 独自（#398）: 出現の割合のグラフ
    const chart = button("wild.chart", wt.chartButton, 344, 8, 81, 25, () => void this.openChart());
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
      const rate = autoId(label("", 248, y + 2, 120), `wild.slotRate.${i + 1}`);
      this.rows.push({ parts: [label(w.slot(i + 1), 8, y + 2), min, max, species, rate], min, max, species, rate });
    }
    this.frame.append(label(w.type, 8, 8), this.type, this.save, addType, chart, label(w.rate, 8, 32), this.rate, levelHead, speciesHead, ...this.areaParts, ...this.rows.flatMap((r) => r.parts));

    this.sorry = panel("wild-sorry", 537, 80);
    this.sorry.append(label(w.noWild, 8, 8), button("wild.create", w.create, 24, 24, 225, 41, () => void this.openAddDialog()));
    // 時間帯のタブ（Phase6 #436。ZigzaguMap 独自）: 朝・昼・夕・夜。表の無い時間帯は、実機と同じく昼の表を使うと案内する
    this.times = panel("wild-times", 537, 33);
    this.timeButtons = WILD_TIMES.map((time, i) => {
      const b = button(`wild.time.${time}`, tt.names[time] ?? String(time), 8 + i * 48, 4, 44, 25, () => this.setTime(time));
      b.classList.add("wild-time-tab");
      return b;
    });
    this.removeTime = button("wild.timeRemove", tt.remove, 216, 4, 161, 25, () => this.removeTable());
    this.times.append(...this.timeButtons, this.removeTime);
    this.missing = panel("wild-missing", 537, 80);
    this.missingText = autoId(label("", 8, 8, 520), "wild.timeInfo");
    this.copyDay = button("wild.timeCopy", tt.copyDay, 168, 32, 145, 33, () => this.copyFromDay());
    this.missing.append(this.missingText, button("wild.timeCreate", tt.createEmpty, 8, 32, 145, 33, () => void this.openAddDialog()), this.copyDay);
    this.element.append(this.times, this.missing, this.frame, this.sorry);

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
    state.on("session", () => {
      this.state.wildTime = WildTime.Day;
      refresh();
    });
    state.on("wildTime", refresh);
    state.on("tab", () => this.render());
    watchCommands(state, refresh);
  }

  /** 時間帯のタブを出すか（プロジェクトフォルダがあるときだけ。maps\ の Wild[].Time に書くため）。 */
  private get timesShown(): boolean {
    return !!this.state.session?.projectDir;
  }

  /** 見ている時間帯。 */
  get time(): number {
    return this.timesShown ? this.state.wildTime : WildTime.Day;
  }

  private get wild(): WildEncounters | null {
    const all = this.state.map?.doc.wild ?? [];
    return this.timesShown ? (wildOfTime(all, this.state.wildTime) ?? null) : shownWild(all);
  }

  /** 時間帯を切り替える（自動操作からも使う）。 */
  setTime(time: number): void {
    if (!WILD_TIMES.includes(time)) throw new Error(`時間帯は 0〜3 です: ${time}`);
    this.state.wildTime = time;
    this.stale = true;
    this.shownMap = "";
    this.render();
  }

  /** 時間帯のタブの見た目と、表の無い時間帯の案内を合わせる。表の無い昼以外の時間帯なら true。 */
  private renderTimes(): boolean {
    const map = this.state.map;
    const shown = !!map && this.timesShown;
    this.times.hidden = !shown;
    if (!shown) {
      this.missing.hidden = true;
      return false;
    }
    const all = map.doc.wild;
    WILD_TIMES.forEach((time, i) => {
      const b = this.timeButtons[i]!;
      const has = hasWildData(wildOfTime(all, time));
      b.classList.toggle("selected", time === this.state.wildTime);
      b.classList.toggle("has-table", has);
      b.title = tt.tabHint(tt.names[time] ?? "", has);
    });
    const exists = wildOfTime(all, this.state.wildTime) !== undefined;
    this.removeTime.hidden = this.state.wildTime === WildTime.Day || !exists;
    const lacking = this.state.wildTime !== WildTime.Day && !hasWildData(wildOfTime(all, this.state.wildTime));
    this.missing.hidden = !lacking;
    if (lacking) {
      this.missingText.textContent = tt.missing(tt.names[this.state.wildTime] ?? "");
      this.copyDay.disabled = !hasWildData(wildOfTime(all, WildTime.Day));
    }
    return lacking;
  }

  /** 昼の表を写して、見ている時間帯の表を作る。 */
  private copyFromDay(): void {
    const map = this.state.map;
    if (!map) return;
    const time = this.state.wildTime;
    if (commit(this.state, [new SetWildTableCommand({ bank: map.id.bank, map: map.id.map, time, from: WildTime.Day, remove: false })])) {
      this.state.setStatus(tt.copied(tt.names[time] ?? ""));
    }
  }

  /** 見ている時間帯の表を消す（昼の表は消さない）。 */
  private removeTable(): void {
    const map = this.state.map;
    const time = this.state.wildTime;
    if (!map || time === WildTime.Day) return;
    if (commit(this.state, [new SetWildTableCommand({ bank: map.id.bank, map: map.id.map, time, remove: true })])) {
      this.state.setStatus(tt.removed(tt.names[time] ?? ""));
    }
  }

  private get area(): WildArea | null {
    const a = this.wild?.areas[this.type.selectedIndex];
    return a && a.slots.length > 0 ? a : null;
  }

  private render(): void {
    if (this.state.tab === "wild" && this.state.session && this.namesSession !== this.state.session) {
      const session = this.state.session;
      this.namesSession = session;
      void session.openSpeciesNames().then(() => {
        if (this.state.session !== session) return;
        this.stale = true;
        this.render();
      });
    }
    if (!this.stale || this.state.tab !== "wild") return;
    this.stale = false;
    const map = this.state.map;
    const lacking = this.renderTimes();
    const hasData = !!this.wild?.areas.some((a) => a.slots.length > 0);
    this.frame.hidden = !map || !hasData;
    this.sorry.hidden = !map || hasData || lacking;
    if (!map || !hasData) {
      // AdvanceMap と同じく、データの無いマップではタイプを選んでいない状態にする
      this.type.selectedIndex = -1;
      this.shownMap = "";
      return;
    }
    const key = `${map.id.bank}.${map.id.map}:${this.time}`;
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
    const maxSpecies = Math.max(FR_SPECIES_COUNT - 1, (this.state.session?.speciesCount ?? 412) - 1, ...(area?.slots.map((s) => s.species) ?? []));
    const template = area ? this.speciesOptions.options(maxSpecies + 1) : null;
    this.rows.forEach((row, i) => {
      const slot = area?.slots[i];
      const visible = !!slot && i < count;
      for (const el of row.parts) el.hidden = !visible;
      if (!visible || !template) return;
      const kind = this.type.selectedIndex;
      row.rate.textContent = wt.slotRate(slotRate(kind, i), kind === WildAreaKind.Fishing ? rateGroup(kind, i) : null);
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

  /** 出現の割合のグラフ（#398。開いたときに読み込む）。表示中のタイプの、保存してある表で描く。 */
  private async openChart(): Promise<void> {
    const area = this.area;
    if (!area) return;
    const kind = this.type.selectedIndex;
    const provider = speciesNameProvider(this.state.session);
    const { openWildChart } = await import("./WildChartDialog");
    openWildChart({ kind, areaName: this.timesShown ? `${tt.names[this.time]} ${ja.wild.areas[kind] ?? ""}` : ja.wild.areas[kind] ?? "", area, speciesName: (s) => speciesLabel(provider, s) });
  }

  /** 「タイプの追加」「野生ポケモンの追加」のダイアログ（開いたときに読み込む）。 */
  private async openAddDialog(): Promise<void> {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const { openWildAddDialog } = await import("./WildAddDialog");
    const added = await openWildAddDialog(this.state, session, map.id, this.time);
    if (added !== null) {
      this.stale = true;
      this.type.selectedIndex = added;
      this.shownMap = `${map.id.bank}.${map.id.map}:${this.time}`;
      this.render();
    }
  }
}
