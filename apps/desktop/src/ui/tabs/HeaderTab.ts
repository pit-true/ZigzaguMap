import type { EditorState } from "../../app/EditorState";
import { hex, ja } from "../../i18n/ja";
import { fieldTable, groupBox, readOnlySelect } from "./fields";

/** 場所の設定タブ（今回は表示のみ。AdvanceMap の通常表示の並び）。 */
export class HeaderTab {
  readonly element: HTMLElement;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("div");
    this.element.className = "header-tab form-page";
    state.on("map", () => this.render());
  }

  private render(): void {
    const map = this.state.map;
    if (!map) {
      this.element.replaceChildren();
      return;
    }
    const doc = map.doc;
    const h = doc.header;
    const catalog = this.state.session?.catalog.get(map.id);
    const pick = (list: readonly string[], v: number): string => list[v] ?? ja.unknownChoice(v);

    const name = groupBox(
      ja.headerName,
      readOnlySelect(doc.mapNameText() ?? ja.noName),
      label(ja.headerShowName),
      readOnlySelect(pick(ja.nameDisplay, h.flags)),
    );
    const options = groupBox(
      ja.headerOptions,
      fieldTable([
        [ja.headerMusicNo, hex(h.music, 4)],
        [ja.headerCave, pick(ja.caveTypes, h.cave)],
        [ja.headerWeather, pick(ja.weathers, h.weather)],
        [ja.headerMapType, pick(ja.mapTypes, h.mapType)],
        [ja.headerBattle, pick(ja.battleTypes, h.battleType)],
      ]),
    );
    const scripts = groupBox(
      ja.headerScripts,
      fieldTable(
        (doc.mapScripts ?? []).map((s, i): [string, string] => [
          `${ja.headerScriptNo} ${i}`,
          `${hex(s.type, 2)} ${ja.mapScriptTypes[s.type] ?? "???"}  $${hex(s.pointer & 0x1ffffff, 6)}`,
        ]),
      ),
    );
    const tilesets = groupBox(
      ja.headerTilesets,
      fieldTable([
        [ja.headerTileset1, String(catalog?.primaryNumber ?? "?")],
        [ja.headerTileset2, String(catalog?.secondaryNumber ?? "?")],
      ]),
    );
    const size = groupBox(
      ja.headerSize,
      fieldTable([
        [ja.headerWidth, String(doc.width)],
        [ja.headerHeight, String(doc.height)],
      ]),
    );
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = ja.readOnlyNote;
    this.element.replaceChildren(name, options, scripts, tilesets, size, note);
  }
}

function label(text: string): HTMLElement {
  const span = document.createElement("div");
  span.className = "group-label";
  span.textContent = text;
  return span;
}
