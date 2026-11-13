import type { GameInfo } from "@zigzagumap/core";
import { ja } from "../i18n/ja";

/** 左下の ROM 情報（ゲーム名、ROMタイプ、言語、ROMバージョン）。 */
export class RomInfoPanel {
  readonly element: HTMLElement;
  private readonly values: HTMLElement[] = [];

  constructor() {
    this.element = document.createElement("div");
    this.element.className = "rom-info";
    for (const label of [ja.romInfoName, ja.romInfoType, ja.romInfoLanguage, ja.romInfoVersion]) {
      const name = document.createElement("span");
      name.textContent = label;
      const value = document.createElement("span");
      this.values.push(value);
      this.element.append(name, value);
    }
  }

  /** ROM の情報を出す（null で空にする）。 */
  show(game: GameInfo | null): void {
    const texts = game
      ? [game.title, game.code.slice(0, 3), game.code.slice(3), `1.${game.revision}`]
      : ["", "", "", ""];
    this.values.forEach((v, i) => (v.textContent = texts[i] ?? ""));
  }
}
