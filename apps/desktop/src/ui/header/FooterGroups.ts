import {
  BLOCK_ID_MASK,
  MAP_FOOTER,
  RomLocations,
  SetBorderCommand,
  SetRawFooterCommand,
  renderBlocks,
  toHexBytes,
  toOffset,
  type Command,
} from "@zigzagumap/core";
import { ja } from "../../i18n/ja";
import { drawRgba } from "../canvas";
import { commit } from "../form/commit";
import { autoId, button, edit, group, label, memo, place } from "../form/controls";
import { offsetText } from "../form/inputErrors";
import { checkOnInput, followInput } from "../form/integerInput";
import type { HeaderContext } from "./HeaderContext";
import { tilesetNumber } from "./LayoutGroups";
import { locationText, readOnlyEdit } from "./ProHeaderGroups";

/** 16 進の文字列をバイト列にする（偶数桁の 16 進でなければ null）。 */
function hexToBytes(text: string): Uint8Array | null {
  const hex = text.replace(/\s+/g, "");
  if (!/^(?:[0-9A-Fa-f]{2})*$/.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function u32(b: Uint8Array, at: number): number {
  return (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0;
}

function setU32(b: Uint8Array, at: number, v: number): void {
  for (let i = 0; i < 4; i++) b[at + i] = (v >>> (i * 8)) & 0xff;
}

/**
 * 「マップデータ:」の枠（GroupBox8）と「境界ブロック」の枠（GroupBox9）。
 * フッター 28 バイトの 16 進と、横幅・高さ・タイルセット番号・境界ブロックの大きさの欄が連動する（AdvanceMap と同じ）。
 * タイルセット番号を変えるとタイルセットのオフセット（読み取り専用）も変わる。境界の欄を変えると画像がすぐ変わる。
 * 「保存してマップの再読み込み」で、フッターと境界をまとめて反映する（境界と配置のポインタは表示だけ）。
 */
export class FooterGroups {
  readonly element: HTMLElement;
  readonly borderElement: HTMLElement;
  private readonly footer = memo("pro.footer", 128, 24, 321, 41);
  private readonly width = edit("pro.width", 128, 80, 89);
  private readonly height = edit("pro.height", 360, 80, 89);
  private readonly borderOffset = readOnlyEdit("pro.borderOffset", 128, 112, 89);
  private readonly blocksOffset = readOnlyEdit("pro.blocksOffset", 360, 112, 89);
  private readonly tileset1No = edit("pro.tileset1No", 128, 144, 89);
  private readonly tileset2No = edit("pro.tileset2No", 360, 144, 89);
  private readonly tileset1Offset = readOnlyEdit("pro.tileset1Offset", 128, 176, 89);
  private readonly tileset2Offset = readOnlyEdit("pro.tileset2Offset", 360, 176, 89);
  private readonly borderWidth = edit("pro.borderWidth", 128, 208, 89);
  private readonly borderHeight = edit("pro.borderHeight", 360, 208, 89);
  private readonly border = edit("pro.border", 248, 28, 201);
  private readonly canvas: HTMLCanvasElement;
  private readonly save: HTMLButtonElement;
  /** 欄の下書き（フッター 28 バイト）。 */
  private bytes: Uint8Array = new Uint8Array(28);
  private borderShown = "";
  private ctx: HeaderContext | null = null;

  constructor() {
    const h = ja.header;
    this.element = group(h.dataGroup, 8, 328, 465, 281);
    this.save = button("pro.saveFooter", h.saveReload, 128, 240, 209, 25, () => this.apply());
    this.save.disabled = true;
    this.element.append(
      label(h.rawFooter, 16, 40),
      this.footer,
      label(h.proWidth, 16, 84),
      this.width,
      label(h.proHeight, 248, 84),
      this.height,
      label(h.borderOffset, 16, 116),
      this.borderOffset,
      label(h.blocksOffset, 248, 116),
      this.blocksOffset,
      label(h.tileset1No, 16, 148),
      this.tileset1No,
      label(h.tileset2No, 248, 148),
      this.tileset2No,
      label(h.tileset1Offset, 16, 180),
      this.tileset1Offset,
      label(h.tileset2Offset, 248, 180),
      this.tileset2Offset,
      label(h.borderWidth, 16, 212),
      this.borderWidth,
      label(h.borderHeight, 248, 212),
      this.borderHeight,
      this.save,
    );
    this.borderElement = group(h.borderGroup, 8, 616, 465, 73);
    this.canvas = autoId(place(document.createElement("canvas"), 128, 25, 32, 32), "pro.borderImage");
    this.canvas.classList.add("am-border-image");
    this.borderElement.append(label(h.border, 16, 28), this.canvas, this.border);

    this.footer.addEventListener("input", () => {
      const b = hexToBytes(this.footer.value);
      if (b && b.length === 28) {
        this.bytes = b;
        this.showFields(false);
      }
      this.dirty();
    });
    // AdvanceMap と同じく入力のたびに読み、フッターの 16 進へ連動する。横幅・高さ・タイルセット番号は読めなければエラー、
    // 境界ブロックの横幅・高さはエラーを出さない（AdvanceMap で確かめた動作）。
    const field = (input: HTMLInputElement, write: (n: number) => void, check = true): void => {
      const apply = (n: number): void => {
        write(n);
        this.showFields(true);
        this.dirty();
      };
      if (check) checkOnInput(input, "int", apply);
      else followInput(input, "int", apply);
    };
    field(this.width, (n) => setU32(this.bytes, MAP_FOOTER.width, n));
    field(this.height, (n) => setU32(this.bytes, MAP_FOOTER.height, n));
    field(this.borderWidth, (n) => (this.bytes[MAP_FOOTER.borderWidth] = n & 0xff), false);
    field(this.borderHeight, (n) => (this.bytes[MAP_FOOTER.borderHeight] = n & 0xff), false);
    field(this.tileset1No, (n) => this.setTileset(MAP_FOOTER.primaryTileset, n));
    field(this.tileset2No, (n) => this.setTileset(MAP_FOOTER.secondaryTileset, n));
    this.border.addEventListener("input", () => {
      this.drawBorder();
      this.dirty();
    });
  }

  render(ctx: HeaderContext): void {
    this.ctx = ctx;
    const locations = new RomLocations(ctx.session.project);
    this.bytes = locations.rawBytes(ctx.doc).footer.slice();
    this.showFields(true);
    const cells = ctx.doc.border.cells;
    const raw = new Uint8Array(cells.length * 2);
    cells.forEach((v, i) => {
      raw[i * 2] = v & 0xff;
      raw[i * 2 + 1] = v >> 8;
    });
    this.borderShown = toHexBytes(raw);
    this.border.value = this.borderShown;
    this.drawBorder();
    this.save.disabled = true;
  }

  private setTileset(field: number, n: number): void {
    const c = this.ctx;
    const pointer = c?.session.project.tilesetTable.pointerOf(n);
    if (pointer !== null && pointer !== undefined) setU32(this.bytes, field, pointer);
  }

  /** 下書きのバイト列を欄に出す（`withMemo` なら 16 進の欄も）。 */
  private showFields(withMemo: boolean): void {
    const b = this.bytes;
    const c = this.ctx;
    if (withMemo) this.footer.value = toHexBytes(b);
    const set = (input: HTMLInputElement, text: string): void => {
      if (document.activeElement !== input) input.value = text;
    };
    set(this.width, String(u32(b, MAP_FOOTER.width)));
    set(this.height, String(u32(b, MAP_FOOTER.height)));
    this.borderOffset.value = locationText(toOffset(u32(b, MAP_FOOTER.border)));
    this.blocksOffset.value = locationText(toOffset(u32(b, MAP_FOOTER.blocks)));
    const p1 = u32(b, MAP_FOOTER.primaryTileset);
    const p2 = u32(b, MAP_FOOTER.secondaryTileset);
    if (c) {
      set(this.tileset1No, tilesetNumber(c, p1));
      set(this.tileset2No, tilesetNumber(c, p2));
    }
    this.tileset1Offset.value = offsetText(toOffset(p1) ?? 0);
    this.tileset2Offset.value = offsetText(toOffset(p2) ?? 0);
    set(this.borderWidth, String(b[MAP_FOOTER.borderWidth]));
    set(this.borderHeight, String(b[MAP_FOOTER.borderHeight]));
  }

  private dirty(): void {
    this.save.disabled = false;
  }

  /** 境界の欄の値（u16 の並び）。読めなければ null。 */
  private borderCells(): number[] | null {
    const b = hexToBytes(this.border.value);
    if (!b || b.length % 2 !== 0) return null;
    const out: number[] = [];
    for (let i = 0; i < b.length; i += 2) out.push(b[i]! | (b[i + 1]! << 8));
    return out;
  }

  /** 境界ブロックの画像（境界の欄の値で描く。大きさはフッターの欄の値）。 */
  private drawBorder(): void {
    const c = this.ctx;
    if (!c) return;
    const w = this.bytes[MAP_FOOTER.borderWidth]! || 1;
    const h = this.bytes[MAP_FOOTER.borderHeight]! || 1;
    const cells = this.borderCells() ?? [];
    const image = renderBlocks(c.map.tiles.renderer, w, h, (x, y) => {
      const cell = cells[y * w + x];
      return cell === undefined ? null : cell & BLOCK_ID_MASK;
    });
    drawRgba(this.canvas, image);
  }

  private apply(): void {
    const c = this.ctx;
    if (!c) return;
    const id = { bank: c.map.id.bank, map: c.map.id.map };
    const commands: Command[] = [];
    const locations = new RomLocations(c.session.project);
    if (this.footer.value !== toHexBytes(locations.rawBytes(c.doc).footer)) commands.push(new SetRawFooterCommand({ ...id, footer: this.footer.value }));
    if (this.border.value !== this.borderShown) {
      const cells = this.borderCells() ?? [];
      commands.push(new SetBorderCommand({ ...id, width: this.bytes[MAP_FOOTER.borderWidth]!, height: this.bytes[MAP_FOOTER.borderHeight]!, cells }));
    }
    if (commit(c.state, commands)) this.save.disabled = true;
  }
}
