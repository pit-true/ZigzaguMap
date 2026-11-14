import { SetEventFieldsCommand, type MapId } from "@zigzagumap/core";
import { jaScriptLabel } from "../../../i18n/ja.scriptLabel";
import { ScriptLabelField, type ScriptLabelSource } from "../../script/ScriptLabelField";
import { CheckBox, ComboBox, HexInput, SpinEdit, formLabel, formRow, type ValueControl } from "../../form/valueControls";
import type { EventEditor } from "../EventEditor";

/** スクリプトを持つイベントの種別。 */
export type ScriptEventKind = "person" | "sign" | "trap";

/** 項目名 → 書く値（core のコマンドの fields）。 */
export type FieldPatch = Record<string, number | boolean>;

/** 種別ごとのパネルが使う、タブ側の機能。 */
export interface PanelHost {
  readonly editor: EventEditor;
  /** 表示中のマップ。 */
  mapId(): MapId | null;
  /** 「スクリプトを開く」（ラベルが付いていればエディタのその行、素の ROM のスクリプトなら読み取り専用の表示）。 */
  openScript(kind: ScriptEventKind, index: number): void;
  /** スクリプトのラベルの欄の中身（`index` は表示中のイベントの番号）。 */
  labelSource(kind: ScriptEventKind, index: () => number | null): ScriptLabelSource;
  /** 「マップの移動」。 */
  goTo(bank: number, map: number, warpId: number): void;
}

/** スクリプトのラベルの欄と、表示を合わせる関数（ラベルが付いていれば true）。 */
export interface LabelPart {
  readonly field: ScriptLabelField;
  update(hide?: boolean): boolean;
}

/** 欄と、イベントから値を読む関数の組。 */
interface Binding<E> {
  readonly control: ValueControl;
  read(event: E): number | null;
}

/** 1 バイトの欄の値を、2 バイトの項目の下位・上位に書き戻す。 */
export function withByte(word: number, byte: number, high: boolean): number {
  return high ? (word & 0x00ff) | ((byte & 0xff) << 8) : (word & 0xff00) | (byte & 0xff);
}

/**
 * スクリプトのオフセット欄の値をポインタに書き戻す。AdvanceMap は下位 3 バイトだけを書き、上位 1 バイトは元のまま。
 * 元が 0（増やしたばかりのイベント）のときは、ROM を指すよう 0x08 にする。
 */
export function withScriptOffset(pointer: number, offset: number): number {
  const high = pointer >>> 24 || (offset & 0xffffff ? 0x08 : 0);
  return ((high << 24) | (offset & 0xffffff)) >>> 0;
}

/**
 * 種別ごとの編集パネル（AdvanceMap の Frame_People1 など）の土台。
 * 派生クラスは欄を作り（hex / spin / combo / check）、`commit` でコマンドを実行する。
 * 欄の値は入力のたびにコマンドになる。値はマスクして書く（AdvanceMap と同じく 16 進欄はあふれた桁を切り捨てる）。
 */
export abstract class KindPanel<E> {
  readonly element: HTMLElement;
  private readonly bindings: Binding<E>[] = [];
  protected current: { readonly event: E; readonly index: number } | null = null;

  constructor(
    protected readonly host: PanelHost,
    /** 自動操作の ID の頭（`event.person` など）。 */
    protected readonly idPrefix: string,
    className: string,
  ) {
    this.element = document.createElement("div");
    this.element.className = `event-frame ${className}`;
    this.element.addEventListener("focusout", () => host.editor.endSession());
  }

  /** イベントを表示する。 */
  show(event: E, index: number): void {
    this.current = { event, index };
    for (const b of this.bindings) b.control.set(b.read(event));
    this.afterShow(event);
  }

  /** 表示の後に、種別ごとに見た目を切り替える（看板の隠しアイテムなど）。 */
  protected afterShow(_event: E): void {}

  /** 値を書くコマンドを実行する。 */
  protected abstract commit(index: number, fields: FieldPatch, key: string): void;

  /** 欄の値を、いま表示中のイベントへ書く。 */
  protected write(id: string, patch: (event: E) => FieldPatch): void {
    const c = this.current;
    if (!c) return;
    this.commit(c.index, patch(c.event), `${this.idPrefix}.${c.index}.${id}`);
  }

  /** 1 行（ラベルと部品）を足す。 */
  protected row(label: string, labelWidth: number, ...controls: (ValueControl | HTMLElement)[]): HTMLElement {
    const row = formRow(label, labelWidth, ...controls);
    this.element.append(row);
    return row;
  }

  /**
   * スクリプトのラベルの欄（見出しと欄の 2 行）を足す。プロジェクトフォルダを開いているときだけ見える。
   * 返す `rows` は、見せる・隠すを切り替える行。
   */
  protected labelField(kind: ScriptEventKind): LabelPart {
    const field = new ScriptLabelField(
      this.host.labelSource(kind, () => this.current?.index ?? null),
      `${this.idPrefix}.label`,
    );
    const caption = formLabel(jaScriptLabel.caption);
    const row = document.createElement("div");
    row.className = "form-row";
    row.append(field.element);
    this.element.append(caption, row);
    return {
      field,
      update: (hide = false) => {
        field.show();
        const on = !hide && !field.element.hidden;
        caption.hidden = !on;
        row.hidden = !on;
        return on && field.hasLabel;
      },
    };
  }

  /** 16 進欄。`bits` で書く値をマスクする。 */
  protected hex(
    id: string,
    digits: number,
    width: number,
    read: (e: E) => number,
    patch: (e: E, value: number) => FieldPatch,
    options: { prefix?: string; maxLength?: number; bits?: number } = {},
  ): HexInput {
    const mask = options.bits === undefined || options.bits >= 32 ? 0xffffffff : 2 ** options.bits - 1;
    const control = new HexInput({
      id: `${this.idPrefix}.${id}`,
      digits,
      width,
      ...(options.prefix !== undefined ? { prefix: options.prefix } : {}),
      ...(options.maxLength !== undefined ? { maxLength: options.maxLength } : {}),
      onValue: (v) => this.write(id, (e) => patch(e, (v & mask) >>> 0)),
      onError: (e) => this.host.editor.inputError(e),
    });
    this.bindings.push({ control, read });
    return control;
  }

  /** 10 進のスピン（0〜255）。 */
  protected spin(id: string, read: (e: E) => number, patch: ((e: E, value: number) => FieldPatch) | null, width = 49): SpinEdit {
    const control = new SpinEdit({
      id: `${this.idPrefix}.${id}`,
      min: 0,
      max: 255,
      width,
      readOnly: patch === null,
      ...(patch ? { onValue: (v: number) => this.write(id, (e) => patch(e, v)) } : {}),
      onError: (e) => this.host.editor.inputError(e),
    });
    this.bindings.push({ control, read });
    return control;
  }

  /** コンボボックス（選んだ添字を値として書く）。 */
  protected combo(id: string, options: readonly string[], width: number, read: (e: E) => number | null, patch: (e: E, index: number) => FieldPatch): ComboBox {
    const control = new ComboBox(`${this.idPrefix}.${id}`, options, width, (i) => this.write(id, (e) => patch(e, i)));
    this.bindings.push({ control, read });
    return control;
  }

  /** チェックボックス。 */
  protected check(id: string, read: (e: E) => number, patch: (e: E, checked: boolean) => FieldPatch): CheckBox {
    const control = new CheckBox(`${this.idPrefix}.${id}`, "", (on) => this.write(id, (e) => patch(e, on)));
    this.bindings.push({ control, read });
    return control;
  }
}

/** マップのイベントの表にある種別（人・看板・ワープ・スクリプト）のパネルの土台。 */
export abstract class ListKindPanel<E> extends KindPanel<E> {
  constructor(
    host: PanelHost,
    private readonly kind: "person" | "sign" | "warp" | "trap",
    className: string,
  ) {
    super(host, `event.${kind}`, className);
  }

  protected override commit(index: number, fields: FieldPatch, key: string): void {
    const id = this.host.mapId();
    if (!id) return;
    this.host.editor.run(new SetEventFieldsCommand({ ...id, kind: this.kind, index, fields }), key);
  }
}
