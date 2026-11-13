import type { WildArea } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { readOnlySelect, selectBox } from "./fields";

/** 種類ごとの枠の数（草むら 12、水上 5、岩砕き/木 5、釣り 10）。 */
const SLOT_COUNTS = [12, 5, 5, 10];

/** 野生ポケモンタブ（今回は表示のみ）。種類を選び、出現確率と各枠の Lv・種族番号を出す。 */
export class WildTab {
  readonly element: HTMLElement;
  private readonly type: HTMLSelectElement;
  private readonly body: HTMLElement;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("div");
    this.element.className = "wild-tab form-page";
    const head = document.createElement("label");
    head.className = "field-row";
    this.type = selectBox(ja.wildAreas);
    head.append(ja.wildType, this.type);
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = ja.readOnlyNote;
    this.body = document.createElement("div");
    this.element.append(head, this.body, note);
    this.type.addEventListener("change", () => this.render());
    state.on("map", () => this.render());
  }

  private render(): void {
    const wild = this.state.map?.doc.wild ?? [];
    // 時間帯は先頭（昼）だけを出す。
    const areas = wild[0]?.areas ?? [];
    if (!this.state.map || areas.every((a) => a.slots.length === 0)) {
      const p = document.createElement("p");
      p.textContent = this.state.map ? ja.noWild : "";
      this.body.replaceChildren(p);
      return;
    }
    const index = this.type.selectedIndex;
    const names = this.state.session?.speciesNames ?? null;
    this.body.replaceChildren(areaTable(areas[index], SLOT_COUNTS[index] ?? 12, (n) => names?.name(n) ?? null));
  }
}

/**
 * 1 種類分の表。種族は AdvanceMap と同じく種族名で出す（0 番は「選択してください」、名前が読めなければ番号）。
 */
function areaTable(area: WildArea | undefined, count: number, speciesName: (n: number) => string | null): HTMLElement {
  const box = document.createElement("div");
  box.className = "wild-table";
  if (!area || area.slots.length === 0) return box;
  const rate = document.createElement("label");
  rate.className = "field-row";
  const rateInput = readOnly(String(area.rate));
  const percent = document.createElement("span");
  percent.textContent = `${Math.round((area.rate / 255) * 100)}%`;
  rate.append(ja.wildRate, rateInput, percent);
  box.append(rate);
  const grid = document.createElement("div");
  grid.className = "wild-grid";
  const level = cell(ja.wildLevel);
  level.style.gridColumn = "span 2";
  grid.append(cell(""), level, cell(ja.wildSpecies));
  for (let i = 0; i < count; i++) {
    const s = area.slots[i];
    grid.append(cell(ja.wildSlot(i + 1)), readOnly(s ? String(s.minLevel) : ""), readOnly(s ? String(s.maxLevel) : ""), readOnlySelect(s ? speciesLabel(s.species, speciesName) : ""));
  }
  box.append(grid);
  return box;
}

function speciesLabel(species: number, name: (n: number) => string | null): string {
  if (species === 0) return ja.wildChooseSpecies;
  return name(species) ?? `No.${species}`;
}

function cell(text: string): HTMLElement {
  const span = document.createElement("span");
  span.style.whiteSpace = "nowrap";
  span.textContent = text;
  return span;
}

function readOnly(value: string): HTMLInputElement {
  const input = document.createElement("input");
  input.readOnly = true;
  input.value = value;
  return input;
}
