import { PaintBorderCommand } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { BlockPainter } from "../../input/BlockPainter";
import { StampClipboard } from "../../input/StampClipboard";
import { jaPaint } from "../../i18n/ja.paint";
import { ja } from "../../i18n/ja";
import { BlockPaletteView } from "../map/BlockPaletteView";
import { BorderView } from "../map/BorderView";
import { MapView } from "../map/MapView";

/** マップタブ（左にマップ、右に境界ブロックとブロックパレット）。 */
export class MapTab {
  readonly element: HTMLElement;
  readonly view: MapView;
  private readonly palette: BlockPaletteView;
  private readonly border: BorderView;
  private readonly selected: HTMLElement;
  /** マップのマウス操作（描く・拾う・矩形で選ぶ）。 */
  readonly painter: BlockPainter;
  /** Ctrl+C / Ctrl+V（Phase3 #225）。 */
  readonly clipboard: StampClipboard;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("div");
    this.element.className = "map-tab";
    this.view = new MapView("map-tab-view");
    this.painter = new BlockPainter(this.view, state, () => this.palette.scrollToSelection());
    this.clipboard = new StampClipboard(state, this.painter);

    this.palette = new BlockPaletteView({
      select: (selection, stamp) => {
        if (stamp) state.selectStamp(selection);
        else state.select(selection);
        const block = selection.blocks[0] ?? 0;
        state.setStatus(ja.statusPaletteBlock(block, state.map?.tiles.blockOffset(block) ?? null));
      },
      hover: (block, offset) => {
        if (block !== null) state.setStatus(ja.statusPaletteBlock(block, offset));
      },
    });
    this.border = new BorderView({
      place: (cell) => this.placeBorder(cell.x, cell.y),
      pick: (block) => {
        state.selectBlock(block);
        state.setStatus(ja.statusBlock(block));
        this.palette.scrollToSelection();
      },
    });

    const side = document.createElement("div");
    side.className = "map-side";
    const borderBox = document.createElement("div");
    borderBox.className = "border-box";
    const borderLabel = document.createElement("div");
    borderLabel.className = "border-label";
    borderLabel.textContent = ja.borderBlocks;
    this.selected = document.createElement("div");
    this.selected.className = "selected-block";
    borderBox.append(borderLabel, this.border.element, this.selected);
    side.append(borderBox, pasteMovementsToggle(state), this.palette.element);
    this.element.append(this.view.element, side);

    state.on("map", () => this.showMap());
    state.on("cells", () => {
      this.view.sync();
      this.border.redraw();
    });
    state.on("tiles", () => this.palette.refresh());
    state.on("selection", () => this.showSelection());
    state.on("view", () => this.configure());
    this.configure();
    this.showSelection();
  }

  private showMap(): void {
    const map = this.state.map;
    this.view.setImage(this.state.mapImage);
    this.border.set(map?.doc.border ?? null, map?.tiles ?? null);
    this.palette.setTiles(map?.tiles ?? null);
    this.palette.showSelection(this.state.selection);
  }

  private configure(): void {
    const s = this.state.settings.data;
    this.view.configure(s.zoomMap ? 2 : 1, s.grid);
    this.palette.configure(s.paletteWidth, s.zoomBlockPalette ? 2 : 1, s.grid);
    this.palette.showSelection(this.state.selection);
  }

  private showSelection(): void {
    const s = this.state.selection;
    this.palette.showSelection(s);
    this.selected.textContent = s.width === 1 && s.height === 1 ? ja.selectedBlock(s.blocks[0] ?? 0) : ja.selectedStamp(s.width, s.height);
  }

  /** 境界ブロックに置く（スタンプなら左上から、境界に収まる分だけ）。 */
  private placeBorder(x0: number, y0: number): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const s = this.state.selection;
    const border = map.doc.border;
    const cells: { x: number; y: number; block: number }[] = [];
    for (let dy = 0; dy < s.height; dy++) {
      for (let dx = 0; dx < s.width; dx++) {
        if (border.inBounds(x0 + dx, y0 + dy)) cells.push({ x: x0 + dx, y: y0 + dy, block: s.blocks[dy * s.width + dx] ?? 0 });
      }
    }
    if (cells.length > 0) session.bus.execute(new PaintBorderCommand({ bank: map.id.bank, map: map.id.map, cells }));
  }
}

/** 「移動許可も貼る」のチェック（マップから拾った複数選択を移動許可ごと貼るか。個人設定 `pasteMovements`。Phase3 #225）。 */
function pasteMovementsToggle(state: EditorState): HTMLElement {
  const row = document.createElement("label");
  row.className = "paste-movements";
  row.title = jaPaint.pasteMovementsHint;
  const box = document.createElement("input");
  box.type = "checkbox";
  box.dataset["autoId"] = "map.pasteMovements";
  box.checked = state.settings.data.pasteMovements;
  box.addEventListener("change", () => state.settings.update({ pasteMovements: box.checked }));
  state.on("view", () => (box.checked = state.settings.data.pasteMovements));
  row.append(box, document.createTextNode(jaPaint.pasteMovements));
  return row;
}
