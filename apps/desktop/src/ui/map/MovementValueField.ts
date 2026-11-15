import { MOVEMENT_MAX } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaTools } from "../../i18n/ja.tools";

/** 16 進 2 桁の文字を移動許可の値にする（00〜3F でなければ null）。 */
export function parseMovementHex(text: string): number | null {
  const t = text.trim();
  if (!/^[0-9a-fA-F]{1,2}$/.test(t)) return null;
  const v = parseInt(t, 16);
  return v <= MOVEMENT_MAX ? v : null;
}

/** 移動許可の値を 16 進 2 桁にする。 */
export function movementHex(value: number): string {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

/**
 * 移動エリアタブのパレットの上の、移動許可の数値の欄（Phase5 #391）。16 進 2 桁（00〜3F）を入れると選択が変わり、
 * パレットの選択も動く。パレットで選んだときは欄の値も変わる。範囲の外の値は赤くして選択を変えない。部品の ID は `movement.value`。
 * 打っている途中の 1 桁（「4F」の「4」）では選ばない。2 桁そろったときか、1 桁のまま Enter を押したとき・欄を離れたときに選ぶ（#406）。
 */
export class MovementValueField {
  readonly element: HTMLElement;
  private readonly input: HTMLInputElement;

  constructor(
    private readonly state: EditorState,
    /** 欄で値を決めたとき（パレットを追従させる）。 */
    private readonly onPicked: () => void,
  ) {
    this.element = document.createElement("label");
    this.element.className = "movement-value";
    this.element.title = jaTools.movementValueHint;
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.maxLength = 2;
    this.input.spellcheck = false;
    this.input.dataset["autoId"] = "movement.value";
    this.input.addEventListener("input", () => this.apply(false));
    this.input.addEventListener("keydown", (e) => {
      if (e.key !== "Enter") return;
      this.apply(true);
      this.input.select();
    });
    this.input.addEventListener("blur", () => {
      this.apply(true);
      this.sync();
    });
    this.element.append(document.createTextNode(jaTools.movementValue), this.input);
    state.on("movement", () => {
      if (document.activeElement !== this.input) this.sync();
    });
    this.sync();
  }

  /** 欄の値で選ぶ。`commit` でなければ 2 桁そろうまで待つ（1 桁の間は赤くもしない）。 */
  private apply(commit: boolean): void {
    const text = this.input.value.trim();
    const v = parseMovementHex(text);
    const typing = !commit && v !== null && text.length < 2;
    this.input.classList.toggle("invalid", v === null);
    if (typing || v === null || v === this.state.movement) return;
    this.state.selectMovement(v);
    this.onPicked();
  }

  private sync(): void {
    this.input.value = movementHex(this.state.movement);
    this.input.classList.remove("invalid");
  }
}
