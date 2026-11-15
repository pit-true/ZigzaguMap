import { autoId } from "../../ui/form/controls";

/**
 * ブロックエディタの窓の下の 1 行（#393。ZigzaguMap だけの欄）。AdvanceMap の配置の下に足し、上の部品の位置は変えない。
 * マウスを乗せている間はホバーの情報（タイル番号・パレット・反転）を左に、最後の案内をその右に出す。
 */
export class BlockEditorStatus {
  readonly element: HTMLElement;
  private message = "";
  private hovering: string | null = null;

  constructor() {
    this.element = autoId(document.createElement("div"), "be.status");
    this.element.className = "be-status";
  }

  /** 案内を出す（空なら消す）。 */
  show(message: string): void {
    this.message = message;
    this.render();
  }

  /** ホバーの情報を出す（null で案内に戻す）。 */
  hover(text: string | null): void {
    this.hovering = text;
    this.render();
  }

  /** 今の文。 */
  get text(): string {
    return this.element.textContent ?? "";
  }

  private render(): void {
    this.element.textContent = [this.hovering, this.message].filter((v) => v).join("　／　");
  }
}
