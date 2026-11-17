import { BLOCK_PIXELS, createImage } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { MixingBag } from "../../app/MixingBag";
import { isTyping, modalOpen } from "../../input/keyGuards";
import { jaPaint } from "../../i18n/ja.paint";

/**
 * ミキシングバッグの中身（#236。ブロックパレットの下）。袋に入れたブロックを並べ、Ctrl＋クリックで空にする。
 * 袋が空なら隠す。袋を使うときは枠を色で示す。
 * Phase7 #515: 各ブロックの右下に重み（1〜9）を出す。ブロックの上でホイールを回すか、マウスを乗せて数字キー（1〜9）を押すと変わる。
 * 部品の ID は `map.bag` と、ブロックごとの `map.bag.<番号>`（10 進）。
 */
export class MixingBagView {
  readonly element: HTMLElement;
  private readonly label: HTMLElement;
  private readonly row: HTMLElement;
  /** マウスが乗っているブロック（数字キーで重みを変える）。 */
  private hovered: number | null = null;

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
    document.addEventListener("keydown", (e) => {
      if (this.hovered === null || e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey || modalOpen() || isTyping(e.target)) return;
      if (!/^[1-9]$/.test(e.key)) return;
      e.preventDefault();
      this.setWeight(this.hovered, Number(e.key));
    });
    bag.onChange(() => this.render());
    state.on("map", () => this.render());
    state.on("tiles", () => this.render());
    state.on("selection", () => this.render());
    this.render();
  }

  private setWeight(block: number, weight: number): void {
    this.bag.setWeight(block, weight);
    this.state.setStatus(jaPaint.bagWeight(block, this.bag.weightOf(block)));
  }

  private render(): void {
    const blocks = this.bag.blocks;
    this.element.hidden = blocks.length === 0;
    this.element.classList.toggle("active", this.bag.appliesTo(this.state.selection));
    this.label.textContent = jaPaint.bagLabel(blocks.length);
    if (this.hovered !== null && !blocks.includes(this.hovered)) this.hovered = null;
    const tiles = this.state.map?.tiles;
    this.row.replaceChildren(
      ...blocks.map((b) => {
        const item = document.createElement("div");
        item.className = "mixing-bag-item";
        item.dataset["autoId"] = `map.bag.${b}`;
        item.title = jaPaint.bagItemHint(b);
        const c = document.createElement("canvas");
        c.width = BLOCK_PIXELS;
        c.height = BLOCK_PIXELS;
        if (tiles) {
          const image = createImage(BLOCK_PIXELS, BLOCK_PIXELS);
          tiles.renderer.blit(b, image.data, image.width, 0, 0);
          c.getContext("2d")!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
        }
        const weight = document.createElement("span");
        weight.className = "mixing-bag-weight";
        weight.textContent = String(this.bag.weightOf(b));
        item.append(c, weight);
        item.addEventListener("pointermove", () => (this.hovered = b));
        item.addEventListener("pointerleave", () => {
          if (this.hovered === b) this.hovered = null;
        });
        item.addEventListener(
          "wheel",
          (e) => {
            if (e.ctrlKey || e.deltaY === 0) return;
            e.preventDefault();
            this.setWeight(b, this.bag.weightOf(b) + (e.deltaY < 0 ? 1 : -1));
          },
          { passive: false },
        );
        return item;
      }),
    );
  }
}
