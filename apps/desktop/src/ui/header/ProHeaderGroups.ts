import { RomLocations, SetRawHeaderCommand, SetTilesetHeaderCommand, toHexBytes, type Command } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { commit } from "../form/commit";
import { button, edit, group, label, memo } from "../form/controls";
import { offsetText } from "../form/inputErrors";
import type { HeaderContext } from "./HeaderContext";

/** 読み取り専用の欄。 */
export function readOnlyEdit(id: string, x: number, y: number, width: number): HTMLInputElement {
  const input = edit(id, x, y, width);
  input.readOnly = true;
  return input;
}

/** ROM 上の位置の表記（ROM に無ければ AdvanceMap の未設定と同じ `$000000`）。 */
export function locationText(offset: number | null): string {
  return offsetText(offset ?? 0);
}

/** 「マップヘッダーの設定:」の枠（GroupBox6）。すべて読み取り専用。 */
export class BankGroup {
  readonly element: HTMLElement;
  private readonly bankHeader = readOnlyEdit("pro.bankHeader", 128, 24, 89);
  private readonly bankNo = readOnlyEdit("pro.bankNo", 128, 56, 89);
  private readonly mapNo = readOnlyEdit("pro.mapNo", 128, 88, 89);
  private readonly bankOffset = readOnlyEdit("pro.bankOffset", 360, 56, 89);
  private readonly headerOffset = readOnlyEdit("pro.headerOffset", 360, 88, 89);

  constructor() {
    const h = ja.header;
    this.element = group(h.bankHeaderGroup, 8, 8, 465, 129);
    this.element.append(
      label(h.bankHeader, 16, 28),
      this.bankHeader,
      label(h.bankNo, 16, 60),
      this.bankNo,
      label(h.mapNo, 16, 92),
      this.mapNo,
      label(h.bankOffset, 248, 60),
      this.bankOffset,
      label(h.headerOffset, 248, 92),
      this.headerOffset,
    );
  }

  render(ctx: HeaderContext): void {
    const loc = new RomLocations(ctx.session.project).locations(ctx.map.id);
    this.bankHeader.value = locationText(loc.bankTable);
    this.bankNo.value = String(ctx.map.id.bank);
    this.mapNo.value = String(ctx.map.id.map);
    this.bankOffset.value = locationText(loc.bankList);
    this.headerOffset.value = locationText(loc.header);
  }
}

/**
 * 「マップの設定:」の枠（GroupBox7）。マップヘッダー 28 バイトの 16 進と、各データの位置。
 * ヘッダーの欄を書き換えると「保存してマップの再読み込み」が押せるようになり、押すと 0x10 以降の設定を反映する
 * （0x00〜0x0F のポインタは出力時に作り直すので読み捨てる。位置の欄は表示だけ）。
 */
export class MapSettingsGroup {
  readonly element: HTMLElement;
  private readonly header = memo("pro.header", 128, 24, 321, 41);
  private readonly mapOffset = readOnlyEdit("pro.mapOffset", 128, 72, 89);
  private readonly eventOffset = readOnlyEdit("pro.eventOffset", 360, 72, 89);
  private readonly scriptsOffset = readOnlyEdit("pro.scriptsOffset", 128, 104, 89);
  private readonly connectionOffset = readOnlyEdit("pro.connectionOffset", 360, 104, 89);
  private readonly save: HTMLButtonElement;
  private ctx: HeaderContext | null = null;

  constructor() {
    const h = ja.header;
    this.element = group(h.mapGroup, 8, 144, 465, 177);
    this.save = button("pro.saveHeader", h.saveReload, 128, 136, 209, 25, () => this.apply());
    this.save.disabled = true;
    this.header.addEventListener("input", () => (this.save.disabled = false));
    this.element.append(
      label(h.rawHeader, 16, 40),
      this.header,
      label(h.mapOffset, 16, 76),
      this.mapOffset,
      label(h.eventOffset, 248, 76),
      this.eventOffset,
      label(h.scriptsOffset, 16, 108),
      this.scriptsOffset,
      label(h.connectionOffset, 248, 108),
      this.connectionOffset,
      this.save,
    );
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const locations = new RomLocations(ctx.session.project);
    const loc = locations.locations(ctx.map.id);
    this.header.value = toHexBytes(locations.rawBytes(ctx.doc).header);
    this.mapOffset.value = locationText(loc.layout);
    this.eventOffset.value = locationText(loc.events);
    this.scriptsOffset.value = locationText(loc.scripts);
    this.connectionOffset.value = locationText(loc.connections);
    this.save.disabled = true;
  }

  private apply(): void {
    const c = this.ctx;
    if (!c) return;
    if (commit(c.state, [new SetRawHeaderCommand({ bank: c.map.id.bank, map: c.map.id.map, header: this.header.value })])) this.save.disabled = true;
  }
}

/**
 * 「タイルセットデータ:」の枠（GroupBox10）。主・副タイルセットのヘッダー 24 バイトの 16 進。
 * 保存すると圧縮フラグ・副フラグ・アニメーション関数などを反映する（画像などのポインタは読み捨てる）。
 */
export class TilesetDataGroup {
  readonly element: HTMLElement;
  private readonly first = memo("pro.tilesetData1", 128, 24, 321, 41);
  private readonly second = memo("pro.tilesetData2", 128, 72, 321, 41);
  private readonly save: HTMLButtonElement;
  private shown: [string, string] = ["", ""];
  private ctx: HeaderContext | null = null;

  constructor() {
    const h = ja.header;
    this.element = group(h.tilesetGroup, 8, 696, 465, 169);
    this.save = button("pro.saveTilesets", h.saveReload, 128, 128, 209, 25, () => this.apply());
    this.save.disabled = true;
    for (const m of [this.first, this.second]) m.addEventListener("input", () => (this.save.disabled = false));
    this.element.append(label(h.tilesetData1, 16, 40), this.first, label(h.tilesetData2, 16, 88), this.second, this.save);
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const locations = new RomLocations(ctx.session.project);
    const context = ctx.session.project.editorContext();
    const text = (pointer: number, secondary: boolean): string => {
      try {
        return toHexBytes(locations.tilesetHeader(context.tileset({ pointer, secondary })));
      } catch {
        return "";
      }
    };
    this.shown = [text(ctx.doc.primaryTileset, false), text(ctx.doc.secondaryTileset, true)];
    this.first.value = this.shown[0];
    this.second.value = this.shown[1];
    this.save.disabled = true;
  }

  private apply(): void {
    const c = this.ctx;
    if (!c) return;
    const commands: Command[] = [];
    if (this.first.value !== this.shown[0]) {
      commands.push(new SetTilesetHeaderCommand({ tileset: c.doc.primaryTileset >>> 0, secondary: false, header: this.first.value }));
    }
    if (this.second.value !== this.shown[1]) {
      commands.push(new SetTilesetHeaderCommand({ tileset: c.doc.secondaryTileset >>> 0, secondary: true, header: this.second.value }));
    }
    if (commit(c.state, commands)) this.save.disabled = true;
  }
}
