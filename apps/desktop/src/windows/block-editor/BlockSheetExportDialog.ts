import { formatHex } from "@zigzagumap/core";
import { writeFile, type FileDialogs } from "../../app/FileDialogs";
import { ja } from "../../i18n/ja";
import { jaBlockEditor } from "../../i18n/ja.blockEditor";
import { jaBlockTools as tt } from "../../i18n/ja.blockTools";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../../ui/Dialog";
import { showError } from "../../ui/MessageBox";
import { errorText } from "../../util/errors";
import type { TilesetModel } from "../TilesetModel";
import { renderBlockSheet, type BlockSheetBackground, type BlockSheetOptions } from "./blockSheetImage";

const BACKGROUNDS: readonly BlockSheetBackground[] = ["transparent", "black", "palette0"];

/** 書き出しの窓が使う窓口。 */
export interface BlockSheetExportHost {
  readonly model: TilesetModel;
  readonly files: FileDialogs;
  /** 書いたとき（窓の下の案内に出す）。 */
  saved(path: string): void;
}

/** 前に選んだ値（窓を開いている間だけ覚える）。 */
let last: BlockSheetOptions | null = null;

/**
 * 画像 > ブロック一覧の画像の書き出し…（#395）。タイルセット・範囲・レイヤー・幅・透明の扱いを選び、
 * プレビューを見て PNG に書く。ブロックエディタの窓の中に出す（AdvanceMap の窓の配置は変えない）。
 */
export function openBlockSheetExport(host: BlockSheetExportHost): void {
  const finish = (): void => frame.remove();
  const frame = createDialog({ title: tt.exportTitle, width: 560, className: "be-export", onClose: finish });
  const model = host.model;
  const o: BlockSheetOptions = last ?? { secondary: false, from: 0, to: Math.max(0, model.primaryBlockCount - 1), lower: true, upper: true, third: true, columns: 8, background: "transparent" };

  const form = document.createElement("div");
  form.className = "be-export-form";
  const tileset = select("be.exp.tileset", [tt.exportTileset1, tt.exportTileset2], o.secondary ? 1 : 0);
  const from = text("be.exp.from", formatHex(o.from, 3));
  const to = text("be.exp.to", formatHex(o.to, 3));
  const lower = checkbox("be.exp.lower", o.lower);
  const upper = checkbox("be.exp.upper", o.upper);
  const third = checkbox("be.exp.third", o.third);
  const columns = text("be.exp.columns", String(o.columns));
  const background = select("be.exp.background", [tt.exportBgTransparent, tt.exportBgBlack, tt.exportBgPalette0], BACKGROUNDS.indexOf(o.background));
  const info = document.createElement("div");
  info.className = "be-export-info";
  info.dataset["autoId"] = "be.exp.info";
  form.append(
    row(tt.exportTileset, tileset),
    row(tt.exportRange, from, document.createTextNode("〜"), to),
    row(tt.exportLayers, label(lower, tt.exportLower), label(upper, tt.exportUpper), label(third, tt.exportThird)),
    row(tt.exportColumns, columns),
    row(tt.exportBackground, background),
    info,
  );
  const preview = document.createElement("div");
  preview.className = "be-export-preview";
  const canvas = document.createElement("canvas");
  canvas.dataset["autoId"] = "be.exp.preview";
  canvas.className = "pixel-canvas";
  preview.append(canvas);
  const main = document.createElement("div");
  main.className = "be-export-main";
  main.append(form, preview);

  const read = (): BlockSheetOptions => {
    const hex = (el: HTMLInputElement, fallback: number): number => {
      const v = parseInt(el.value.trim().replace(/^\$|^0x/i, ""), 16);
      return Number.isFinite(v) ? v : fallback;
    };
    const secondary = tileset.selectedIndex === 1;
    return {
      secondary,
      from: hex(from, 0),
      to: hex(to, 0),
      lower: lower.checked,
      upper: upper.checked,
      third: third.checked,
      columns: Math.max(1, Math.min(64, parseInt(columns.value, 10) || 8)),
      background: BACKGROUNDS[background.selectedIndex] ?? "transparent",
    };
  };
  const draw = (): void => {
    const opt = read();
    last = opt;
    const img = renderBlockSheet(model, opt);
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.style.width = `${img.width}px`;
    canvas.style.height = `${img.height}px`;
    canvas.getContext("2d")!.putImageData(new ImageData(img.data, img.width, img.height), 0, 0);
    info.textContent = tt.exportInfo(img.blocks, img.width, img.height);
  };
  tileset.addEventListener("change", () => {
    const count = tileset.selectedIndex === 1 ? model.secondaryBlockCount : model.primaryBlockCount;
    from.value = formatHex(0, 3);
    to.value = formatHex(Math.max(0, count - 1), 3);
    draw();
  });
  for (const el of [from, to, columns]) el.addEventListener("input", draw);
  for (const el of [lower, upper, third, background]) el.addEventListener("change", draw);

  const save = async (): Promise<void> => {
    draw();
    let path = await host.files.saveFile({ title: tt.exportTitle, filters: [{ name: jaBlockEditor.pngFilter, extensions: ["png"] }], directory: null, fileName: "blocks.png" });
    if (!path) return;
    if (!/\.png$/i.test(path)) path += ".png";
    try {
      const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
      if (!blob) throw new Error(tt.exportFailed);
      await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
      host.saved(path);
      finish();
    } catch (e) {
      await showError(errorText(e));
    }
  };
  const buttons = dialogButtonRow(dialogButton(tt.exportSave, () => void save()), dialogButton(ja.cancel, finish));
  frame.body.append(main, buttons);
  handleDialogKeys(frame, finish);
  frame.register({
    title: tt.exportTitle,
    text: "",
    ...pressable([
      { label: tt.exportSave, aliases: ["save", "ok"], run: () => void save() },
      { label: ja.cancel, aliases: ["cancel"], run: finish },
    ]),
  });
  draw();
}

function select(id: string, options: readonly string[], index: number): HTMLSelectElement {
  const el = document.createElement("select");
  el.dataset["autoId"] = id;
  for (const o of options) el.append(new Option(o));
  el.selectedIndex = Math.max(0, index);
  return el;
}

function text(id: string, value: string): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "text";
  el.dataset["autoId"] = id;
  el.value = value;
  el.size = 5;
  return el;
}

function checkbox(id: string, checked: boolean): HTMLInputElement {
  const el = document.createElement("input");
  el.type = "checkbox";
  el.dataset["autoId"] = id;
  el.checked = checked;
  return el;
}

function label(input: HTMLInputElement, caption: string): HTMLLabelElement {
  const l = document.createElement("label");
  l.append(input, document.createTextNode(caption));
  return l;
}

function row(caption: string, ...children: Node[]): HTMLElement {
  const div = document.createElement("div");
  div.className = "be-export-row";
  const head = document.createElement("span");
  head.className = "be-export-caption";
  head.textContent = caption;
  div.append(head, ...children);
  return div;
}
