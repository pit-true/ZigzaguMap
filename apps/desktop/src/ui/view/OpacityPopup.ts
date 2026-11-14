import type { EditorState } from "../../app/EditorState";
import type { SettingsData } from "../../app/Settings";
import { ja } from "../../i18n/ja";
import { jaEventView } from "../../i18n/ja.eventView";
import "../../styles/view.css";
import { createDialog, dialogButton, handleDialogKeys, type DialogFrame } from "../Dialog";
import { EVENT_OPACITY_MIN, OPACITY_STEPS, opacityFromSlider, opacityText, sliderFromOpacity } from "./opacityScale";

/** スライダー 1 本の決まり。 */
interface SliderSpec {
  readonly key: "movementOpacity" | "eventOpacity";
  readonly id: string;
  readonly label: string;
  /** 左端の値（0〜1）。 */
  readonly min: number;
  readonly left: string;
  readonly right: string;
}

/** 1 本分の部品。 */
interface SliderRow {
  readonly spec: SliderSpec;
  readonly slider: HTMLInputElement;
  readonly value: HTMLElement;
}

/**
 * 表示 > 移動エリアの設定の透明度。スライダーの小窓（後ろの画面も操作できる）で、動かすとすぐ反映する。
 * 上が移動エリアの透明度（AdvanceMap と同じ）、下がイベントの濃さ（#304。10〜100%、移動エリアとは別の値）。
 * ドラッグ中は描き直しだけ行い（設定ファイルには書かない）、離したときに個人設定へ保存する。
 * 開いている間にもう一度メニューを押すと、手前に出す。
 */
export class OpacityPopup {
  private frame: DialogFrame | null = null;
  private rows: SliderRow[] = [];

  constructor(private readonly state: EditorState) {}

  /** 開いているか。 */
  get isOpen(): boolean {
    return this.frame !== null;
  }

  /** 開く（開いていれば値を読み直して手前に出す）。 */
  open(): void {
    if (this.frame) {
      this.showAll();
      this.rows[0]?.slider.focus();
      return;
    }
    const frame = createDialog({ title: ja.view.opacityTitle, modal: false, className: "opacity-popup", onClose: () => this.close() });
    frame.box.style.right = "24px";
    frame.box.style.top = "96px";
    const specs: SliderSpec[] = [
      { key: "movementOpacity", id: "view.opacity", label: jaEventView.movementLabel, min: 0, left: ja.view.opacityLeft, right: ja.view.opacityRight },
      { key: "eventOpacity", id: "view.eventOpacity", label: jaEventView.opacityLabel, min: EVENT_OPACITY_MIN, left: "10%", right: "100%" },
    ];
    this.rows = specs.map((spec) => this.buildRow(frame, spec));
    const bar = document.createElement("div");
    bar.className = "help-buttons";
    const close = dialogButton(ja.view.close, () => this.close());
    close.dataset["autoId"] = "view.opacity.close";
    bar.append(close);
    frame.body.append(bar);
    handleDialogKeys(frame, () => this.close());
    frame.register({ title: ja.view.opacityTitle, text: "", buttons: [ja.view.close], press: () => this.close() });
    this.frame = frame;
    this.showAll();
    this.rows[0]?.slider.focus();
  }

  /** 閉じる。 */
  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.rows = [];
  }

  private buildRow(frame: DialogFrame, spec: SliderSpec): SliderRow {
    const caption = document.createElement("div");
    caption.className = "opacity-caption";
    caption.textContent = spec.label;
    const row = document.createElement("div");
    row.className = "opacity-row";
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = String(sliderFromOpacity(spec.min));
    slider.max = String(OPACITY_STEPS);
    slider.step = "1";
    slider.dataset["autoId"] = `${spec.id}.slider`;
    slider.setAttribute("aria-label", spec.label);
    const value = document.createElement("span");
    value.className = "opacity-value";
    value.dataset["autoId"] = `${spec.id}.value`;
    row.append(slider, value);
    const scale = document.createElement("div");
    scale.className = "opacity-scale";
    const left = document.createElement("span");
    left.textContent = spec.left;
    const right = document.createElement("span");
    right.textContent = spec.right;
    scale.append(left, right);
    frame.body.append(caption, row, scale);
    const read = (): number => Math.max(spec.min, opacityFromSlider(Number(slider.value)));
    // ドラッグ中（input）は描き直しだけ、離したとき（change）に保存する。
    slider.addEventListener("input", () => this.apply(spec, read(), false));
    slider.addEventListener("change", () => this.apply(spec, read(), true));
    return { spec, slider, value };
  }

  private showAll(): void {
    const s = this.state.settings.data;
    for (const r of this.rows) {
      const opacity = s[r.spec.key];
      r.slider.value = String(sliderFromOpacity(opacity));
      r.value.textContent = opacityText(opacity);
    }
  }

  /** 値を反映する。`save` が false（ドラッグ中）なら設定ファイルには書かず描き直しだけ。 */
  private apply(spec: SliderSpec, opacity: number, save: boolean): void {
    const patch: Partial<SettingsData> = { [spec.key]: opacity };
    if (save) this.state.settings.update(patch);
    else this.state.settings.preview(patch);
    const row = this.rows.find((r) => r.spec === spec);
    if (row) row.value.textContent = opacityText(opacity);
    this.state.emit("opacity");
  }
}
