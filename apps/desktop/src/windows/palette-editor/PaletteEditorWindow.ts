import { colorFromBgr555, colorFromChannels, colorFromRgb8, colorUsage, formatColorHex, parseColorHex, type ColorValue } from "@zigzagumap/core";
import { FileDialogs } from "../../app/FileDialogs";
import type { MenuItem } from "../../app/menuDefinition";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { jaPaletteTools as pt } from "../../i18n/ja.paletteTools";
import { MenuBar } from "../../ui/MenuBar";
import { showError } from "../../ui/MessageBox";
import { autoId, button, edit, label, place } from "../../ui/form/controls";
import { showEditError } from "../../ui/form/inputErrors";
import { installToolAutomation } from "../toolAutomation";
import type { ToolClient } from "../ToolClient";
import { TilesetModel } from "../TilesetModel";
import { ColorPicker } from "./ColorPicker";
import { PaletteSwatches } from "./PaletteSwatches";
import { openColorUsage } from "./ColorUsageDialog";

/** メニュー（AdvanceMap のパレットエディタには無い。ZigzaguMap だけの項目。#396）。 */
const PALETTE_EDITOR_MENU: readonly MenuItem[] = [
  { label: pt.menuView, accel: "V", children: [{ id: "view.unusedColors", label: pt.viewUnusedColors, accel: "U" }] },
  { label: pt.menuTools, accel: "T", children: [{ id: "tools.colorUsage", label: pt.colorUsage, accel: "C" }] },
];

/** 赤・緑・青の欄（スライダーと右の数字）。 */
interface Channel {
  readonly slider: HTMLInputElement;
  readonly value: HTMLElement;
}

/**
 * パレットエディタ（別ウィンドウ）。16 色の見本、RGB のスライダー（0〜31、右の数字は 8 倍）、色の見本、
 * 15 ビットの値と「15bit to RGB」、一時適用、色の選択（スポイト）。
 *
 * スライダーで変えた色はこの窓の中だけの値で、「一時適用」でブロックエディタの表示に出る（共有の表示の状態）。
 * 編集中の状態（出力の対象）へは、ブロックエディタの「パレットの変更を反映する」で入れる。
 */
export class PaletteEditorWindow {
  private model: TilesetModel;
  /** 手元で編集中の 16 色。 */
  private working: number[] = [];
  /** 読み込んだときの表示の色（変わったら読み直す）。 */
  private loadedKey = "";
  private palette = -1;
  private index = 0;
  private readonly swatches: PaletteSwatches;
  private readonly box: HTMLElement;
  private readonly hex: HTMLInputElement;
  private readonly channels: [Channel, Channel, Channel];
  private readonly pickButton: HTMLButtonElement;
  private readonly picker: ColorPicker;
  /** 16 進の RGB の欄（#RRGGBB。#396）。 */
  private readonly rgb: HTMLInputElement;
  /** 表示 > 未使用の色（既定オフ）。 */
  private showUnused = false;
  /** 色ごとの、その色を使うブロック（写しかパレットが変わったら数え直す）。 */
  private usage: number[][] | null = null;

  static start(root: HTMLElement, client: ToolClient): PaletteEditorWindow {
    return new PaletteEditorWindow(root, client);
  }

  private constructor(
    root: HTMLElement,
    private readonly client: ToolClient,
  ) {
    this.model = new TilesetModel(client.snapshot, client.ui);
    this.swatches = new PaletteSwatches(
      (palette) => void client.setUi({ palette }),
      (index) => this.selectColor(index),
    );
    this.box = autoId(place(document.createElement("div"), 8, 80, 65, 65), "pal.preview");
    this.box.className += " pal-box";
    this.hex = edit("pal.hex", 8, 152, 65);
    this.hex.maxLength = 4;
    const channel = (id: string, y: number, color: string): Channel => {
      const slider = autoId(place(document.createElement("input"), 80, y, 169, 17), id);
      slider.type = "range";
      slider.min = "0";
      slider.max = "31";
      slider.className += " pal-slider";
      slider.addEventListener("input", () => this.setColor(this.fromSliders()));
      const value = autoId(label("0", 256, y + 2, 22), `${id}Value`);
      value.style.color = color;
      value.classList.add("pal-value");
      return { slider, value };
    };
    this.channels = [channel("pal.red", 80, "#ff0000"), channel("pal.green", 104, "#00ff00"), channel("pal.blue", 128, "#0000ff")];
    this.picker = new ColorPicker(
      (color) => this.setColor(color),
      () => this.pickButton.classList.remove("active"),
    );
    this.pickButton = button("pal.pick", t.pickColor, 160, 48, 121, 25, () => {
      this.picker.toggle();
      this.pickButton.classList.toggle("active", this.picker.active);
    });
    this.rgb = edit("pal.rgbHex", 80, 186, 73);
    this.rgb.maxLength = 7;
    this.rgb.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.rgbToColor();
    });
    const actions: Record<string, () => unknown> = {
      "view.unusedColors": () => {
        this.showUnused = !this.showUnused;
        this.render();
      },
      "tools.colorUsage": () =>
        openColorUsage({
          palette: this.palette,
          color: this.index,
          blocks: this.colorUsage()[this.index] ?? [],
          select: (block) => void client.setUi({ focusBlock: block }),
        }),
    };
    const menu = new MenuBar({
      items: () => [...PALETTE_EDITOR_MENU],
      isEnabled: () => true,
      isChecked: (id) => id === "view.unusedColors" && this.showUnused,
      run: (id) => {
        const action = actions[id];
        if (action) Promise.resolve().then(action).catch((e: unknown) => void showEditError(e));
      },
    });
    const body = document.createElement("div");
    body.className = "pal-body";
    root.classList.add("palette-editor");
    root.append(menu.element, body);
    body.append(
      this.swatches.element,
      button("pal.apply", t.apply, 160, 8, 121, 25, () => void client.setUi({ preview: { [this.palette]: [...this.working] } })),
      this.pickButton,
      this.box,
      ...this.channels.flatMap((c) => [c.slider, c.value]),
      this.hex,
      label(t.gbcValue, 80, 160),
      button("pal.hexToRgb", t.hexToRgb, 208, 152, 73, 25, () => this.hexToRgb()),
      // ZigzaguMap だけの行（#396）: 16 進の RGB
      label(pt.rgbLabel, 8, 190),
      this.rgb,
      button("pal.rgbApply", pt.rgbApply, 160, 184, 121, 25, () => this.rgbToColor()),
    );

    client.onUi(() => this.load());
    client.onSnapshot(() => {
      this.usage = null;
      this.load();
    });
    void installToolAutomation(client, {
      files: new FileDialogs(),
      actions,
      describe: () => this.describe(),
      extra: (req) => {
        if (req["cmd"] !== "pickAt") return undefined;
        const n = (k: string): number => (typeof req[k] === "number" ? (req[k] as number) : 0);
        return this.picker.pickFromWindow(typeof req["source"] === "string" ? req["source"] : "block-editor", n("x"), n("y"));
      },
    });
    this.load();
  }

  /** 共有の状態（選んでいるパレット・一時適用・写し）から読み直す。手元の色は、元の色が変わったときだけ捨てる。 */
  private load(): void {
    this.model = new TilesetModel(this.client.snapshot, this.client.ui);
    const palette = this.client.ui.palette;
    const colors = this.model.colors(palette);
    const key = `${palette}|${colors.join(",")}`;
    if (palette !== this.palette || key !== this.loadedKey) {
      this.palette = palette;
      this.loadedKey = key;
      this.working = colors;
      this.usage = null;
    }
    this.render();
  }

  private selectColor(index: number): void {
    this.index = index;
    this.render();
  }

  /** 選んでいる色を変える（スライダー・15bit to RGB・スポイト）。 */
  private setColor(color: ColorValue): void {
    this.working[this.index] = color.value;
    this.render();
  }

  private fromSliders(): ColorValue {
    const [r, g, b] = this.channels.map((c) => Number(c.slider.value));
    return colorFromChannels(r!, g!, b!);
  }

  private hexToRgb(): void {
    try {
      this.setColor(parseColorHex(this.hex.value));
    } catch (e) {
      void showEditError(e);
    }
  }

  /** 16 進の RGB（#RRGGBB、# は省いてよい）を読み、15 ビットに丸めて選んでいる色にする。 */
  private rgbToColor(): void {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(this.rgb.value.trim());
    if (!m) {
      void showError(pt.rgbInvalid(this.rgb.value));
      return;
    }
    const v = parseInt(m[1]!, 16);
    const color = colorFromRgb8((v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff);
    this.setColor(color);
    // 丸めた値に戻す（入力中でも）
    this.rgb.value = rgbHex(color);
  }

  /** 色ごとの使用箇所（表示中のマップの組のブロックで、このパレットで描くタイルの点）。 */
  private colorUsage(): number[][] {
    if (!this.usage) {
      const p = this.model.blockData(false);
      const s = this.model.blockData(true);
      this.usage = colorUsage({
        primaryBlocks: p.blocks,
        secondaryBlocks: s.blocks,
        primaryTiles: this.model.tilesOf(false),
        secondaryTiles: this.model.tilesOf(true),
        palette: this.palette,
      });
    }
    return this.usage;
  }

  /** 未使用の色（表示 > 未使用の色がオンのときだけ数える）。 */
  private unusedColors(): Set<number> | null {
    if (!this.showUnused) return null;
    return new Set(this.colorUsage().flatMap((b, c) => (b.length === 0 ? [c] : [])));
  }

  private render(): void {
    this.swatches.show(this.palette, this.working, this.index, this.unusedColors());
    const color = colorFromBgr555(this.working[this.index] ?? 0);
    [color.red, color.green, color.blue].forEach((v, i) => {
      const c = this.channels[i]!;
      c.slider.value = String(v);
      c.value.textContent = String(v * 8);
    });
    this.box.style.background = `rgb(${color.red * 8},${color.green * 8},${color.blue * 8})`;
    this.hex.value = formatColorHex(color.value);
    if (document.activeElement !== this.rgb) this.rgb.value = rgbHex(color);
  }

  private describe(): unknown {
    const color = colorFromBgr555(this.working[this.index] ?? 0);
    return {
      palette: this.palette,
      index: this.index,
      colors: this.working.map(formatColorHex),
      color: { red: color.red, green: color.green, blue: color.blue, hex: formatColorHex(color.value) },
      picking: this.picker.active,
      preview: Object.keys(this.client.ui.preview).map(Number),
      rgb: this.rgb.value,
      showUnused: this.showUnused,
      unusedColors: this.showUnused ? [...(this.unusedColors() ?? [])] : null,
    };
  }
}

/** 色の #RRGGBB（各 5 ビットを 8 倍した値。右の数字と同じ）。 */
function rgbHex(c: ColorValue): string {
  const h = (v: number): string => (v * 8).toString(16).toUpperCase().padStart(2, "0");
  return `#${h(c.red)}${h(c.green)}${h(c.blue)}`;
}
