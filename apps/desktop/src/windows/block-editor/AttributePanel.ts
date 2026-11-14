import { isUndrawnLayerMode } from "@zigzagumap/core";
import { hexText, jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { autoId, combo, edit, label, place } from "../../ui/form/controls";
import { readInteger } from "../../ui/form/integerInput";

/** 4 バイトの属性。 */
export type AttributeBytes = [number, number, number, number];

/** 属性の欄が使う窓口。 */
export interface AttributePanelHost {
  /** 値を変えてよいか（false なら前の値に戻す。表の最後のブロックを 3 層にするときなど）。 */
  accept(next: AttributeBytes, prev: AttributeBytes): boolean;
  /** 値が変わった（3 層の 4 マスの出し入れ）。 */
  changed(): void;
}

/**
 * 右の「マップアクションデータ」（AdvanceMap の ScrollBox_VerhaltenDaten）。属性 4 バイトを 16 進 2 桁の 4 欄で出す。
 * 上の 2 欄が 0・1 バイト目（マップアクション/属性）、下の 2 欄が 2・3 バイト目（不明/マップの効果）。
 * 0 バイト目は挙動のコンボ（[Verhalten_FRLG]）、3 バイト目は背景のコンボ（[Hintergrund_FRLG]）と連動する。
 * 16 進でない文字を入れると、AdvanceMap と同じ「'$zz' is not a valid integer value.」を出す（空欄・桁違いは黙って受け付ける）。
 * 3 バイト目の上位 4 ビットが 5〜7（重ね方の値。実機ではそのマスを描かない）なら、コンボの下に注意を出す。
 */
export class AttributePanel {
  readonly element: HTMLElement;
  /** 欄の並び（バイトの順）。 */
  readonly fields: readonly [HTMLInputElement, HTMLInputElement, HTMLInputElement, HTMLInputElement];
  readonly behavior: HTMLSelectElement;
  readonly background: HTMLSelectElement;
  /** 重ね方が実機で描かれない値のときの注意。 */
  readonly warning: HTMLElement;
  private readonly values: AttributeBytes = [0, 0, 0, 0];

  constructor(private readonly host: AttributePanelHost) {
    this.element = place(document.createElement("div"), 561, 0, 264, 233);
    this.element.className += " be-scroll be-attributes";
    const title = label(t.actionData, 8, 8);
    title.classList.add("be-heading");
    const hint = label(t.actionHint, 8, 32);
    hint.classList.add("be-small");
    const action = label(t.actionPair, 8, 64);
    const bg = label(t.backgroundPair, 8, 144);
    action.classList.add("be-small");
    bg.classList.add("be-small");
    this.fields = [edit("be.attr0", 8, 80, 33), edit("be.attr1", 48, 80, 33), edit("be.attr2", 8, 160, 33), edit("be.attr3", 48, 160, 33)];
    this.behavior = combo("be.behavior", t.behaviors, 8, 104, 249);
    this.background = combo("be.background", t.backgrounds, 8, 184, 249);
    this.warning = autoId(label(t.undrawnLayer, 8, 210, 249), "be.layerWarning");
    this.warning.classList.add("be-small", "be-warning");
    this.element.append(title, hint, action, bg, ...this.fields, this.behavior, this.background, this.warning);

    this.fields.forEach((field, i) => {
      field.maxLength = 2;
      field.addEventListener("input", () => this.onInput(i));
    });
    this.behavior.addEventListener("change", () => this.setByte(0, this.behavior.selectedIndex));
    this.background.addEventListener("change", () => this.setByte(3, this.background.selectedIndex));
    this.show([0, 0, 0, 0]);
  }

  /** 4 バイトを出す（ブロックを選んだとき）。 */
  show(bytes: readonly number[]): void {
    for (let i = 0; i < 4; i++) {
      this.values[i] = (bytes[i] ?? 0) & 0xff;
      this.fields[i]!.value = hexText(this.values[i]!, 2);
    }
    this.syncCombos();
  }

  /** 今の 4 バイト（欄が読めないときは最後に読めた値）。 */
  bytes(): AttributeBytes {
    return [...this.values];
  }

  private setByte(index: number, value: number): void {
    if (value < 0) return;
    if (!this.change(index, value)) return;
    this.fields[index]!.value = hexText(this.values[index]!, 2);
  }

  /** 1 バイトを変える。窓口が拒んだら前の値を欄とコンボに戻して false。 */
  private change(index: number, value: number): boolean {
    const prev = this.bytes();
    const next = this.bytes();
    next[index] = value & 0xff;
    if (!this.host.accept(next, prev)) {
      this.fields[index]!.value = hexText(prev[index]!, 2);
      this.syncCombos();
      return false;
    }
    this.values[index] = next[index]!;
    this.syncCombos();
    this.host.changed();
    return true;
  }

  private onInput(index: number): void {
    const text = this.fields[index]!.value.trim();
    // 空欄・マイナスは AdvanceMap でもエラーにならない（値は変えない）。
    if (text === "" || text === "-" || /^-\d*$/.test(text)) return;
    const value = readInteger(text.replace(/^\$/, ""), "hex");
    if (value === null) return;
    this.change(index, value);
  }

  private syncCombos(): void {
    this.behavior.selectedIndex = this.values[0]!;
    this.background.selectedIndex = this.values[3]!;
    this.warning.hidden = !isUndrawnLayerMode((this.values[3]! >> 4) & 7);
  }
}
