import { TOTAL_PALETTE_COUNT, bgr555ToRgb } from "@zigzagumap/core";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { autoId, combo, label, place } from "../../ui/form/controls";

/**
 * パレットの表示（AdvanceMap の Frame_Palette）。「Palette:」とパレットの選択（Palette0〜12）、
 * 16 色の見本（12×11、上の段が 0〜7、下の段が 8〜15）。見本を押すとその色を選ぶ。
 */
export class PaletteSwatches {
  readonly element: HTMLElement;
  readonly palette: HTMLSelectElement;
  private readonly swatches: HTMLElement[] = [];
  private selected = 0;

  constructor(
    onPalette: (palette: number) => void,
    private readonly onColor: (index: number) => void,
  ) {
    this.element = place(document.createElement("div"), 8, 8, 153, 65);
    const caption = label(t.paletteLabel, 0, 2, 54);
    caption.classList.add("pal-caption");
    this.palette = combo(
      "pal.palette",
      Array.from({ length: TOTAL_PALETTE_COUNT }, (_, i) => t.paletteName(i)),
      64,
      0,
      81,
    );
    this.element.append(caption, this.palette);
    for (let i = 0; i < 16; i++) {
      const s = autoId(place(document.createElement("div"), (i % 8) * 16, 32 + Math.floor(i / 8) * 16, 12, 11), `pal.color.${i}`);
      s.className += " pal-swatch";
      s.addEventListener("click", () => this.onColor(i));
      this.swatches.push(s);
      this.element.append(s);
    }
    this.palette.addEventListener("change", () => onPalette(this.palette.selectedIndex));
  }

  /** 16 色と、選んでいるパレット・色を出す。 */
  show(palette: number, colors: readonly number[], selected: number): void {
    if (this.palette.selectedIndex !== palette) this.palette.selectedIndex = palette;
    this.selected = selected;
    this.swatches.forEach((s, i) => {
      const [r, g, b] = bgr555ToRgb(colors[i] ?? 0);
      s.style.background = `rgb(${r},${g},${b})`;
      s.classList.toggle("selected", i === this.selected);
    });
  }
}
