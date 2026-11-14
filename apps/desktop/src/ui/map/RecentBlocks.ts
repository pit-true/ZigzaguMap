import { BLOCK_PIXELS, PRIMARY_BLOCK_COUNT } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { TilesetView } from "../../app/TilesetView";
import { jaPaletteInfo as t } from "../../i18n/ja.paletteInfo";
import "../../styles/recentBlocks.css";
import { blockInfoSource, blockInfoText } from "./blockInfo";

/** 最近使ったブロックの数。 */
export const RECENT_BLOCK_COUNT = 8;

/** 1 件（どのタイルセットのブロックかも持つ。組が変わったら、その組で使えないものを消すため）。 */
export interface RecentBlock {
  readonly block: number;
  /** ブロックの持ち主のタイルセット（主なら主、副なら副のポインタ）。 */
  readonly tileset: number;
}

/**
 * 最近使ったブロックの並び（#308。新しいものが先頭、8 件まで、同じものは前から消す）。DOM を使わない。
 * 3 層のブロックは 1 件として持つ（見せるときに次の番号と 2 マス分で描く）。
 */
export class RecentBlockList {
  private items: RecentBlock[] = [];

  get list(): readonly RecentBlock[] {
    return this.items;
  }

  /** 先頭に足す。 */
  push(item: RecentBlock): void {
    this.items = [item, ...this.items.filter((i) => i.block !== item.block || i.tileset !== item.tileset)].slice(0, RECENT_BLOCK_COUNT);
  }

  /** 今の組（主・副のポインタとブロック数）で使えないもの（持ち主のタイルセットが違う・表の外・3 層の次の番号）を消す。 */
  keepUsable(primary: number, secondary: number, count: number, isTripleChild: (block: number) => boolean): void {
    this.items = this.items.filter((i) => i.tileset === (i.block < PRIMARY_BLOCK_COUNT ? primary : secondary) && i.block < count && !isTripleChild(i.block));
  }

  clear(): void {
    this.items = [];
  }
}

/** 主・副のどちらのタイルセットのブロックか（ポインタ）。 */
function ownerOf(state: EditorState, block: number): number | null {
  const doc = state.map?.doc;
  if (!doc) return null;
  return (block < PRIMARY_BLOCK_COUNT ? doc.primaryTileset : doc.secondaryTileset) >>> 0;
}

/**
 * マップタブの右の欄の「最近使ったブロック」（#308。Bochi の最近使ったブロック）。
 * パレットで選んだブロックとスポイトで拾ったブロック（1 つだけ選んだとき）を並べ、押すと選び直す（パレットの選択も動く）。
 * マップのタイルセットの組が変わったら、その組で使えないものは消す。
 */
export class RecentBlocksView {
  readonly element: HTMLElement;
  readonly model = new RecentBlockList();
  private readonly canvas: HTMLCanvasElement;
  private readonly empty: HTMLElement;
  /** 描いた位置（押したときにどの件かを引く）。 */
  private spots: { x: number; w: number; block: number }[] = [];
  private tilesKey = "";

  constructor(
    private readonly state: EditorState,
    private readonly scrollPalette: () => void,
  ) {
    this.element = document.createElement("div");
    this.element.className = "recent-blocks";
    this.element.dataset["autoId"] = "map.recent";
    this.element.title = t.recentHint;
    const label = document.createElement("div");
    label.className = "recent-blocks-label";
    label.textContent = t.recentTitle;
    this.canvas = document.createElement("canvas");
    this.canvas.dataset["autoId"] = "map.recent.canvas";
    this.empty = document.createElement("span");
    this.empty.className = "recent-blocks-empty";
    this.empty.textContent = t.recentEmpty;
    this.element.append(label, this.canvas, this.empty);
    this.canvas.addEventListener("click", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) * (this.canvas.width / r.width);
      const hit = this.spots.find((s) => x >= s.x && x < s.x + s.w);
      if (hit) this.pick(hit.block);
    });
    this.canvas.addEventListener("mousemove", (e) => {
      const r = this.canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) * (this.canvas.width / r.width);
      const hit = this.spots.find((s) => x >= s.x && x < s.x + s.w);
      const tiles = this.state.map?.tiles;
      this.state.setStatusInfo(hit && tiles ? blockInfoText(blockInfoSource(tiles), hit.block) : "");
    });
    this.canvas.addEventListener("mouseleave", () => this.state.setStatusInfo(""));
    state.on("selection", () => this.onSelection());
    state.on("map", () => this.onTiles());
    state.on("tiles", () => this.draw());
    state.on("session", () => {
      this.model.clear();
      this.draw();
    });
    this.draw();
  }

  /** 押したのと同じ（そのブロックを 1 つ選ぶ）。 */
  pick(block: number): void {
    this.state.selectBlock(block);
    this.scrollPalette();
  }

  private onSelection(): void {
    const s = this.state.selection;
    if (s.width === 1 && s.height === 1) this.addSingle(s.blocks[0] ?? 0);
  }

  private addSingle(block: number): void {
    const owner = ownerOf(this.state, block);
    if (owner === null) return;
    this.model.push({ block, tileset: owner });
    this.draw();
  }

  /** マップの組が変わったら、使えないものを消す。 */
  private onTiles(): void {
    const map = this.state.map;
    if (!map) return;
    if (map.tiles.key !== this.tilesKey) {
      this.tilesKey = map.tiles.key;
      this.model.keepUsable(map.doc.primaryTileset >>> 0, map.doc.secondaryTileset >>> 0, map.tiles.paletteBlockCount, (b) => map.tiles.triple.isTripleChild(b));
    }
    this.draw();
  }

  private draw(): void {
    const tiles: TilesetView | null = this.state.map?.tiles ?? null;
    const list = tiles ? this.model.list : [];
    this.spots = [];
    let x = 0;
    for (const item of list) {
      const third = tiles!.triple.thirdOf(item.block);
      const w = (third !== null ? 2 : 1) * BLOCK_PIXELS;
      this.spots.push({ x, w, block: item.block });
      x += w + 2;
    }
    this.canvas.width = Math.max(1, x - 2);
    this.canvas.height = BLOCK_PIXELS;
    this.canvas.hidden = list.length === 0;
    this.empty.hidden = list.length > 0;
    if (!tiles || list.length === 0) return;
    const c = this.canvas.getContext("2d")!;
    const image = new ImageData(this.canvas.width, BLOCK_PIXELS);
    for (const s of this.spots) {
      tiles.renderer.blit(s.block, image.data, image.width, s.x, 0);
      const third = tiles.triple.thirdOf(s.block);
      if (third !== null) tiles.renderer.blit(third, image.data, image.width, s.x + BLOCK_PIXELS, 0);
    }
    c.putImageData(image, 0, 0);
    // 3 層は 2 マス分を 1 つの枠で囲む
    c.strokeStyle = "rgba(0, 0, 0, 0.6)";
    for (const s of this.spots) if (s.w > BLOCK_PIXELS) c.strokeRect(s.x + 0.5, 0.5, s.w - 1, BLOCK_PIXELS - 1);
  }
}
