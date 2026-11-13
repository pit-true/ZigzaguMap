import { MAP_NAME_COUNT, MAP_NAME_FIRST_ID, SetHeaderFieldsCommand, SetMapNameCommand } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { commit } from "../form/commit";
import { button, combo, edit, group, label, place, selectIndex, setOptions } from "../form/controls";
import { choices16, type HeaderContext } from "./HeaderContext";

/**
 * 「名前:」の枠（GroupBox1）。
 * - 名前のコンボは名前表（地名番号 0x58〜0xC4）の一覧。選ぶと右の欄に名前が入る（このマップの地名番号は変えない）。
 * - 「名前の変更を保存」は、コンボで選んでいる名前表の項目を書き換える（同じ地名番号の全マップの名前が変わる）。
 * - 「ワープ時の設定,タイプ」はヘッダーの 0x19 のバイト。選ぶとすぐ反映する。
 * - 「新しい名前の作成」は AdvanceMap と同じく無効のまま。
 */
export class NameGroup {
  readonly element: HTMLElement;
  private readonly names: HTMLSelectElement;
  private readonly newName: HTMLInputElement;
  private readonly display: HTMLSelectElement;
  private ctx: HeaderContext | null = null;
  private texts: string[] = [];

  constructor() {
    const h = ja.header;
    this.element = group(h.name, 8, 8, 465, 161);
    this.names = combo("header.name", [], 16, 24, 201);
    this.newName = edit("header.newName", 248, 24, 201);
    const save = button("header.saveName", h.saveName, 248, 56, 201, 33, () => this.saveName());
    this.display = combo("header.showName", choices16(ja.nameDisplay), 16, 70, 201);
    const count = edit("header.newNameCount", 24, 120, 201);
    count.value = "5";
    count.disabled = true;
    const create = button("header.createNames", h.createNames, 248, 112, 201, 33, () => undefined);
    create.disabled = true;
    const countLabel = label(h.newNameCount, 16, 104);
    countLabel.classList.add("am-disabled-label");
    this.element.append(
      this.names,
      this.newName,
      save,
      label(h.showName, 16, 56),
      this.display,
      countLabel,
      count,
      create,
      bevel(233, 10, 2, 79),
      bevel(8, 97, 449, 2),
    );
    this.names.addEventListener("change", () => {
      this.newName.value = this.texts[this.names.selectedIndex] ?? "";
    });
    this.display.addEventListener("change", () => {
      const c = this.ctx;
      if (!c || this.display.selectedIndex < 0) return;
      commit(c.state, [new SetHeaderFieldsCommand({ ...idOf(c), fields: { flags: this.display.selectedIndex } })]);
    });
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const project = ctx.session.project;
    const context = project.editorContext();
    const keep = this.names.selectedIndex;
    const sameMap = this.names.dataset["map"] === `${ctx.map.id.bank}.${ctx.map.id.map}`;
    this.texts = Array.from({ length: MAP_NAME_COUNT }, (_, i) => {
      const raw = context.mapName(MAP_NAME_FIRST_ID + i);
      return raw ? project.textCodec.decode(raw) : "";
    });
    setOptions(this.names, this.texts.map((t) => ja.header.nameItem(t)));
    // 同じマップのまま読み直すときは、選んでいた名前表の項目を保つ。
    const index = sameMap && keep >= 0 ? keep : ctx.doc.header.regionMapSectionId - MAP_NAME_FIRST_ID;
    selectIndex(this.names, index);
    if (!sameMap) this.newName.value = this.texts[this.names.selectedIndex] ?? "";
    this.names.dataset["map"] = `${ctx.map.id.bank}.${ctx.map.id.map}`;
    selectIndex(this.display, ctx.doc.header.flags);
  }

  private saveName(): void {
    const c = this.ctx;
    const i = this.names.selectedIndex;
    if (!c || i < 0) return;
    commit(c.state, [new SetMapNameCommand({ regionId: MAP_NAME_FIRST_ID + i, text: this.newName.value })]);
  }
}

/** 仕切り線（TBevel）。 */
function bevel(x: number, y: number, width: number, height: number): HTMLElement {
  const div = place(document.createElement("div"), x, y, width, height);
  div.className += " am-bevel";
  return div;
}

function idOf(c: HeaderContext): { bank: number; map: number } {
  return { bank: c.map.id.bank, map: c.map.id.map };
}
