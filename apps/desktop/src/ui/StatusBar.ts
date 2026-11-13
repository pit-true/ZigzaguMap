/** 下部のステータスバー。 */
export class StatusBar {
  readonly element: HTMLElement;

  constructor(initial: string) {
    this.element = document.createElement("footer");
    this.element.className = "status-bar";
    this.element.setAttribute("role", "status");
    this.element.textContent = initial;
  }

  /** 表示する文を変える。`isError` なら目立たせる。 */
  set(text: string, isError = false): void {
    this.element.textContent = text;
    this.element.classList.toggle("error", isError);
  }
}
