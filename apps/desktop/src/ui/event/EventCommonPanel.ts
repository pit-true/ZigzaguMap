import { ja } from "../../i18n/ja";
import { CheckBox, ComboBox, SpinEdit, formRow, pushButton } from "../form/controls";
import { KIND_ORDER, type UiKind } from "./eventModel";

/** 共通部の操作の受け手。 */
export interface CommonPanelHandlers {
  kind(kind: UiKind): void;
  number(index: number): void;
  cursor(visible: boolean): void;
  remove(): void;
}

/**
 * 右パネルの共通部（AdvanceMap の ScrollBox_EventOptions）: 種別コンボ、イベント番号、カーソルの表示、イベントの削除。
 * イベント番号は 0〜個数-1。フライトポジションと 0 件の種別では番号と削除を無効にする。
 */
export class EventCommonPanel {
  readonly element: HTMLElement;
  private readonly kindBox: ComboBox;
  private readonly numberBox: SpinEdit;
  private readonly cursorBox: CheckBox;
  private readonly removeButton: HTMLButtonElement;

  constructor(handlers: CommonPanelHandlers) {
    this.element = document.createElement("div");
    this.element.className = "event-common";
    this.kindBox = new ComboBox("event.kind", ja.event.kinds, 129, (i) => handlers.kind(KIND_ORDER[i]!));
    this.numberBox = new SpinEdit({ id: "event.number", min: 0, max: 0, onValue: (v) => handlers.number(v) });
    this.cursorBox = new CheckBox("event.cursor", ja.event.showCursor, (on) => handlers.cursor(on));
    this.cursorBox.set(1);
    this.removeButton = pushButton("event.remove", ja.event.remove, () => handlers.remove(), "wide-button");
    const kindRow = document.createElement("div");
    kindRow.className = "form-row";
    kindRow.append(this.kindBox.element);
    this.element.append(kindRow, formRow(ja.event.number, 80, this.numberBox), this.cursorBox.element, this.removeButton);
  }

  /** 選択を表示する。`count` は選んだ種別の個数。 */
  show(kind: UiKind, index: number, count: number): void {
    this.kindBox.set(KIND_ORDER.indexOf(kind));
    const usable = kind !== "fly" && count > 0;
    this.numberBox.setRange(0, Math.max(0, count - 1));
    this.numberBox.set(usable ? index : 0);
    this.numberBox.setEnabled(usable);
    this.removeButton.disabled = !usable;
  }
}
