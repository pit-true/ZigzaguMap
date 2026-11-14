import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import "../../styles/view.css";
import { createDialog, dialogButton, handleDialogKeys, type DialogFrame } from "../Dialog";
import { OPACITY_STEPS, opacityFromSlider, opacityText, sliderFromOpacity } from "./opacityScale";

/**
 * 表示 > 移動エリアの設定の透明度。スライダーの小窓（後ろの画面も操作できる）で、動かすとすぐ移動エリアタブに反映する。
 * ドラッグ中は描き直しだけ行い（設定ファイルには書かない）、離したときに個人設定へ保存する。
 * 開いている間にもう一度メニューを押すと、手前に出す。
 */
export class OpacityPopup {
  private frame: DialogFrame | null = null;
  private slider: HTMLInputElement | null = null;
  private value: HTMLElement | null = null;

  constructor(private readonly state: EditorState) {}

  /** 開いているか。 */
  get isOpen(): boolean {
    return this.frame !== null;
  }

  /** 開く（開いていれば値を読み直して手前に出す）。 */
  open(): void {
    if (this.frame) {
      this.show(this.state.settings.data.movementOpacity);
      this.slider?.focus();
      return;
    }
    const frame = createDialog({ title: ja.view.opacityTitle, modal: false, className: "opacity-popup", onClose: () => this.close() });
    frame.box.style.right = "24px";
    frame.box.style.top = "96px";
    const row = document.createElement("div");
    row.className = "opacity-row";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = String(OPACITY_STEPS);
    slider.step = "1";
    slider.dataset["autoId"] = "view.opacity.slider";
    slider.setAttribute("aria-label", ja.view.opacityTitle);
    const value = document.createElement("span");
    value.className = "opacity-value";
    value.dataset["autoId"] = "view.opacity.value";
    row.append(slider, value);
    const scale = document.createElement("div");
    scale.className = "opacity-scale";
    const left = document.createElement("span");
    left.textContent = ja.view.opacityLeft;
    const right = document.createElement("span");
    right.textContent = ja.view.opacityRight;
    scale.append(left, right);
    const bar = document.createElement("div");
    bar.className = "help-buttons";
    const close = dialogButton(ja.view.close, () => this.close());
    close.dataset["autoId"] = "view.opacity.close";
    bar.append(close);
    frame.body.append(row, scale, bar);
    handleDialogKeys(frame, () => this.close());
    // ドラッグ中（input）は描き直しだけ、離したとき（change）に保存する。
    slider.addEventListener("input", () => this.preview(opacityFromSlider(Number(slider.value))));
    slider.addEventListener("change", () => this.commit(opacityFromSlider(Number(slider.value))));
    frame.register({ title: ja.view.opacityTitle, text: "", buttons: [ja.view.close], press: () => this.close() });
    this.frame = frame;
    this.slider = slider;
    this.value = value;
    this.show(this.state.settings.data.movementOpacity);
    slider.focus();
  }

  /** 閉じる。 */
  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.slider = null;
    this.value = null;
  }

  private show(opacity: number): void {
    if (this.slider) this.slider.value = String(sliderFromOpacity(opacity));
    if (this.value) this.value.textContent = opacityText(opacity);
  }

  /** ドラッグ中: 設定ファイルには書かず、描き直しだけ行う。 */
  private preview(opacity: number): void {
    this.state.settings.preview({ movementOpacity: opacity });
    if (this.value) this.value.textContent = opacityText(opacity);
    this.state.emit("opacity");
  }

  /** 離したとき: 個人設定に保存する。 */
  private commit(opacity: number): void {
    this.state.settings.update({ movementOpacity: opacity });
    this.show(opacity);
    this.state.emit("opacity");
  }
}
