import { renderBlocks } from "@zigzagumap/core";
import type { EditorState } from "../app/EditorState";
import { ja } from "../i18n/ja";
import { drawRgba } from "./canvas";
import { createDialog, type DialogFrame } from "./Dialog";

/**
 * 「Grosser Block」ウィンドウ（AdvanceMap の TGrosserBlockFrom）。Ctrl＋右ドラッグで選んだスタンプを等倍で出す、
 * 常に手前の小さな窓。大きさは選択に合わせて変わる。最初に使ったときに作る。
 */
export class GrosserBlockWindow {
  private frame: DialogFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;

  constructor(private readonly state: EditorState) {
    state.on("stamp", () => this.show());
    state.on("map", () => {
      if (this.frame) this.draw();
    });
  }

  /** 開いているか。 */
  get isOpen(): boolean {
    return this.frame !== null;
  }

  /** 選択中のスタンプを出す（閉じていれば開く）。 */
  show(): void {
    if (!this.state.map) return;
    if (!this.frame) {
      this.frame = createDialog({ title: ja.grosserBlock, className: "grosser-block", modal: false, onClose: () => this.close() });
      this.canvas = document.createElement("canvas");
      this.frame.body.append(this.canvas);
      this.frame.register({ title: ja.grosserBlock, text: "", buttons: [], press: () => undefined });
      // AdvanceMap と同じく、メインウィンドウの右下寄りに出す。
      this.frame.box.style.right = "24px";
      this.frame.box.style.bottom = "40px";
    }
    this.draw();
  }

  /** 閉じる。 */
  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.canvas = null;
  }

  private draw(): void {
    const canvas = this.canvas;
    const map = this.state.map;
    if (!canvas || !map) return;
    const s = this.state.selection;
    drawRgba(canvas, renderBlocks(map.tiles.renderer, s.width, s.height, (x, y) => s.blocks[y * s.width + x] ?? 0));
  }
}
