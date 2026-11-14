import { BLOCK_PIXELS, createImage } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { MixingBag } from "../../app/MixingBag";
import { jaPaint } from "../../i18n/ja.paint";

/**
 * ミキシングバッグの中身（#236。ブロックパレットの下）。袋に入れたブロックを並べ、Ctrl＋クリックで空にする。
 * 袋が空なら隠す。袋を使うときは枠を色で示す。
 */
export class MixingBagView {
  readonly element: HTMLElement;
  private readonly label: HTMLElement;
  private readonly row: HTMLElement;

  constructor(
    private readonly state: EditorState,
    private readonly bag: MixingBag,
  ) {
    this.element = document.createElement("div");
    this.element.className = "mixing-bag";
    this.element.dataset["autoId"] = "map.bag";
    this.element.title = jaPaint.bagHint;
    this.label = document.createElement("div");
    this.label.className = "mixing-bag-label";
    this.row = document.createElement("div");
    this.row.className = "mixing-bag-blocks";
    this.element.append(this.label, this.row);
    this.element.addEventListener("click", (e) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      bag.clear();
      state.setStatus(jaPaint.bagCleared);
    });
    bag.onChange(() => this.render());
    state.on("map", () => this.render());
    state.on("tiles", () => this.render());
    state.on("selection", () => this.render());
    this.render();
  }

  private render(): void {
    const blocks = this.bag.blocks;
    this.element.hidden = blocks.length === 0;
    this.element.classList.toggle("active", this.bag.appliesTo(this.state.selection));
    this.label.textContent = jaPaint.bagLabel(blocks.length);
    const tiles = this.state.map?.tiles;
    this.row.replaceChildren(
      ...blocks.map((b) => {
        const c = document.createElement("canvas");
        c.width = BLOCK_PIXELS;
        c.height = BLOCK_PIXELS;
        c.title = `${b.toString(16).toUpperCase().padStart(3, "0")}`;
        if (tiles) {
          const image = createImage(BLOCK_PIXELS, BLOCK_PIXELS);
          tiles.renderer.blit(b, image.data, image.width, 0, 0);
          c.getContext("2d")!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        }
        return c;
      }),
    );
  }
}
