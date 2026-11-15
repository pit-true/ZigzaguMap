import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  THIRD_LAYER_TILE_COUNT,
  attributeBytes,
  attributeFromBytes,
  isTripleLayer,
  paintPaletteOnly,
  pickSelection,
  placeSelection,
  singleTile,
  unpackTileRef,
  type PlacedTile,
  type TileSelection,
} from "@zigzagumap/core";
import { jaBlockEditor as t } from "../../i18n/ja.blockEditor";
import { jaBlockTools as tt } from "../../i18n/ja.blockTools";
import { askYesNo, showError } from "../../ui/MessageBox";
import { openDialogs } from "../../ui/Dialog";
import { installToolAutomation } from "../toolAutomation";
import type { ToolClient } from "../ToolClient";
import { TilesetModel } from "../TilesetModel";
import { AttributePanel, type AttributeBytes } from "./AttributePanel";
import { BlockEditPanel } from "./BlockEditPanel";
import { createBlockEditorMenu, menuShortcut } from "./BlockEditorMenu";
import { BlockEditActions } from "./BlockEditActions";
import { BlockStatsView } from "./BlockStatsView";
import { openBlockSheetExport } from "./BlockSheetExportDialog";
import { openNewTileset } from "./NewTilesetDialog";
import { BlockListView } from "./BlockListView";
import { BlockEditorStatus } from "./BlockEditorStatus";
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
  /** タイル一覧で選んだ矩形か、8 マスから拾った矩形（#393）。 */
  private selection: TileSelection | null = null;
  private readonly list: BlockListView;
  private readonly sheet: TileSheetView;
  private readonly panel: BlockEditPanel;
  private readonly attributes: AttributePanel;
  private readonly io: TilesetIo;
  private readonly status = new BlockEditorStatus();
  private readonly edits: BlockEditActions;
  private readonly stats: BlockStatsView;
  /** 数えている途中の頼み（新しい頼みが来たら前の結果は使わない）。 */
  private statsRequest = 0;
  /** 最後に選んだ `focus` の番号（#396）。 */
  private focusSeq = 0;

  static start(root: HTMLElement, client: ToolClient): BlockEditorWindow {
    return new BlockEditorWindow(root, client);
  }

  private constructor(
    root: HTMLElement,
    private readonly client: ToolClient,
  ) {
    this.model = new TilesetModel(client.snapshot, client.ui);
    this.list = new BlockListView((block) => this.onListClick(block));
    this.sheet = new TileSheetView({ select: (selection) => this.selectTiles(selection), hover: (tile) => this.hoverSheet(tile) });
    this.panel = new BlockEditPanel(
      {
        place: (cell, paletteOnly) => this.placeTile(cell, paletteOnly),
        pick: (from, to) => this.pickTile(from, to),
        hover: (cell) => this.hoverCell(cell),
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
    this.stats = new BlockStatsView(this.list.element, this.sheet.element);
    const self = this;
    this.edits = new BlockEditActions({
      client,
      get model() {
        return self.model;
      },
      get block() {
        return self.block;
      },
      current: () => this.currentBlock(),
      status: (message) => this.status.show(message),
    });
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
      "edit.copy": () => this.edits.copy(),
      "edit.cut": () => this.edits.cut(),
      "edit.paste": () => this.edits.paste(),
      "edit.swap": () => this.edits.toggleSwap(),
      "view.usage": () => this.toggleStats("usage"),
      "view.unusedBlocks": () => this.toggleStats("unusedBlocks"),
      "view.unusedTiles": () => this.toggleStats("unusedTiles"),
      "tiles.newTileset": () =>
        openNewTileset({
          get model() {
            return self.model;
          },
          client,
          created: (text) => this.status.show(text),
        }),
      "tiles.exportBlocks": () =>
        openBlockSheetExport({
          get model() {
            return self.model;
          },
          files: this.io.files,
          saved: (path) => this.status.show(tt.exported(path)),
        }),
    };
    const menu = createBlockEditorMenu(actions, (e) => void showError(errorText(e)), (id) =>
      id === "edit.swap"
        ? this.edits.swapActive
        : id === "view.usage"
          ? this.stats.flags.usage
          : id === "view.unusedBlocks"
            ? this.stats.flags.unusedBlocks
            : id === "view.unusedTiles" && this.stats.flags.unusedTiles,
    );
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable)) return;
      if (openDialogs.length > 0) return;
      const id = menuShortcut(e);
      const run = id ? actions[id] : undefined;
      if (!run) return;
      e.preventDefault();
      Promise.resolve().then(run).catch((err: unknown) => void showError(errorText(err)));
    });
    const body = document.createElement("div");
    body.className = "be-body";
    body.append(this.list.element, this.panel.element, this.attributes.element);
    root.classList.add("block-editor");
    root.append(menu.element, body, this.status.element);

    client.onSnapshot(() => this.onSnapshot());
    client.onUi(() => {
      this.model = new TilesetModel(client.snapshot, client.ui);
      this.renderTiles();
      this.applyFocus();
    });
    void installToolAutomation(client, { files: this.io.files, actions, describe: () => this.describe() });
    this.onSnapshot();
    this.applyFocus();
  }

  /** パレットエディタの色の使用箇所で押したブロックを選ぶ（共有の状態の `focus` が変わったときだけ。#396）。 */
  private applyFocus(): void {
    const focus = this.client.ui.focus;
    if (!focus || focus.seq === this.focusSeq) return;
    this.focusSeq = focus.seq;
    if (!this.model.owner(focus.block)) return;
    this.selectBlock(focus.block);
    this.list.reveal(focus.block);
  }

  // ---- 操作 ----

  /** ブロック一覧を押した（入れ替えがオンなら入れ替えの 1 つ目・2 つ目にもする）。 */
  private onListClick(picked: number): void {
    this.selectBlock(picked);
    if (this.edits.swapActive && this.block !== null) void this.edits.pick(this.block);
  }

  /** 表示 メニューの使用回数・未使用の印を切り替え、オンなら数え直す。 */
  private async toggleStats(key: "usage" | "unusedBlocks" | "unusedTiles"): Promise<void> {
    this.stats.flags[key] = !this.stats.flags[key];
    await this.refreshStats();
  }

  /** 使用回数と未使用のタイルを数え直す（どれかがオンのときだけ。メインのウィンドウで数える）。 */
  private async refreshStats(): Promise<void> {
    const id = ++this.statsRequest;
    if (!this.stats.active) {
      this.stats.clear();
      return;
    }
    this.status.show(tt.counting);
    try {
      const r = (await this.client.request({ op: "blockStats", tiles: this.stats.flags.unusedTiles })) as { counts: number[]; unusedTiles: number[] | null; ms: number };
      if (id !== this.statsRequest) return;
      this.stats.set(r.counts, r.unusedTiles);
      this.stats.render(this.model.listedBlocks);
      this.status.show(tt.counted(r.counts.filter((n) => n === 0).length, r.unusedTiles?.length ?? null, r.ms));
    } catch (e) {
      this.status.show(errorText(e));
    }
  }

  /** 選んでいるブロックの、手元で編集中の中身（コピー用）。 */
  private currentBlock(): { tiles: number[]; attribute: number; third: number[] | null } | null {
    if (this.block === null || !this.tiles) return null;
    const attribute = attributeFromBytes(this.attributes.bytes());
    return { tiles: [...this.tiles], attribute, third: isTripleLayer(attribute) && this.third ? [...this.third] : null };
  }

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

  /** タイル一覧で矩形を選んだ（1 枚なら 1 × 1）。 */
  private selectTiles(selection: TileSelection): void {
    this.selection = selection.width * selection.height === 1 ? singleTile(selection.refs[0]!) : selection;
    this.status.show(selection.width * selection.height > 1 ? tt.selectionSize(selection.width, selection.height) : "");
    this.renderPanel();
  }

  /** マス `cell`（0〜7 は 8 マス、8〜11 は 3 層目）の入れ物と位置。 */
  private cellSlot(cell: number): { list: number[]; index: number } | null {
    if (cell < 8) return this.tiles ? { list: this.tiles, index: cell } : null;
    return this.third && this.tripleEditing() ? { list: this.third, index: cell - 8 } : null;
  }

  /** マスの今の値（無ければ 0）。 */
  private cellValue(cell: number): number {
    const slot = this.cellSlot(cell);
    return slot ? (slot.list[slot.index] ?? 0) : 0;
  }

  /**
   * マス `cell` を左上にして、選んでいる矩形を置く（反転は選択全体に当て、パレットは今のもの。拾った矩形は拾ったときのもの）。
   * `paletteOnly`（Ctrl＋左クリック）なら、選択の大きさの範囲のパレットだけを今のパレットにする。はみ出た分は置かない。
   */
  private placeTile(cell: number, paletteOnly: boolean): void {
    if (!this.cellSlot(cell)) return;
    const palette = this.client.ui.palette;
    let placed: PlacedTile[];
    if (paletteOnly) placed = paintPaletteOnly(this.selection ?? { width: 1, height: 1 }, cell, palette, (c) => this.cellValue(c));
    else if (this.selection) placed = placeSelection(this.selection, cell, { hflip: this.panel.xflip.checked, vflip: this.panel.yflip.checked, palette });
    else return;
    for (const p of placed) {
      const slot = this.cellSlot(p.cell);
      if (slot) slot.list[slot.index] = p.ref;
    }
    this.renderPanel();
  }

  /**
   * マス `from` から `to` までの矩形を拾う。1 マスなら今までどおり、タイルを選び、反転とパレットの欄をそのマスの値にする。
   * 2 マス以上なら反転とパレットごと矩形で持ち（反転の欄は外す）、そのまま置ける。
   */
  private pickTile(from: number, to: number): void {
    if (!this.cellSlot(from)) return;
    const picked = pickSelection(from, this.cellSlot(to) ? to : from, (c) => this.cellValue(c));
    this.sheet.clearFrame();
    if (picked.width * picked.height === 1) {
      const ref = unpackTileRef(picked.refs[0]!);
      this.selection = singleTile(ref.tile);
      this.panel.xflip.checked = ref.hflip;
      this.panel.yflip.checked = ref.vflip;
      if (ref.palette !== this.client.ui.palette) void this.client.setUi({ palette: ref.palette });
      this.status.show("");
    } else {
      this.selection = picked;
      this.panel.xflip.checked = false;
      this.panel.yflip.checked = false;
      this.status.show(tt.pickedSize(picked.width, picked.height));
    }
    this.renderPanel();
  }

  private hoverSheet(tile: number | null): void {
    this.status.hover(tile === null ? null : tt.hoverSheet(tile, this.client.ui.palette));
  }

  private hoverCell(cell: number | null): void {
    if (cell === null || !this.cellSlot(cell)) {
      this.status.hover(null);
      return;
    }
    const ref = unpackTileRef(this.cellValue(cell));
    this.status.hover(tt.hoverCell(cell, ref.tile, ref.palette, ref.hflip, ref.vflip));
  }

  /** 選んでいる矩形の左上のタイル（Tile 欄とプレビュー）。 */
  private get tile(): number | null {
    return this.selection ? (this.selection.refs[0]! & 0x3ff) : null;
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
    // 編集の後に数え直す（オンのときだけ）
    if (this.stats.active) void this.refreshStats();
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
      selection: this.selection ? { width: this.selection.width, height: this.selection.height, picked: this.selection.keepPalette } : null,
      tiles: this.tiles,
      third: this.third,
      triple: this.tripleEditing(),
      thirdVisible: !this.panel.thirdBox.hidden,
      attribute: this.attributes.bytes(),
      palette: this.client.ui.palette,
      preview: Object.keys(this.client.ui.preview).map(Number),
      xflip: this.panel.xflip.checked,
      yflip: this.panel.yflip.checked,
      edit: this.edits.describe(),
      stats: this.stats.describe(),
      status: this.status.text,
      title: document.title,
    };
  }
}
