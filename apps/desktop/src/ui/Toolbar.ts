import { ja } from "../i18n/ja";

/** 上部のツールバー（ROM を開くボタン）。 */
export class Toolbar {
  readonly element: HTMLElement;

  constructor(onOpen: () => void) {
    this.element = document.createElement("header");
    this.element.className = "toolbar";
    const open = document.createElement("button");
    open.type = "button";
    open.textContent = ja.openRom;
    open.addEventListener("click", onOpen);
    this.element.append(open);
  }
}
