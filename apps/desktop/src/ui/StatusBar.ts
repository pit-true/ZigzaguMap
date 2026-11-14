import type { StatusText } from "../app/EditorState";

/**
 * 下部のステータスバー（左は操作中の情報、補助の欄、右は読込時間やノート）。補助の欄（#238）は AdvanceMap に無いもので、
 * ブロックの番号・移動許可・挙動、矩形の大きさ、隣のマップの座標を出す（空なら隠す）。
 */
export class StatusBar {
  readonly element: HTMLElement;
  private readonly left: HTMLElement;
  private readonly right: HTMLElement;
  private readonly info: HTMLElement;

  constructor() {
    this.element = document.createElement("footer");
    this.element.className = "status-bar";
    this.element.setAttribute("role", "status");
    this.left = document.createElement("div");
    this.left.className = "status-panel status-left";
    this.right = document.createElement("div");
    this.right.className = "status-panel status-right";
    this.info = document.createElement("div");
    this.info.className = "status-panel status-info";
    this.info.dataset["autoId"] = "status.info";
    this.info.hidden = true;
    this.element.append(this.left, this.info, this.right);
  }

  /** 状態を描く。 */
  render(status: StatusText, info = ""): void {
    this.left.textContent = status.left;
    this.info.textContent = info;
    this.info.hidden = info === "";
    this.right.textContent = status.right;
    this.left.classList.toggle("error", status.error);
  }
}
