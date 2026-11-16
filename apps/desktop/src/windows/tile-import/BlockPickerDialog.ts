import { BLOCK_PIXELS, PRIMARY_BLOCK_COUNT, PRIMARY_PALETTE_COUNT, PRIMARY_TILE_COUNT } from "@zigzagumap/core";
import { jaTileImport as t } from "../../i18n/ja.tileImport";
import { autoId, check } from "../../ui/form/controls";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "../../ui/Dialog";
import { pixelCanvas, pointIn, putRgba, resizePixelCanvas } from "../block-editor/pixelCanvas";
import type { TilesetModel } from "../TilesetModel";

/** 1 行のブロック数。 */
const COLUMNS = 8;
/** 表示の倍率（1 ブロック 32px）。 */
const SCALE = 2;
const CELL = BLOCK_PIXELS * SCALE;

/** 下地にできるか（主へ入れるときは、副のブロック・タイル・パレットを使う下地は誤り）。 */
export function baseAllowed(model: TilesetModel, block: number, targetSecondary: boolean): boolean {
  if (targetSecondary) return true;
  if (block >= PRIMARY_BLOCK_COUNT) return false;
  const tiles = model.blockTiles(block);
  return !!tiles && tiles.slice(0, 4).every((v) => (v & 0x3ff) < PRIMARY_TILE_COUNT && v >> 12 < PRIMARY_PALETTE_COUNT);
}

/** ブロックの上のレイヤーに絵があるか（色番号 0 でない画素がある）。 */
export function upperDrawn(model: TilesetModel, block: number): boolean {
  const tiles = model.blockTiles(block);
  if (!tiles) return false;
  return tiles.slice(4).some((v) => model.tileBytes(v & 0x3ff)?.some((b) => b !== 0) ?? false);
}

/**
 * 下地ブロックを選ぶ窓（Phase6 #445。Bochi の「下地ブロックを選ぶ」と同じ動き）。全部のブロックを 1 行 8 個、2 倍で並べ、
 * 主と副の境目に線を引く。カーソルの下は白、選んだものは黄色の枠。ダブルクリックか OK で決める。
 * 「上のレイヤーも重ねて表示する」がオフのときは、下地として写す下のレイヤーだけを描き、写さない上のレイヤーに絵がある
 * ブロックには右上に三角の印を付ける。決めたブロックの通し番号を返す（キャンセルなら undefined）。
 */
export function pickBaseBlock(model: TilesetModel, current: number | null, targetSecondary: boolean): Promise<number | undefined> {
  return new Promise((resolve) => {
    let selected = current;
    let cursor: number | null = null;
    let showUpper = false;
    const finish = (value: number | undefined): void => {
      canvas.width = 0;
      canvas.height = 0;
      frame.remove();
      resolve(value);
    };
    const frame = createDialog({ title: t.pickerTitle, width: 330, onClose: () => finish(undefined) });
    const scroll = autoId(document.createElement("div"), "ti.picker.scroll");
    scroll.className = "ti-picker";
    const canvas = pixelCanvas("ti.picker", COLUMNS * BLOCK_PIXELS, 16, SCALE);
    const hover = document.createElement("div");
    hover.className = "ti-picker-hover";
    const mark = document.createElement("div");
    mark.className = "ti-picker-selected";
    scroll.append(canvas, hover, mark);
    const upper = check("ti.picker.upper", t.pickerUpper, 0, 0, 300);
    upper.root.classList.remove("am-abs");
    const status = autoId(document.createElement("div"), "ti.picker.status");
    const note = document.createElement("div");
    note.className = "ti-note";
    note.textContent = targetSecondary ? t.pickerMark : `${t.pickerMark}\n${t.pickerSecondary}`;
    const error = autoId(document.createElement("div"), "ti.picker.error");
    error.className = "ti-problem-error";
    const count = model.listedBlocks;
    const valid = (b: number): boolean => b >= 0 && b < count && model.owner(b) !== null;
    const place = (el: HTMLElement, b: number | null): void => {
      el.hidden = b === null;
      if (b === null) return;
      el.style.left = `${(b % COLUMNS) * CELL}px`;
      el.style.top = `${Math.floor(b / COLUMNS) * CELL}px`;
    };
    const showStatus = (): void => {
      status.textContent = t.pickerStatus(selected, cursor);
      place(hover, cursor);
      place(mark, selected);
    };
    const draw = (): void => {
      const rows = Math.ceil(count / COLUMNS);
      const width = COLUMNS * BLOCK_PIXELS;
      resizePixelCanvas(canvas, width, rows * BLOCK_PIXELS, SCALE);
      const data = new Uint8ClampedArray(width * rows * BLOCK_PIXELS * 4);
      for (let i = 3; i < data.length; i += 4) data[i] = 255;
      for (let b = 0; b < count; b++) {
        const tiles = model.blockTiles(b);
        if (!tiles) continue;
        const x = (b % COLUMNS) * BLOCK_PIXELS;
        const y = Math.floor(b / COLUMNS) * BLOCK_PIXELS;
        if (showUpper && model.renderer) model.renderer.blit(b, data, width, x, y);
        else for (let k = 0; k < 4; k++) model.drawTileRef(data, width, tiles[k]!, x + (k & 1) * 8, y + (k >> 1) * 8, false);
        if (!showUpper && upperDrawn(model, b)) {
          // 右上の三角（写さない上のレイヤーに絵がある）
          for (let dy = 0; dy < 5; dy++) for (let dx = 4 - dy; dx < 5; dx++) data.set([255, 64, 64, 255], ((y + dy) * width + x + 11 + dx) * 4);
        }
        if (!baseAllowed(model, b, targetSecondary)) for (let k = 0; k < BLOCK_PIXELS * BLOCK_PIXELS; k += 3) {
          const o = ((y + Math.floor(k / BLOCK_PIXELS)) * width + x + (k % BLOCK_PIXELS)) * 4;
          data[o] = data[o]! >> 1;
          data[o + 1] = data[o + 1]! >> 1;
          data[o + 2] = data[o + 2]! >> 1;
        }
      }
      // 主と副の境目の線
      const line = (PRIMARY_BLOCK_COUNT / COLUMNS) * BLOCK_PIXELS;
      if (line < rows * BLOCK_PIXELS) for (let x = 0; x < width; x++) data.set([255, 0, 0, 255], (line * width + x) * 4);
      putRgba(canvas, data);
    };
    const blockAt = (e: MouseEvent): number | null => {
      const p = pointIn(canvas, e);
      const b = Math.floor(p.y / CELL) * COLUMNS + Math.floor(p.x / CELL);
      return p.x >= 0 && p.x < COLUMNS * CELL && valid(b) ? b : null;
    };
    const decide = (): void => {
      if (selected === null) return;
      if (!baseAllowed(model, selected, targetSecondary)) {
        error.textContent = t.pickerSecondary;
        return;
      }
      finish(selected);
    };
    canvas.addEventListener("pointermove", (e) => {
      cursor = blockAt(e);
      showStatus();
    });
    canvas.addEventListener("pointerdown", (e) => {
      const b = blockAt(e);
      if (b === null) return;
      selected = b;
      error.textContent = baseAllowed(model, b, targetSecondary) ? "" : t.pickerSecondary;
      showStatus();
    });
    canvas.addEventListener("dblclick", (e) => {
      const b = blockAt(e);
      if (b === null) return;
      selected = b;
      decide();
    });
    upper.input.addEventListener("change", () => {
      showUpper = upper.input.checked;
      draw();
    });
    draw();
    showStatus();
    frame.body.append(scroll, upper.root, status, note, error, dialogButtonRow(dialogButton(t.ok, decide), dialogButton(t.cancel, () => finish(undefined))));
    if (selected !== null) scroll.scrollTop = Math.max(0, Math.floor(selected / COLUMNS) * CELL - 100);
    handleDialogKeys(frame, () => finish(undefined), (e) => {
      if (e.key === "Enter") decide();
    });
    frame.register({
      title: t.pickerTitle,
      text: note.textContent,
      ...pressable([
        { label: t.ok, aliases: ["ok"], run: decide },
        { label: t.cancel, aliases: ["cancel"], run: () => finish(undefined) },
      ]),
    });
  });
}
