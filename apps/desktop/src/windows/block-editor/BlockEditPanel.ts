import { TOTAL_PALETTE_COUNT } from "@zigzagumap/core";
import { hexText, jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { autoId, button, check, combo, label, place } from "../../ui/form/controls";
import type { TilesetModel } from "../TilesetModel";
import { pixelCanvas, pointIn, putRgba } from "./pixelCanvas";
import type { TileSheetView } from "./TileSheetView";

/** ブロックの編集面が使う窓口。 */
export interface BlockEditPanelHost {
  /** マス `cell` を左クリック（置く）。0〜7 は 8 マス、8〜11 は 3 層目の 4 マス。 */
  place(cell: number): void;
  /** マス `cell` を右クリック（拾う）。 */
  pick(cell: number): void;
  /** 左右逆・上下逆を変えた。 */
  flipChanged(): void;
  /** パレットを選んだ。 */
  paletteChanged(palette: number): void;
  /** 変更を保存。 */
  save(): void;
}

/** 選んでいるタイルとブロックの表示（Tile / Block / Offset 欄と 8 マス）。 */
export interface BlockEditView {
  readonly tile: number | null;
  readonly block: number | null;
  readonly offset: number | null;
  /** 8 マスのタイル指定（ブロックを選んでいなければ null）。 */
  readonly tiles: readonly number[] | null;
  /** 3 層目の 4 マス（次のブロックの下層）と、その番号。3 層でなければ null。 */
  readonly third: { readonly block: number; readonly tiles: readonly number[] } | null;
  readonly palette: number;
}

/** 3 層目の 4 マスと見出しの位置（パレットの欄の下。出すときはタイル一覧を下へずらす）。 */
const THIRD_Y = 90;
/** タイル一覧の位置と高さ（3 層目を出していないとき）。 */
const SHEET_Y = 88;
const SHEET_HEIGHT = 137;
/** 3 層目を出しているときのタイル一覧の位置。 */
const SHEET_Y_TRIPLE = 126;

/**
 * 中央の「ブロックの編集面」（AdvanceMap の ScrollBox_HauptTeil）。
 * 下層/上層の 8 マス（BlockBox、各タイル 16px）、Tile のプレビュー、Tile / Block / Offset 欄、左右逆・上下逆、
 * パレット（Palette0〜12）、変更を保存、その下にタイル一覧を置く。
 * 3 層のブロックのときだけ、パレットの欄の下に 3 層目の 4 マス（次のブロックの下層）と見出しを出し、タイル一覧を下へずらす
 * （AdvanceMap の配置では 8 マスの右に 4 マスを置く隙間が無いため）。
 */
export class BlockEditPanel {
  readonly element: HTMLElement;
  readonly blockBox: HTMLCanvasElement;
  readonly tilePreview: HTMLCanvasElement;
  readonly xflip: HTMLInputElement;
  readonly yflip: HTMLInputElement;
  readonly palette: HTMLSelectElement;
  /** 3 層目の 4 マス（16×16、表示は 2 倍）。 */
  readonly thirdBox: HTMLCanvasElement;
  readonly thirdLabel: HTMLElement;
  private readonly sheet: TileSheetView;
  private readonly tileLabel: HTMLElement;
  private readonly blockLabel: HTMLElement;
  private readonly offsetLabel: HTMLElement;

  constructor(host: BlockEditPanelHost, sheet: TileSheetView) {
    this.sheet = sheet;
    this.element = place(document.createElement("div"), 273, 0, 288, 233);
    this.element.className += " be-scroll be-main";
    this.blockBox = place(pixelCanvas("be.block", 32, 16, 2), 8, 24);
    this.tilePreview = place(pixelCanvas("be.tile", 8, 8, 2), 152, 8);
    this.thirdBox = place(pixelCanvas("be.third", 16, 16, 2), 8, THIRD_Y);
    this.thirdLabel = autoId(label("", 48, THIRD_Y + 10), "be.thirdLabel");
    this.thirdLabel.classList.add("be-third-label");
    this.tileLabel = autoId(label("", 128, 8), "be.tileLabel");
    this.blockLabel = autoId(label("", 128, 32), "be.blockLabel");
    this.offsetLabel = autoId(label("", 128, 56), "be.offsetLabel");
    const x = check("be.xflip", t.xflip, 184, 8, 49);
    const y = check("be.yflip", t.yflip, 184, 24, 49);
    this.xflip = x.input;
    this.yflip = y.input;
    this.palette = combo(
      "be.palette",
      Array.from({ length: TOTAL_PALETTE_COUNT }, (_, i) => t.paletteName(i)),
      8,
      64,
      73,
    );
    this.element.append(
      label(t.lowerUpper, 8, 8),
      this.blockBox,
      this.palette,
      label(t.tile, 96, 8),
      label(t.block, 96, 32),
      label(t.offset, 96, 56),
      this.tileLabel,
      this.blockLabel,
      this.offsetLabel,
      this.tilePreview,
      x.root,
      y.root,
      button("be.save", t.save, 200, 48, 81, 33, () => host.save()),
      this.thirdBox,
      this.thirdLabel,
      sheet.element,
    );
    this.showThird(false);

    this.blockBox.addEventListener("pointerdown", (e) => {
      const p = pointIn(this.blockBox, e);
      if (p.x < 0 || p.y < 0 || p.x >= 64 || p.y >= 32) return;
      const cell = (p.x >= 32 ? 4 : 0) + (p.y >= 16 ? 2 : 0) + ((p.x % 32) >= 16 ? 1 : 0);
      if (e.button === 0) host.place(cell);
      else if (e.button === 2) host.pick(cell);
    });
    this.thirdBox.addEventListener("pointerdown", (e) => {
      const p = pointIn(this.thirdBox, e);
      if (p.x < 0 || p.y < 0 || p.x >= 32 || p.y >= 32) return;
      const cell = 8 + (p.y >= 16 ? 2 : 0) + (p.x >= 16 ? 1 : 0);
      if (e.button === 0) host.place(cell);
      else if (e.button === 2) host.pick(cell);
    });
    this.xflip.addEventListener("change", () => host.flipChanged());
    this.yflip.addEventListener("change", () => host.flipChanged());
    this.palette.addEventListener("change", () => host.paletteChanged(this.palette.selectedIndex));
  }

  /** 欄と 8 マス・プレビューを描き直す。 */
  render(model: TilesetModel, view: BlockEditView): void {
    this.tileLabel.textContent = view.tile === null ? "" : hexText(view.tile, 3);
    this.blockLabel.textContent = view.block === null ? "" : hexText(view.block, 3);
    this.offsetLabel.textContent = view.offset === null ? "" : hexText(view.offset, 6);
    if (this.palette.selectedIndex !== view.palette) this.palette.selectedIndex = view.palette;

    const box = new Uint8ClampedArray(32 * 16 * 4);
    for (let i = 3; i < box.length; i += 4) box[i] = 255;
    if (view.tiles) {
      for (let cell = 0; cell < 8; cell++) {
        const x = (cell >= 4 ? 16 : 0) + (cell & 1) * 8;
        const y = (cell & 2) * 4;
        model.drawTileRef(box, 32, view.tiles[cell] ?? 0, x, y, false);
      }
    }
    putRgba(this.blockBox, box);

    this.showThird(view.third !== null);
    if (view.third) {
      this.thirdLabel.textContent = t.tripleHeading(view.third.block);
      const third = new Uint8ClampedArray(16 * 16 * 4);
      for (let cell = 0; cell < 4; cell++) model.drawTileRef(third, 16, view.third.tiles[cell] ?? 0, (cell & 1) * 8, (cell & 2) * 4, false);
      putRgba(this.thirdBox, third);
    }

    const tile = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 3; i < tile.length; i += 4) tile[i] = 255;
    if (view.tile !== null) model.drawTile(tile, 8, view.tile, view.palette, this.xflip.checked, this.yflip.checked, 0, 0);
    putRgba(this.tilePreview, tile);
  }

  /** 3 層目の 4 マスを出す・隠す（タイル一覧の位置も合わせる）。 */
  private showThird(visible: boolean): void {
    this.thirdBox.hidden = !visible;
    this.thirdLabel.hidden = !visible;
    const top = visible ? SHEET_Y_TRIPLE : SHEET_Y;
    this.sheet.element.style.top = `${top}px`;
    this.sheet.element.style.height = `${SHEET_HEIGHT - (top - SHEET_Y)}px`;
  }
}
