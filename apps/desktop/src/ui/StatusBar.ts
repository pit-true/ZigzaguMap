import type { StatusText } from "../app/EditorState";

/** 下部のステータスバー（2 欄。左は操作中の情報、右は読込時間やノート）。 */
export class StatusBar {
  readonly element: HTMLElement;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;

  constructor() {
    this.element = document.createElement("footer");
    this.element.className = "status-bar";
    this.element.setAttribute("role", "status");
    this.left = document.createElement("div");
    this.left.className = "status-panel status-left";
    this.right = document.createElement("div");
    this.right.className = "status-panel status-right";
    this.element.append(this.left, this.right);
  }

  /** 状態を描く。 */
  render(status: StatusText): void {
    this.left.textContent = status.left;
    this.right.textContent = status.right;
    this.left.classList.toggle("error", status.error);
  }
}
