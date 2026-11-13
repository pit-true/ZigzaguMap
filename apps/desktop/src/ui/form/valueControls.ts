import { EditError } from "@zigzagumap/core";
import "../../styles/valueControls.css";
import { hex } from "../../i18n/ja";
import { parseInteger } from "./integerInput";

/**
 * AdvanceMap の入力部品（TEdit の 16 進欄、TSpinEdit、TComboBox、TCheckBox）の再現。
 * どれも入力のたびに値を読んで知らせる（AdvanceMap の OnChange と同じく確定ボタンは無い）。読み方は integerInput と共通。
 * 実際の入力要素には `data-auto-id` に部品の ID を付ける（自動操作の入口から読み書き・クリックするため）。
 */

/** 値を出す部品。 */
export interface ValueControl {
  readonly element: HTMLElement;
  /** 値を表示する（入力中の欄は書き換えない）。null は空欄・選択なし。 */
  set(value: number | null): void;
  /** 有効・無効（灰色）。 */
  setEnabled(enabled: boolean): void;
}

/** 読めない入力のとき（EditError の文字列）。 */
export type InputErrorHandler = (error: EditError) => void;

/** 16 進欄の作り方。 */
export interface HexInputOptions {
  readonly id: string;
  /** 表示の桁数。 */
  readonly digits: number;
  /** 欄の幅（px）。 */
  readonly width: number;
  /** 表示の前に付ける文字（スクリプトのオフセットは `$`）。 */
  readonly prefix?: string;
  /** 入力できる文字数（AdvanceMap のフライトポジションの欄だけ 4）。 */
  readonly maxLength?: number;
  readonly onValue: (value: number) => void;
  readonly onError: InputErrorHandler;
}

/** 16 進の入力欄（`$` を前に付けて整数として読む。空欄は 0）。 */
export class HexInput implements ValueControl {
  readonly element: HTMLInputElement;

  constructor(private readonly options: HexInputOptions) {
    const input = document.createElement("input");
    input.type = "text";
    input.className = "hex-input";
    input.spellcheck = false;
    input.style.width = `${options.width}px`;
    input.dataset["autoId"] = options.id;
    if (options.maxLength) input.maxLength = options.maxLength;
    input.addEventListener("input", () => this.commit());
    this.element = input;
  }

  set(value: number | null): void {
    if (document.activeElement === this.element) return;
    this.element.value = value === null ? "" : (this.options.prefix ?? "") + hex(value >>> 0, this.options.digits);
  }

  setEnabled(enabled: boolean): void {
    this.element.disabled = !enabled;
  }

  private commit(): void {
    let value: number;
    try {
      value = parseInteger(this.element.value, "hex");
    } catch (e) {
      if (e instanceof EditError) return this.options.onError(e);
      throw e;
    }
    this.options.onValue(value);
  }
}

/** スピン付きの 10 進欄の作り方。 */
export interface SpinEditOptions {
  readonly id: string;
  readonly min: number;
  readonly max: number;
  /** 欄の幅（ボタンを含む、px）。 */
  readonly width?: number;
  /** 表示だけ（人 No. など）。 */
  readonly readOnly?: boolean;
  readonly onValue?: (value: number) => void;
  readonly onError?: InputErrorHandler;
}

/**
 * TSpinEdit（10 進、上下のボタンつき）。範囲外の値は範囲の端に丸める（AdvanceMap は 300 を 255 として扱う）。
 * 数字以外のキーは受け付けない。空欄のあいだは値を変えない。
 */
export class SpinEdit implements ValueControl {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly buttons: HTMLButtonElement[];
  private value = 0;
  private min: number;
  private max: number;

  constructor(private readonly options: SpinEditOptions) {
    this.min = options.min;
    this.max = options.max;
    this.element = document.createElement("span");
    this.element.className = "spin-edit";
    this.element.style.width = `${options.width ?? 49}px`;
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.spellcheck = false;
    this.input.dataset["autoId"] = options.id;
    this.input.readOnly = options.readOnly === true;
    const up = spinButton("▲", () => this.step(1));
    const down = spinButton("▼", () => this.step(-1));
    this.buttons = [up, down];
    const arrows = document.createElement("span");
    arrows.className = "spin-arrows";
    arrows.append(up, down);
    this.element.append(this.input, arrows);
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        e.preventDefault();
        this.step(e.key === "ArrowUp" ? 1 : -1);
      } else if (e.key.length === 1 && !/[0-9-]/.test(e.key) && !e.ctrlKey) {
        e.preventDefault();
      }
    });
    this.input.addEventListener("input", () => this.commit());
    // 確定したとき（Enter・フォーカスを外したとき）は、丸めた値を表示し直す。
    const reformat = (): void => {
      this.input.value = String(this.value);
    };
    this.input.addEventListener("change", reformat);
    this.input.addEventListener("blur", reformat);
  }

  /** 範囲を変える（イベント番号は種別の個数で変わる）。 */
  setRange(min: number, max: number): void {
    this.min = min;
    this.max = Math.max(min, max);
  }

  set(value: number | null): void {
    this.value = value ?? 0;
    if (document.activeElement === this.input) return;
    this.input.value = String(this.value);
  }

  setEnabled(enabled: boolean): void {
    this.input.disabled = !enabled;
    for (const b of this.buttons) b.disabled = !enabled;
    this.element.classList.toggle("disabled", !enabled);
  }

  private step(delta: number): void {
    if (this.input.disabled || this.options.readOnly) return;
    const next = Math.min(this.max, Math.max(this.min, this.value + delta));
    if (next === this.value) return;
    this.value = next;
    this.input.value = String(next);
    this.options.onValue?.(next);
  }

  private commit(): void {
    const text = this.input.value;
    if (text.trim() === "" || this.options.readOnly) return;
    let n: number;
    try {
      n = parseInteger(text, "int");
    } catch (e) {
      if (e instanceof EditError && this.options.onError) return this.options.onError(e);
      if (e instanceof EditError) return;
      throw e;
    }
    this.value = Math.min(this.max, Math.max(this.min, n));
    this.options.onValue?.(this.value);
  }
}

function spinButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.tabIndex = -1;
  b.textContent = text;
  b.addEventListener("pointerdown", (e) => e.preventDefault());
  b.addEventListener("click", onClick);
  return b;
}

/** コンボボックス（選んだ添字を知らせる）。 */
export class ComboBox implements ValueControl {
  readonly element: HTMLSelectElement;

  constructor(id: string, options: readonly string[], width: number, onIndex: (index: number) => void) {
    this.element = document.createElement("select");
    this.element.className = "combo";
    this.element.style.width = `${width}px`;
    this.element.dataset["autoId"] = id;
    this.setOptions(options);
    this.element.addEventListener("change", () => {
      if (this.element.selectedIndex >= 0) onIndex(this.element.selectedIndex);
    });
  }

  /** 選択肢を入れ替える。 */
  setOptions(options: readonly string[]): void {
    const fragment = document.createDocumentFragment();
    for (const o of options) fragment.append(new Option(o));
    this.element.replaceChildren(fragment);
  }

  set(index: number | null): void {
    const i = index === null || index < 0 || index >= this.element.options.length ? -1 : index;
    if (this.element.selectedIndex !== i) this.element.selectedIndex = i;
  }

  setEnabled(enabled: boolean): void {
    this.element.disabled = !enabled;
  }
}

/** チェックボックス（ラベルつきでも、ラベル無しでも使う）。 */
export class CheckBox implements ValueControl {
  readonly element: HTMLLabelElement;
  readonly input: HTMLInputElement;

  constructor(id: string, label: string, onChange: (checked: boolean) => void) {
    this.element = document.createElement("label");
    this.element.className = "check-box";
    this.input = document.createElement("input");
    this.input.type = "checkbox";
    this.input.dataset["autoId"] = id;
    this.input.addEventListener("change", () => onChange(this.input.checked));
    this.element.append(this.input);
    if (label) this.element.append(label);
  }

  set(value: number | null): void {
    this.input.checked = (value ?? 0) !== 0;
  }

  setEnabled(enabled: boolean): void {
    this.input.disabled = !enabled;
  }
}

/** ボタン。 */
export function pushButton(id: string, text: string, onClick: () => void, className = ""): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `push-button ${className}`.trim();
  b.textContent = text;
  b.dataset["autoId"] = id;
  b.addEventListener("click", onClick);
  return b;
}

/** ラベルと部品を 1 行に並べる（ラベルの幅は `labelWidth`）。 */
export function formRow(label: string, labelWidth: number, ...controls: (ValueControl | HTMLElement)[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "form-row";
  const name = document.createElement("span");
  name.className = "form-label";
  name.style.width = `${labelWidth}px`;
  name.textContent = label;
  row.append(name, ...controls.map((c) => ("set" in c ? c.element : c)));
  return row;
}

/** ラベルだけの行（下にコンボを置く項目の見出し）。 */
export function formLabel(text: string): HTMLElement {
  const p = document.createElement("div");
  p.className = "form-row form-caption";
  p.textContent = text;
  return p;
}
