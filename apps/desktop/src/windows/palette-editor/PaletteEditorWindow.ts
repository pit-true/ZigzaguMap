import { colorFromBgr555, colorFromChannels, formatColorHex, parseColorHex, type ColorValue } from "@zigzagumap/core";
import { FileDialogs } from "../../app/FileDialogs";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { autoId, button, edit, label, place } from "../../ui/form/controls";
import { showEditError } from "../../ui/form/inputErrors";
import { installToolAutomation } from "../toolAutomation";
import type { ToolClient } from "../ToolClient";
import { TilesetModel } from "../TilesetModel";
import { ColorPicker } from "./ColorPicker";
import { PaletteSwatches } from "./PaletteSwatches";

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
    root.classList.add("palette-editor");
    root.append(
      this.swatches.element,
      button("pal.apply", t.apply, 160, 8, 121, 25, () => void client.setUi({ preview: { [this.palette]: [...this.working] } })),
      this.pickButton,
      this.box,
      ...this.channels.flatMap((c) => [c.slider, c.value]),
      this.hex,
      label(t.gbcValue, 80, 160),
      button("pal.hexToRgb", t.hexToRgb, 208, 152, 73, 25, () => this.hexToRgb()),
    );

    client.onUi(() => this.load());
    void installToolAutomation(client, {
      files: new FileDialogs(),
      actions: {},
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

  private render(): void {
    this.swatches.show(this.palette, this.working, this.index);
    const color = colorFromBgr555(this.working[this.index] ?? 0);
    [color.red, color.green, color.blue].forEach((v, i) => {
      const c = this.channels[i]!;
      c.slider.value = String(v);
      c.value.textContent = String(v * 8);
    });
    this.box.style.background = `rgb(${color.red * 8},${color.green * 8},${color.blue * 8})`;
    this.hex.value = formatColorHex(color.value);
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
    };
  }
}
