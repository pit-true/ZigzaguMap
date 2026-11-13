import { TOTAL_PALETTE_COUNT } from "@zigzagumap/core";
import { hexText, jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { autoId, button, check, combo, label, place } from "../../ui/form/controls";
import type { TilesetModel } from "../TilesetModel";
import { pixelCanvas, pointIn, putRgba } from "./pixelCanvas";
import type { TileSheetView } from "./TileSheetView";

/** ブロックの編集面が使う窓口。 */
export interface BlockEditPanelHost {
  /** 8 マスの `cell` を左クリック（置く）。 */
  place(cell: number): void;
  /** 8 マスの `cell` を右クリック（拾う）。 */
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
  readonly palette: number;
}

/**
 * 中央の「ブロックの編集面」（AdvanceMap の ScrollBox_HauptTeil）。
 * 下層/上層の 8 マス（BlockBox、各タイル 16px）、Tile のプレビュー、Tile / Block / Offset 欄、左右逆・上下逆、
 * パレット（Palette0〜12）、変更を保存、その下にタイル一覧を置く。
 */
export class BlockEditPanel {
  readonly element: HTMLElement;
  readonly blockBox: HTMLCanvasElement;
  readonly tilePreview: HTMLCanvasElement;
  readonly xflip: HTMLInputElement;
  readonly yflip: HTMLInputElement;
  readonly palette: HTMLSelectElement;
  private readonly tileLabel: HTMLElement;
  private readonly blockLabel: HTMLElement;
  private readonly offsetLabel: HTMLElement;

  constructor(host: BlockEditPanelHost, sheet: TileSheetView) {
    this.element = place(document.createElement("div"), 273, 0, 288, 233);
    this.element.className += " be-scroll be-main";
    this.blockBox = place(pixelCanvas("be.block", 32, 16, 2), 8, 24);
    this.tilePreview = place(pixelCanvas("be.tile", 8, 8, 2), 152, 8);
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
      sheet.element,
    );

    this.blockBox.addEventListener("pointerdown", (e) => {
      const p = pointIn(this.blockBox, e);
      if (p.x < 0 || p.y < 0 || p.x >= 64 || p.y >= 32) return;
      const cell = (p.x >= 32 ? 4 : 0) + (p.y >= 16 ? 2 : 0) + ((p.x % 32) >= 16 ? 1 : 0);
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

    const tile = new Uint8ClampedArray(8 * 8 * 4);
    for (let i = 3; i < tile.length; i += 4) tile[i] = 255;
    if (view.tile !== null) model.drawTile(tile, 8, view.tile, view.palette, this.xflip.checked, this.yflip.checked, 0, 0);
    putRgba(this.tilePreview, tile);
  }
}
