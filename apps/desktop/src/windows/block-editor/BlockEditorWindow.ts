import { getCurrentWindow } from "@tauri-apps/api/window";
import { THIRD_LAYER_TILE_COUNT, attributeBytes, attributeFromBytes, isTripleLayer, packTileRef, unpackTileRef } from "@zigzagumap/core";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { askYesNo, showError } from "../../ui/MessageBox";
import { installToolAutomation } from "../toolAutomation";
import type { ToolClient } from "../ToolClient";
import { TilesetModel } from "../TilesetModel";
import { AttributePanel, type AttributeBytes } from "./AttributePanel";
import { BlockEditPanel } from "./BlockEditPanel";
import { createBlockEditorMenu } from "./BlockEditorMenu";
import { BlockListView } from "./BlockListView";
import { TilesetIo } from "./TilesetIo";
import { TileSheetView } from "./TileSheetView";
import { errorText } from "../../util/errors";

/**
 * ブロックエディタ（別ウィンドウ）。左にブロック一覧、中央にブロックの編集面とタイル一覧、右にマップアクションデータ。
 *
 * - ブロックを選ぶと、その 8 タイルと属性を手元に写して編集する（ブロック一覧とメインには「変更を保存」まで出ない）。
 * - 「変更を保存」で setBlock コマンドをメインの CommandBus で実行する（AdvanceMap は ROM へ直接書く）。
 * - メインから写しが届いたら描き直す。選んでいるブロックの確定した中身が変わったとき（アンドゥなど）だけ、手元の編集を捨てて読み直す。
 * - 3 層のブロック（属性のビット 28〜30 が 3）は、3 層目の 4 マス（次のブロック N+1 の下層）も編集する。保存は setTripleLayer で、
 *   N+1 の属性と上層を 0 にする（消える値があれば先に確かめる）。表の最後のブロックは 3 層にできない。
 *   一覧で N+1 を押すと N を選ぶ。
 */
export class BlockEditorWindow {
  private model: TilesetModel;
  private block: number | null = null;
  /** 手元で編集中の 8 タイル。 */
  private tiles: number[] | null = null;
  /** 手元で編集中の 3 層目の 4 タイル（次のブロックの下層。次のブロックが無ければ null）。 */
  private third: number[] | null = null;
  /** 読み込んだときの確定した中身（変わったら読み直す）。 */
  private loaded = "";
  private tile: number | null = null;
  private readonly list: BlockListView;
  private readonly sheet: TileSheetView;
  private readonly panel: BlockEditPanel;
  private readonly attributes: AttributePanel;
  private readonly io: TilesetIo;

  static start(root: HTMLElement, client: ToolClient): BlockEditorWindow {
    return new BlockEditorWindow(root, client);
  }

  private constructor(
    root: HTMLElement,
    private readonly client: ToolClient,
  ) {
    this.model = new TilesetModel(client.snapshot, client.ui);
    this.list = new BlockListView((block) => this.selectBlock(block));
    this.sheet = new TileSheetView((tile) => this.selectTile(tile));
    this.panel = new BlockEditPanel(
      {
        place: (cell) => this.placeTile(cell),
        pick: (cell) => this.pickTile(cell),
        flipChanged: () => this.renderPanel(),
        paletteChanged: (palette) => void client.setUi({ palette }),
        save: () => void this.save(),
      },
      this.sheet,
    );
    this.attributes = new AttributePanel({
      accept: (next, prev) => this.acceptAttribute(next, prev),
      changed: () => this.renderPanel(),
    });
    const self = this;
    this.io = new TilesetIo({
      client,
      get model() {
        return self.model;
      },
      get palette() {
        return self.client.ui.palette;
      },
    });

    const actions: Record<string, () => unknown> = {
      "tiles.save1": () => this.io.saveTilesetImage(false),
      "tiles.open1": () => this.io.openTilesetImage(false),
      "tiles.save2": () => this.io.saveTilesetImage(true),
      "tiles.open2": () => this.io.openTilesetImage(true),
      "tiles.reload": () => this.reload(),
      "blocks.save1": () => this.io.saveBlocks(false),
      "blocks.open1": () => this.io.openBlocks(false),
      "blocks.save2": () => this.io.saveBlocks(true),
      "blocks.open2": () => this.io.openBlocks(true),
      "blocks.amount": () => this.io.changeBlockAmount(),
      "palette.editor": () => client.request({ op: "open", kind: "palette-editor" }),
      "palette.commit": () => client.request({ op: "commitPreview" }),
      "palette.save": () => this.io.savePalette(),
      "palette.open": () => this.io.openPalette(),
      "palette.remap": () => client.request({ op: "open", kind: "block-adjust" }),
    };
    const menu = createBlockEditorMenu(actions, (e) => void showError(errorText(e)));
    const body = document.createElement("div");
    body.className = "be-body";
    body.append(this.list.element, this.panel.element, this.attributes.element);
    root.classList.add("block-editor");
    root.append(menu.element, body);

    client.onSnapshot(() => this.onSnapshot());
    client.onUi(() => {
      this.model = new TilesetModel(client.snapshot, client.ui);
      this.renderTiles();
    });
    void installToolAutomation(client, { files: this.io.files, actions, describe: () => this.describe() });
    this.onSnapshot();
  }

  // ---- 操作 ----

  /** ブロックを選ぶ（8 タイルと属性を読み込む。編集中の値は捨てる）。3 層の次の番号なら 1 つ前の 3 層のブロックを選ぶ。 */
  private selectBlock(picked: number): void {
    const block = this.model.triple?.parentOf(picked) ?? picked;
    const tiles = this.model.blockTiles(block);
    if (!tiles) return;
    this.block = block;
    this.tiles = tiles;
    // 3 層目は同じタイルセットの次のブロック（主の 639 番の次は副の 640 番ではない）
    const sameTable = this.model.owner(block + 1)?.data === this.model.owner(block)?.data;
    this.third = sameTable ? (this.model.blockTiles(block + 1)?.slice(0, THIRD_LAYER_TILE_COUNT) ?? null) : null;
    this.loaded = this.committedKey(block);
    this.attributes.show(attributeBytes(this.model.attribute(block)));
    this.renderPanel();
  }

  private selectTile(tile: number): void {
    this.tile = tile;
    this.renderPanel();
  }

  /** マス `cell`（0〜7 は 8 マス、8〜11 は 3 層目）の入れ物と位置。 */
  private cellSlot(cell: number): { list: number[]; index: number } | null {
    if (cell < 8) return this.tiles ? { list: this.tiles, index: cell } : null;
    return this.third && this.tripleEditing() ? { list: this.third, index: cell - 8 } : null;
  }

  /** マス `cell` に、選んでいるタイル・反転・パレットを置く。 */
  private placeTile(cell: number): void {
    const slot = this.cellSlot(cell);
    if (!slot || this.tile === null) return;
    slot.list[slot.index] = packTileRef({ tile: this.tile, hflip: this.panel.xflip.checked, vflip: this.panel.yflip.checked, palette: this.client.ui.palette });
    this.renderPanel();
  }

  /** マス `cell` のタイル・反転・パレットを拾う。 */
  private pickTile(cell: number): void {
    const slot = this.cellSlot(cell);
    if (!slot) return;
    const ref = unpackTileRef(slot.list[slot.index] ?? 0);
    this.tile = ref.tile;
    this.panel.xflip.checked = ref.hflip;
    this.panel.yflip.checked = ref.vflip;
    if (ref.palette !== this.client.ui.palette) void this.client.setUi({ palette: ref.palette });
    this.renderPanel();
  }

  /**
   * 変更を保存（選んでいるブロックの 8 タイルと属性を setBlock コマンドにする）。
   * 3 層にするときは setTripleLayer（3 層目の 4 マスを N+1 の下層へ書き、N+1 の属性と上層を 0 にする）。
   */
  private async save(): Promise<void> {
    if (this.block === null || !this.tiles) return;
    const owner = this.model.owner(this.block);
    if (!owner) return;
    const attribute = attributeFromBytes(this.attributes.bytes());
    const base = { tileset: owner.data.pointer, secondary: owner.data.secondary, block: owner.local, tiles: [...this.tiles], attribute };
    try {
      if (isTripleLayer(attribute)) {
        if (!this.third) {
          await showError(t.tripleNoNext);
          return;
        }
        if (this.nextHasData() && !(await askYesNo(t.tripleCleanup(this.block + 1)))) return;
        await this.client.execute("setTripleLayer", { ...base, third: [...this.third] });
      } else {
        await this.client.execute("setBlock", base);
      }
    } catch (e) {
      await showError(errorText(e));
    }
  }

  /** 編集中の属性が 3 層か。 */
  private tripleEditing(): boolean {
    return isTripleLayer(attributeFromBytes(this.attributes.bytes()));
  }

  /** 属性の欄の変更を受け付けるか（表の最後のブロックは 3 層にできない）。 */
  private acceptAttribute(next: AttributeBytes, prev: AttributeBytes): boolean {
    if (this.block === null || !isTripleLayer(attributeFromBytes(next)) || isTripleLayer(attributeFromBytes(prev))) return true;
    if (this.third) return true;
    void showError(t.tripleNoNext);
    return false;
  }

  /** N+1 に、3 層にすると消える値（属性か上層）があるか。 */
  private nextHasData(): boolean {
    if (this.block === null) return false;
    const next = this.model.blockTiles(this.block + 1);
    return this.model.attribute(this.block + 1) !== 0 || (next?.slice(THIRD_LAYER_TILE_COUNT).some((v) => v !== 0) ?? false);
  }

  /** ブロックの再読み込み（写しを取り直し、選んでいるブロックを読み直す）。 */
  private async reload(): Promise<void> {
    const r = (await this.client.request({ op: "hello" })) as { snapshot: ToolClient["snapshot"]; ui: ToolClient["ui"] };
    this.client.snapshot = r.snapshot;
    this.client.ui = r.ui;
    this.loaded = "";
    this.onSnapshot();
  }

  // ---- 表示 ----

  private onSnapshot(): void {
    this.model = new TilesetModel(this.client.snapshot, this.client.ui);
    if (this.block !== null) {
      if (!this.model.owner(this.block)) {
        this.block = null;
        this.tiles = null;
        this.third = null;
        this.attributes.show([0, 0, 0, 0]);
      } else if (this.committedKey(this.block) !== this.loaded) {
        this.selectBlock(this.block);
      }
    }
    this.list.render(this.model);
    this.renderTiles();
    const s = this.client.snapshot;
    void getCurrentWindow()
      .setTitle(t.windowTitle(s.primary?.index ?? null, s.secondary?.index ?? null))
      .catch(() => undefined);
  }

  private renderTiles(): void {
    this.sheet.render(this.model, this.client.ui.palette);
    this.renderPanel();
  }

  private renderPanel(): void {
    this.panel.render(this.model, {
      tile: this.tile,
      block: this.block,
      offset: this.block === null ? null : this.model.blockOffset(this.block),
      tiles: this.tiles,
      third: this.block !== null && this.third && this.tripleEditing() ? { block: this.block + 1, tiles: this.third } : null,
      palette: this.client.ui.palette,
    });
  }

  /** ブロックの確定した中身（読み直すかを決める。3 層目に使う次のブロックも含める）。 */
  private committedKey(block: number): string {
    return `${this.model.blockTiles(block)?.join(",")}|${this.model.attribute(block)}|${this.model.blockTiles(block + 1)?.join(",")}`;
  }

  private describe(): unknown {
    const s = this.client.snapshot;
    return {
      map: s.map,
      tilesets: [s.primary?.index ?? null, s.secondary?.index ?? null],
      blockCounts: [this.model.primaryBlockCount, this.model.secondaryBlockCount],
      block: this.block,
      tile: this.tile,
      tiles: this.tiles,
      third: this.third,
      triple: this.tripleEditing(),
      thirdVisible: !this.panel.thirdBox.hidden,
      attribute: this.attributes.bytes(),
      palette: this.client.ui.palette,
      preview: Object.keys(this.client.ui.preview).map(Number),
      xflip: this.panel.xflip.checked,
      yflip: this.panel.yflip.checked,
      title: document.title,
    };
  }
}
