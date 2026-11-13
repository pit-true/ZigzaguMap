import { EditError, EditErrorCode, ResizeMapCommand, SetTilesetsCommand } from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { commit } from "../form/commit";
import { button, edit, group, label } from "../form/controls";
import { readInt, showEditError } from "../form/inputErrors";
import type { HeaderContext } from "./HeaderContext";

/** タイルセットの番号（AdvanceMap のタイルセット番号。表に無いポインタなら空）。 */
export function tilesetNumber(ctx: HeaderContext, pointer: number): string {
  const n = ctx.session.project.tilesetTable.indexOf(pointer);
  return n === null ? "" : String(n);
}

/**
 * 「使用するタイルセット:」の枠（GroupBox3）。番号を入れて「タイルセットの変更」で、確認なしで差し替えて描き直す。
 * 表に無い番号（-1、9999 など）は AdvanceMap と同じ「AdvanceMapError(1): Try to read at pos 0!…」にする
 * （AdvanceMap は 9999 を受け付けて崩れた絵を出すが、ZigzaguMap は指せるタイルセットが無いのでエラーにする）。
 */
export class TilesetGroup {
  readonly element: HTMLElement;
  private readonly first: HTMLInputElement;
  private readonly second: HTMLInputElement;
  private ctx: HeaderContext | null = null;

  constructor() {
    const h = ja.header;
    this.element = group(h.tilesets, 8, 512, 225, 121);
    this.first = edit("header.tileset1", 16, 36, 73);
    this.second = edit("header.tileset2", 136, 36, 73);
    this.element.append(
      label(h.tileset1, 16, 20),
      this.first,
      label(h.tileset2, 136, 20),
      this.second,
      button("header.changeTilesets", h.changeTilesets, 16, 72, 193, 33, () => this.apply()),
    );
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    this.first.value = tilesetNumber(ctx, ctx.doc.primaryTileset);
    this.second.value = tilesetNumber(ctx, ctx.doc.secondaryTileset);
  }

  private apply(): void {
    const c = this.ctx;
    if (!c) return;
    const a = readInt(this.first.value);
    if (a === null) return;
    const b = readInt(this.second.value);
    if (b === null) return;
    const table = c.session.project.tilesetTable;
    const primary = table.pointerOf(a);
    const secondary = table.pointerOf(b);
    if (primary === null || secondary === null) {
      void showEditError(new EditError(EditErrorCode.InvalidTileset, { pointer: primary === null ? a : b }));
      return;
    }
    if (primary === c.doc.primaryTileset >>> 0 && secondary === c.doc.secondaryTileset >>> 0) return;
    commit(c.state, [new SetTilesetsCommand({ bank: c.map.id.bank, map: c.map.id.map, primary, secondary })]);
  }
}

/**
 * 「マップの大きさ:」の枠（GroupBox4）。横幅・高さを入れて「マップサイズの変更」で、左上を基準に伸縮する。
 * 0 と空欄は無視して元の値に戻す（AdvanceMap と同じ）。上限を超えると「The max map height at a map width of …」。
 */
export class SizeGroup {
  readonly element: HTMLElement;
  private readonly width: HTMLInputElement;
  private readonly height: HTMLInputElement;
  private ctx: HeaderContext | null = null;

  constructor() {
    const h = ja.header;
    this.element = group(h.size, 248, 512, 225, 121);
    this.width = edit("header.width", 16, 36, 73);
    this.height = edit("header.height", 136, 36, 73);
    this.element.append(
      label(h.width, 16, 20),
      this.width,
      label(h.height, 136, 20),
      this.height,
      button("header.resize", h.resize, 16, 72, 193, 33, () => this.apply()),
    );
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    this.width.value = String(ctx.doc.width);
    this.height.value = String(ctx.doc.height);
  }

  private apply(): void {
    const c = this.ctx;
    if (!c) return;
    if (this.width.value.trim() === "" || this.height.value.trim() === "") return this.render(c);
    const w = readInt(this.width.value);
    if (w === null) return;
    const h = readInt(this.height.value);
    if (h === null) return;
    if (w === 0 || h === 0) return this.render(c);
    if (w === c.doc.width && h === c.doc.height) return;
    commit(c.state, [new ResizeMapCommand({ bank: c.map.id.bank, map: c.map.id.map, width: w, height: h })]);
  }
}
