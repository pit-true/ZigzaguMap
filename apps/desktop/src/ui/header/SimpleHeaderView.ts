import {
  MAP_NAME_COUNT,
  MAP_NAME_FIRST_ID,
  ResizeMapCommand,
  SetBorderCommand,
  SetHeaderFieldsCommand,
  SetMapNameCommand,
  SetTilesetsCommand,
  type Command,
  type MapId,
} from "@zigzagumap/core";
import { FR_MUSIC } from "../../app/data/frMusic";
import { tilesetGroupOf } from "../../app/data/frTilesets";
import { hex, ja } from "../../i18n/ja";
import "../../styles/headerSimple.css";
import { commit } from "../form/commit";
import { selectIndex, setOptions } from "../form/controls";
import { checkOnInput, readInteger, tryInteger } from "../form/integerInput";
import type { HeaderContext } from "./HeaderContext";
import { LayoutSharedNote } from "./LayoutSharedNote";
import { MapScriptPanel } from "../script/MapScriptPanel";
import type { ScriptLink } from "../script/ScriptLink";

/** かんたん表示が App に頼むこと。 */
export interface SimpleHeaderHost {
  /** マップコネクションの窓を開く（ツール > マップコネクションと同じ）。 */
  openConnections(): void;
  /** マップを開く（配置を共有しているマップの一覧から。#228）。 */
  openMap(id: MapId): void;
  /** スクリプト連携（マップスクリプトのパネルが使う）。 */
  readonly scripts: ScriptLink;
}

/**
 * 場所の設定タブの「かんたん（CFRU）」表示。CFRU の開発で実際に変える項目だけを、分かりやすいラベルとまとまりで並べる。
 * - マップ名（地名・名前の書き換え・名前の表示）、音楽と見た目（音楽・天候・タイプ・戦闘背景・明るさ）、
 *   できること（自転車・走る・あなぬけ）、タイルセット、大きさ（マップ・境界ブロック）、マップスクリプト、マップコネクション
 * - ROM のアドレス（ヘッダー・フッターの位置やポインタ）は出さない（CFRU ではビルドが決めるため）。
 * 選ぶ・チェックする欄はすぐ反映し、数を入れる欄はボタンで反映する（どれも 1 回の操作として元に戻せる）。
 */
export class SimpleHeaderView {
  readonly element: HTMLElement;
  private ctx: HeaderContext | null = null;
  private readonly region: HTMLSelectElement;
  private readonly newName: HTMLInputElement;
  private readonly showName: HTMLInputElement;
  private readonly music: HTMLSelectElement;
  private readonly musicNo: HTMLInputElement;
  private readonly combos: readonly (readonly [string, HTMLSelectElement])[];
  private readonly flags: readonly (readonly [string, HTMLInputElement])[];
  private readonly tileset1: HTMLSelectElement;
  private readonly tileset2: HTMLSelectElement;
  private readonly width: HTMLInputElement;
  private readonly height: HTMLInputElement;
  private readonly borderWidth: HTMLInputElement;
  private readonly borderHeight: HTMLInputElement;
  /** マップスクリプトの専用パネル（#208。オフセットの欄は出さない）。 */
  private readonly scripts: MapScriptPanel;
  private readonly connections: HTMLElement;
  /** 配置を共有しているマップ（#228）。 */
  private readonly layoutShared: LayoutSharedNote;
  private regionTexts: string[] = [];

  constructor(host: SimpleHeaderHost) {
    const t = ja.headerSimple;
    this.element = document.createElement("div");
    this.element.className = "header-simple";
    this.scripts = new MapScriptPanel(host.scripts);

    // マップ名
    this.region = select("easy.region");
    this.newName = input("easy.newName", "text");
    const rename = button("easy.rename", t.rename, () => this.rename());
    this.showName = checkbox("easy.showName");
    this.region.addEventListener("change", () => {
      const i = this.region.selectedIndex;
      if (i >= 0) this.setHeader({ regionMapSectionId: MAP_NAME_FIRST_ID + i });
    });
    this.showName.addEventListener("change", () => this.setHeader({ showMapName: this.showName.checked ? 1 : 0 }));
    this.element.append(
      section(t.nameSection, [
        row(t.region, this.region),
        row(t.newName, inline(this.newName, rename), t.newNameNote),
        row("", labelled(this.showName, t.showName)),
      ]),
    );

    // 音楽と見た目
    this.music = select("easy.music");
    setOptions(this.music, ["", ...FR_MUSIC.map(([id, name]) => `${hex(id, 4)} ${name}`)]);
    this.musicNo = input("easy.musicNo", "text");
    this.musicNo.classList.add("header-simple-short");
    const weather = select("easy.weather", ja.weathers);
    const mapType = select("easy.mapType", ja.mapTypes);
    const battle = select("easy.battleType", ja.battleTypes);
    const cave = select("easy.cave", ja.caveTypes);
    this.combos = [
      ["weather", weather],
      ["mapType", mapType],
      ["battleType", battle],
      ["cave", cave],
    ];
    this.music.addEventListener("change", () => {
      const entry = FR_MUSIC[this.music.selectedIndex - 1];
      if (entry) this.setHeader({ music: entry[0] });
    });
    checkOnInput(this.musicNo, "hex", () => this.showMusicCombo());
    this.musicNo.addEventListener("change", () => {
      const value = tryInteger(this.musicNo.value, "hex");
      if (value !== null) this.setHeader({ music: value & 0xffff });
    });
    for (const [field, el] of this.combos) {
      el.addEventListener("change", () => {
        if (el.selectedIndex >= 0) this.setHeader({ [field]: el.selectedIndex });
      });
    }
    this.element.append(
      section(t.lookSection, [
        row(t.music, inline(this.music, document.createTextNode(t.musicNo), this.musicNo)),
        row(t.weather, weather),
        row(t.mapType, mapType),
        row(t.battle, battle),
        row(t.cave, cave),
      ]),
    );

    // できること
    const bike = checkbox("easy.bike");
    const run = checkbox("easy.run");
    const escape = checkbox("easy.escape");
    this.flags = [
      ["bikingAllowed", bike],
      ["allowRunning", run],
      ["allowEscaping", escape],
    ];
    for (const [field, el] of this.flags) el.addEventListener("change", () => this.setHeader({ [field]: el.checked ? 1 : 0 }));
    this.element.append(section(t.allowSection, [row("", labelled(bike, t.bike)), row("", labelled(run, t.run)), row("", labelled(escape, t.escape))]));

    // タイルセット
    this.tileset1 = select("easy.tileset1");
    this.tileset2 = select("easy.tileset2");
    const changeTilesets = button("easy.changeTilesets", t.changeTilesets, () => this.changeTilesets());
    this.element.append(section(t.tilesetSection, [row(t.tileset1, this.tileset1), row(t.tileset2, this.tileset2), row("", changeTilesets)]));

    // 大きさ
    this.width = input("easy.width", "text");
    this.height = input("easy.height", "text");
    this.borderWidth = input("easy.borderWidth", "text");
    this.borderHeight = input("easy.borderHeight", "text");
    for (const el of [this.width, this.height, this.borderWidth, this.borderHeight]) el.classList.add("header-simple-short");
    const resize = button("easy.resize", t.resize, () => this.resize());
    const resizeBorder = button("easy.resizeBorder", t.resizeBorder, () => this.resizeBorder());
    this.element.append(
      section(t.sizeSection, [
        row(t.mapSize, inline(this.width, document.createTextNode("×"), this.height, resize), t.mapSizeNote),
        row(t.borderSize, inline(this.borderWidth, document.createTextNode("×"), this.borderHeight, resizeBorder)),
      ]),
    );
    this.layoutShared = new LayoutSharedNote("easy", (id) => host.openMap(id), true);
    this.element.append(this.layoutShared.element);

    // マップスクリプト（専用のパネル。#208）
    this.element.append(section(t.scriptSection, [this.scripts.element]));

    // マップコネクション
    this.connections = document.createElement("ul");
    this.connections.className = "header-simple-connections";
    this.connections.dataset["autoId"] = "easy.connections";
    const openConnections = button("easy.openConnections", t.openConnections, () => host.openConnections());
    this.element.append(section(t.connectionSection, [this.connections, inline(openConnections)]));
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    this.layoutShared.render(ctx);
    const { doc, session } = ctx;
    const project = session.project;
    const header = doc.header;

    // マップ名
    const context = project.editorContext();
    this.regionTexts = Array.from({ length: MAP_NAME_COUNT }, (_, i) => {
      const raw = context.mapName(MAP_NAME_FIRST_ID + i);
      return raw ? project.textCodec.decode(raw) : "";
    });
    setOptions(this.region, this.regionTexts.map((name, i) => ja.headerSimple.regionItem(MAP_NAME_FIRST_ID + i, name)));
    const regionIndex = header.regionMapSectionId - MAP_NAME_FIRST_ID;
    selectIndex(this.region, regionIndex);
    const sameMap = this.newName.dataset["map"] === `${ctx.map.id.bank}.${ctx.map.id.map}:${header.regionMapSectionId}`;
    if (!sameMap) this.newName.value = this.regionTexts[regionIndex] ?? "";
    this.newName.dataset["map"] = `${ctx.map.id.bank}.${ctx.map.id.map}:${header.regionMapSectionId}`;
    this.showName.checked = header.flags >> 2 !== 0;

    // 音楽と見た目
    this.musicNo.value = hex(header.music, 4);
    this.showMusicCombo();
    for (const [field, el] of this.combos) selectIndex(el, (header as unknown as Record<string, number>)[field]!);

    // できること
    this.showFlag("bikingAllowed", header.bikingAllowed !== 0);
    this.showFlag("allowRunning", (header.flags & 0x02) !== 0);
    this.showFlag("allowEscaping", (header.flags & 0x01) !== 0);

    // タイルセット
    const table = project.tilesetTable;
    const options = Array.from({ length: table.count }, (_, n) => ja.headerSimple.tilesetItem(n, tilesetGroupOf(n, n)));
    for (const [el, pointer] of [
      [this.tileset1, doc.primaryTileset],
      [this.tileset2, doc.secondaryTileset],
    ] as const) {
      const n = table.indexOf(pointer);
      setOptions(el, n === null ? [...options, ja.headerSimple.tilesetOther(pointer >>> 0)] : options);
      selectIndex(el, n ?? options.length);
    }

    // 大きさ
    this.width.value = String(doc.width);
    this.height.value = String(doc.height);
    this.borderWidth.value = String(doc.border.width);
    this.borderHeight.value = String(doc.border.height);

    this.scripts.render(ctx);

    // マップコネクション（方向と相手のマップ）
    const list = doc.connections ?? [];
    const items = list.map((c) => {
      const li = document.createElement("li");
      const name = session.catalog.get({ bank: c.bank, map: c.map })?.name ?? ja.noName;
      li.textContent = ja.headerSimple.connectionItem(ja.conn.directions[c.direction] ?? String(c.direction), name, c.bank, c.map);
      return li;
    });
    if (items.length === 0) {
      const li = document.createElement("li");
      li.textContent = ja.headerSimple.noConnections;
      items.push(li);
    }
    this.connections.replaceChildren(...items);
  }

  private showFlag(field: string, on: boolean): void {
    const el = this.flags.find(([f]) => f === field)?.[1];
    if (el) el.checked = on;
  }

  /** 音楽の番号に合わせてコンボを選ぶ（一覧に無い番号なら空）。 */
  private showMusicCombo(): void {
    const value = parseInt(this.musicNo.value.replace(/^\$/, ""), 16);
    const i = FR_MUSIC.findIndex(([id]) => id === value);
    selectIndex(this.music, i < 0 ? -1 : i + 1);
  }

  private run(commands: readonly Command[]): void {
    if (commands.length > 0 && this.ctx) commit(this.ctx.state, commands);
  }

  private setHeader(fields: Record<string, number>): void {
    const c = this.ctx;
    if (!c) return;
    this.run([new SetHeaderFieldsCommand({ bank: c.map.id.bank, map: c.map.id.map, fields })]);
  }

  /** 名前の書き換え（このマップの地名の名前。同じ地名のマップすべてが変わる）。 */
  private rename(): void {
    const c = this.ctx;
    if (!c) return;
    const regionId = c.doc.header.regionMapSectionId;
    if (this.newName.value === (this.regionTexts[regionId - MAP_NAME_FIRST_ID] ?? null)) return;
    this.run([new SetMapNameCommand({ regionId, text: this.newName.value })]);
  }

  private changeTilesets(): void {
    const c = this.ctx;
    if (!c) return;
    const table = c.session.project.tilesetTable;
    const primary = table.pointerOf(this.tileset1.selectedIndex) ?? c.doc.primaryTileset >>> 0;
    const secondary = table.pointerOf(this.tileset2.selectedIndex) ?? c.doc.secondaryTileset >>> 0;
    if (primary === c.doc.primaryTileset >>> 0 && secondary === c.doc.secondaryTileset >>> 0) return;
    this.run([new SetTilesetsCommand({ bank: c.map.id.bank, map: c.map.id.map, primary, secondary })]);
  }

  /** マップの大きさ（左上を基準に伸び縮みする）。 */
  private resize(): void {
    const c = this.ctx;
    if (!c) return;
    const w = readInteger(this.width.value, "int");
    if (w === null) return;
    const h = readInteger(this.height.value, "int");
    if (h === null) return;
    if (w === c.doc.width && h === c.doc.height) return;
    this.run([new ResizeMapCommand({ bank: c.map.id.bank, map: c.map.id.map, width: w, height: h })]);
  }

  /** 境界ブロックの大きさ（左上を基準に伸び縮みし、足りないマスは 0）。 */
  private resizeBorder(): void {
    const c = this.ctx;
    if (!c) return;
    const w = readInteger(this.borderWidth.value, "int");
    if (w === null) return;
    const h = readInteger(this.borderHeight.value, "int");
    if (h === null) return;
    const border = c.doc.border;
    if (w === border.width && h === border.height) return;
    const cells: number[] = [];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) cells.push(x < border.width && y < border.height ? border.cells[y * border.width + x]! : 0);
    this.run([new SetBorderCommand({ bank: c.map.id.bank, map: c.map.id.map, width: w, height: h, cells })]);
  }
}

// ---- 並べ方（かんたん表示は座標ではなく、見出しと行で並べる） ----

function section(title: string, children: readonly Node[]): HTMLElement {
  const box = document.createElement("fieldset");
  box.className = "header-simple-section";
  const legend = document.createElement("legend");
  legend.textContent = title;
  box.append(legend, ...children);
  return box;
}

function row(label: string, control: Node, note?: string): HTMLElement {
  const div = document.createElement("div");
  div.className = "header-simple-row";
  const l = document.createElement("span");
  l.className = "header-simple-label";
  l.textContent = label;
  const body = document.createElement("div");
  body.className = "header-simple-control";
  body.append(control);
  if (note) {
    const n = document.createElement("div");
    n.className = "header-simple-note";
    n.textContent = note;
    body.append(n);
  }
  div.append(l, body);
  return div;
}

function inline(...nodes: Node[]): HTMLElement {
  const span = document.createElement("span");
  span.className = "header-simple-inline";
  span.append(...nodes);
  return span;
}

function labelled(check: HTMLInputElement, text: string): HTMLElement {
  const label = document.createElement("label");
  label.className = "header-simple-check";
  label.append(check, text);
  return label;
}

function select(id: string, options: readonly string[] = []): HTMLSelectElement {
  const el = document.createElement("select");
  el.dataset["autoId"] = id;
  setOptions(el, options);
  return el;
}

function input(id: string, type: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = type;
  el.spellcheck = false;
  el.dataset["autoId"] = id;
  return el;
}

function checkbox(id: string): HTMLInputElement {
  return input(id, "checkbox");
}

function button(id: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.dataset["autoId"] = id;
  b.addEventListener("click", onClick);
  return b;
}
