import { TOTAL_PALETTE_COUNT } from "@zigzagumap/core";
import { hexText, jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { autoId, button, check, combo, label, place } from "../../ui/form/controls";
import type { TilesetModel } from "../TilesetModel";
import { pixelCanvas, pointIn, putRgba } from "./pixelCanvas";
import type { TileSheetView } from "./TileSheetView";

/** ブロックの編集面が使う窓口。 */
export interface BlockEditPanelHost {
  /** マス `cell` を左クリック（置く）。0〜7 は 8 マス、8〜11 は 3 層目の 4 マス。`paletteOnly` は Ctrl＋左クリック（パレットだけ塗る）。 */
  place(cell: number, paletteOnly: boolean): void;
  /** マス `from` で右ボタンを押し、マス `to` で離した（矩形で拾う。1 マスなら from と to が同じ）。 */
  pick(from: number, to: number): void;
  /** マスの上にマウスが来た（外れたら null）。 */
  hover(cell: number | null): void;
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

/** 値を出す文字（見出しの枠の中に置く）。 */
function valueText(): HTMLElement {
  const span = document.createElement("span");
  span.className = "be-field-value";
  return span;
}

/**
 * 見出しと値の枠。`row` は見出しの右に値、`column` は見出しの下に値（少し字下げ）。`after` は値の右に続けて置く部品
 * （タイルのプレビュー）。
 * 位置を決め打ちにしないので、見出しの文字の幅（フォントや文言）によらず値と重ならない。
 */
function fieldRow(caption: string, value: HTMLElement, x: number, y: number, direction: "row" | "column", after?: HTMLElement): HTMLElement {
  const box = place(document.createElement("div"), x, y);
  box.className += ` be-field be-field-${direction}`;
  const head = document.createElement("span");
  head.className = "am-label";
  head.textContent = caption;
  box.append(head, value);
  if (after) box.append(after);
  return box;
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
    this.tilePreview = pixelCanvas("be.tile", 8, 8, 2);
    this.tilePreview.classList.add("be-field-preview");
    this.thirdBox = place(pixelCanvas("be.third", 16, 16, 2), 8, THIRD_Y);
    this.thirdLabel = autoId(label("", 48, THIRD_Y + 10), "be.thirdLabel");
    this.thirdLabel.classList.add("be-third-label");
    this.tileLabel = autoId(valueText(), "be.tileLabel");
    this.blockLabel = autoId(valueText(), "be.blockLabel");
    this.offsetLabel = autoId(valueText(), "be.offsetLabel");
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
      // 見出しと値は 1 つの枠に並べ、見出しの幅が変わっても値と重ならないようにする（#383）。
      // オフセットは 6 桁で横に収まらないため、見出しの下の行に値を出す
      fieldRow(t.tile, this.tileLabel, 96, 8, "row", this.tilePreview),
      fieldRow(t.block, this.blockLabel, 96, 30, "row"),
      fieldRow(t.offset, this.offsetLabel, 96, 50, "column"),
      x.root,
      y.root,
      button("be.save", t.save, 200, 48, 81, 33, () => host.save()),
      this.thirdBox,
      this.thirdLabel,
      sheet.element,
    );
    this.showThird(false);

    this.listenCells(this.blockBox, host, (x, y) => (x < 0 || y < 0 || x >= 64 || y >= 32 ? null : (x >= 32 ? 4 : 0) + (y >= 16 ? 2 : 0) + (x % 32 >= 16 ? 1 : 0)));
    this.listenCells(this.thirdBox, host, (x, y) => (x < 0 || y < 0 || x >= 32 || y >= 32 ? null : 8 + (y >= 16 ? 2 : 0) + (x >= 16 ? 1 : 0)));
    this.xflip.addEventListener("change", () => host.flipChanged());
    this.yflip.addEventListener("change", () => host.flipChanged());
    this.palette.addEventListener("change", () => host.paletteChanged(this.palette.selectedIndex));
  }

  /**
   * 8 マス・3 層目のマウス操作。左クリックで置く（Ctrl でパレットだけ）、右ボタンの押した所から離した所までで矩形を拾う
   * （#393。離す位置がもう一方の格子なら押したマスだけ）。乗せたマスを窓口に知らせる。
   */
  private listenCells(canvas: HTMLCanvasElement, host: BlockEditPanelHost, cellAt: (x: number, y: number) => number | null): void {
    let pickFrom: number | null = null;
    const cellOf = (e: PointerEvent): number | null => {
      const p = pointIn(canvas, e);
      return cellAt(p.x, p.y);
    };
    canvas.addEventListener("pointerdown", (e) => {
      const cell = cellOf(e);
      if (cell === null) return;
      if (e.button === 0) host.place(cell, e.ctrlKey);
      else if (e.button === 2) {
        pickFrom = cell;
        try {
          canvas.setPointerCapture(e.pointerId);
        } catch {
          // 自動操作でまねたイベントはつかめない。
        }
      }
    });
    canvas.addEventListener("pointermove", (e) => host.hover(cellOf(e)));
    canvas.addEventListener("pointerleave", () => host.hover(null));
    // 右ボタンを離したのが別の部品の上でも、押した部品で受ける（3 層目へ離したときは 8 マスの外として押したマスだけ拾う）
    canvas.addEventListener("pointerup", (e) => {
      if (pickFrom === null) return;
      const from = pickFrom;
      pickFrom = null;
      host.pick(from, cellOf(e) ?? from);
    });
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
