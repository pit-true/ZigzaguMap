import { LayoutSharing, type MapId } from "@zigzagumap/core";
import { jaLayoutShared as t } from "../../i18n/ja.layoutShared";
import "../../styles/layoutShared.css";
import type { HeaderContext } from "./HeaderContext";

/**
 * 「この配置は N 枚のマップで使われています」と、使っているマップの一覧（#228）。押すとそのマップを開く。
 * 1 枚だけ（共有していない、maps\ の JSON のマップ）なら隠す。数え方は core の LayoutSharing。
 * 描くたびに数え直す（ヘッダーの 4 バイトだけを読むので軽い。出力・新しいマップ・差し替えのあとも合う）。
 */
export class LayoutSharedNote {
  readonly element: HTMLElement;
  private readonly text: HTMLElement;
  private readonly list: HTMLElement;

  constructor(
    /** 部品の ID の頭（`easy` / `header`）。 */
    private readonly prefix: string,
    private readonly openMap: (id: MapId) => void,
    /** 見出しの枠に入れるか（かんたん表示）。 */
    framed: boolean,
  ) {
    this.element = document.createElement(framed ? "fieldset" : "div");
    this.element.className = framed ? "header-simple-section layout-shared" : "layout-shared layout-shared-classic";
    if (framed) {
      const legend = document.createElement("legend");
      legend.textContent = t.section;
      this.element.append(legend);
    }
    this.text = document.createElement("div");
    this.text.className = "layout-shared-text";
    this.text.dataset["autoId"] = `${prefix}.layoutShared`;
    const note = document.createElement("div");
    note.className = "layout-shared-note";
    note.textContent = t.note;
    this.list = document.createElement("ul");
    this.list.className = "layout-shared-list";
    this.list.dataset["autoId"] = `${prefix}.layoutShared.list`;
    this.element.append(this.text, note, this.list);
    this.element.hidden = true;
  }

  render(ctx: HeaderContext): void {
    const id = ctx.map.id;
    const maps = LayoutSharing.build(ctx.session.project).mapsSharing(id);
    this.element.hidden = maps.length < 2;
    this.list.replaceChildren();
    if (maps.length < 2) {
      this.text.textContent = "";
      return;
    }
    this.text.textContent = t.count(maps.length);
    for (const m of maps) {
      const li = document.createElement("li");
      const self = m.bank === id.bank && m.map === id.map;
      const label = t.mapItem(m.bank, m.map, ctx.session.catalog.get(m)?.name ?? null);
      if (self) {
        li.textContent = `${label}${t.current}`;
      } else {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "layout-shared-open";
        b.textContent = label;
        b.dataset["autoId"] = `${this.prefix}.layoutShared.map:${m.bank}.${m.map}`;
        b.addEventListener("click", () => this.openMap(m));
        li.append(b);
      }
      this.list.append(li);
    }
  }
}
