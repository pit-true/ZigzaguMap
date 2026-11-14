import { BLOCK_PIXELS, PaintBlocksCommand, PaintCellValuesCommand, createImage, formatHex, type Command } from "@zigzagumap/core";
import type { BlockSelection } from "../app/EditorState";
import type { EditorState } from "../app/EditorState";
import { ja } from "../i18n/ja";
import { jaPaint } from "../i18n/ja.paint";
import type { Cell, MapView } from "../ui/map/MapView";
import { attachCellPointer } from "./CellPointer";
import { rectOf, tileRect, type CellRect, type FillCell } from "./paintPlans";

/** ドラッグ中の道具（Phase3 #233）。 */
type Drag =
  | { readonly tool: "pick"; readonly anchor: Cell; cancelled: boolean }
  | { readonly tool: "rect"; readonly anchor: Cell; last: Cell; cancelled: boolean }
  | { readonly tool: "swap"; readonly anchor: Cell; last: Cell; cancelled: boolean };

/** 矩形塗りの下見の不透明度。 */
const PREVIEW_ALPHA = 0.75;

/**
 * マップタブのマウス操作（AdvanceMap に合わせ、Phase3 で道具を足した）。
 * - 左クリック: 選択中のブロック（スタンプなら左上をそのマス）を置く。移動許可は変えない。
 * - 左ドラッグ: 通ったマスに置く（1 回の操作にまとめる）。スタンプは押した位置に 1 回だけ置く。
 * - 右クリック・右ドラッグ: 離したマスのブロックを拾う。
 * - Ctrl＋右ドラッグ: 矩形を複数ブロック（スタンプ）として選ぶ。ブロックと一緒に移動許可も拾う（Phase3 #225）。
 *   移動許可を持つ選択は、マップタブの「移動許可も貼る」がオンなら移動許可ごと貼る（paintCells）。
 * - Ctrl＋左ドラッグ: 矩形塗り（Phase3 #233）。ドラッグ中は下見を描き、離したら 1 回で書く。スタンプは左上を基準に敷き詰める。
 * - Alt＋左ドラッグ: 押したマスと離したマスのブロックと移動許可を入れ替える（Phase3 #233）。
 * - Esc: 矩形塗り・入れ替え・矩形の選択のドラッグを取りやめる。
 * - Shift つきの左クリックは修飾キーなしと同じ。
 */
export class BlockPainter {
  private drag: Drag | null = null;
  /** 最後にマウスが乗っていたマス（Ctrl+V で貼る位置）。 */
  hoverCell: Cell | null = null;

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    /** ブロックを拾ったとき（パレットを追従させる）。 */
    private readonly onPicked: () => void,
  ) {
    attachCellPointer(view.stage, (e) => view.cellAt(e), {
      down: (cell, g) => {
        if (g.button === 0 && g.ctrl) this.startDrag({ tool: "rect", anchor: cell, last: cell, cancelled: false });
        else if (g.button === 0 && g.alt) this.startDrag({ tool: "swap", anchor: cell, last: cell, cancelled: false });
        else if (g.button === 0) this.paint(cell, false);
        else if (g.ctrl) this.startDrag({ tool: "pick", anchor: cell, cancelled: false }, cell);
      },
      move: (cell, g) => {
        const d = this.drag;
        if (d && !d.cancelled) {
          if (d.tool !== "pick") d.last = cell;
          this.drawPreview(d, cell);
        } else if (!d && g.button === 0 && this.isSingle()) this.paint(cell, true);
      },
      up: (cell, g) => {
        const d = this.drag;
        this.drag = null;
        if (d) {
          this.clearRect();
          if (d.cancelled) return;
          const end = cell ?? (d.tool === "pick" ? d.anchor : d.last);
          if (d.tool === "pick") this.selectRect(d.anchor, end);
          else if (d.tool === "rect") this.fillRect(rectOf(d.anchor, end));
          else this.swap(d.anchor, end);
          return;
        }
        if (g.button === 2 && cell) this.pick(cell);
      },
      hover: (cell) => this.hover(cell),
    });
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.drag || this.drag.cancelled) return;
      e.preventDefault();
      this.drag.cancelled = true;
      this.clearRect();
      this.state.setStatus(jaPaint.dragCancelled);
    });
  }

  /** ドラッグ中の道具（自動操作と確認用。無ければ null）。 */
  get tool(): "pick" | "rect" | "swap" | null {
    return this.drag?.tool ?? null;
  }

  private startDrag(d: Drag, cell: Cell = d.anchor): void {
    this.drag = d;
    this.drawPreview(d, cell);
  }

  private isSingle(): boolean {
    return this.state.selection.width === 1 && this.state.selection.height === 1;
  }

  private paint(cell: Cell, merge: boolean): void {
    this.paintSelection(cell, this.state.selection, merge);
  }

  /** 選択（複数ブロックなら左上を `cell`）を置く。移動許可を持つ選択は、設定がオンなら移動許可ごと置く。 */
  paintSelection(cell: Cell, s: BlockSelection, merge = false): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const command = paintCommand(map.id, map.doc.grid, cell, s, this.state.settings.data.pasteMovements);
    if (command) session.bus.execute(command, { merge });
  }

  /** 矩形塗り（1 回の操作）。 */
  private fillRect(rect: CellRect): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const command = cellsCommand(map.id, map.doc.grid, tileRect(rect, this.state.selection), this.state.settings.data.pasteMovements);
    if (command) session.bus.execute(command);
  }

  /** 2 マスのブロックと移動許可を入れ替える（1 回の操作）。 */
  private swap(a: Cell, b: Cell): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session || (a.x === b.x && a.y === b.y)) return;
    const grid = map.doc.grid;
    if (!grid.inBounds(a.x, a.y) || !grid.inBounds(b.x, b.y)) return;
    const va = grid.getCell(a.x, a.y);
    const vb = grid.getCell(b.x, b.y);
    session.bus.execute(
      new PaintCellValuesCommand({
        bank: map.id.bank,
        map: map.id.map,
        cells: [
          { x: a.x, y: a.y, block: vb & 0x3ff, movement: vb >> 10 },
          { x: b.x, y: b.y, block: va & 0x3ff, movement: va >> 10 },
        ],
      }),
    );
    this.state.setStatus(jaPaint.swapped(a.x, a.y, b.x, b.y));
  }

  private pick(cell: Cell): void {
    const map = this.state.map;
    if (!map) return;
    const block = map.doc.grid.getBlock(cell.x, cell.y);
    this.state.selectBlock(block);
    this.state.setStatus(ja.statusBlock(block));
    this.onPicked();
  }

  private selectRect(a: Cell, b: Cell): void {
    const map = this.state.map;
    if (!map) return;
    const r = rectOf(a, b);
    const blocks: number[] = [];
    const movements: number[] = [];
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        blocks.push(map.doc.grid.getBlock(x, y));
        movements.push(map.doc.grid.getMovement(x, y));
      }
    }
    this.state.selectStamp({ width: r.width, height: r.height, blocks, movements });
    this.onPicked();
  }

  private hover(cell: Cell | null): void {
    if (cell) this.hoverCell = cell;
    const map = this.state.map;
    if (!cell || !map) return;
    this.state.setStatus(ja.statusMapCell(cell.x, cell.y, hex4(map.doc.grid.getBlock(cell.x, cell.y))));
  }

  /** ドラッグ中の下見（矩形の選択は赤い枠、矩形塗りはブロックを半透明で、入れ替えは 2 マスの枠）。 */
  private drawPreview(d: Drag, cell: Cell): void {
    this.clearRect();
    if (d.tool === "pick") return this.strokeRect(rectOf(d.anchor, cell), "#ff0000");
    if (d.tool === "swap") {
      this.strokeRect(rectOf(d.anchor, d.anchor), "#ffd000");
      return this.strokeRect(rectOf(cell, cell), "#ffd000");
    }
    const rect = rectOf(d.anchor, cell);
    this.drawBlocks(tileRect(rect, this.state.selection));
    this.strokeRect(rect, "#ff0000");
  }

  /** ブロックを重ね描きの Canvas に半透明で描く（矩形塗りの下見）。 */
  private drawBlocks(cells: readonly FillCell[]): void {
    const map = this.state.map;
    if (!map || cells.length === 0) return;
    const minX = Math.min(...cells.map((c) => c.x));
    const minY = Math.min(...cells.map((c) => c.y));
    const w = Math.max(...cells.map((c) => c.x)) - minX + 1;
    const h = Math.max(...cells.map((c) => c.y)) - minY + 1;
    const image = createImage(w * BLOCK_PIXELS, h * BLOCK_PIXELS);
    for (const c of cells) map.tiles.renderer.blit(c.block, image.data, image.width, (c.x - minX) * BLOCK_PIXELS, (c.y - minY) * BLOCK_PIXELS);
    const tmp = document.createElement("canvas");
    tmp.width = image.width;
    tmp.height = image.height;
    tmp.getContext("2d")!.putImageData(new ImageData(image.data, image.width, image.height), 0, 0);
    const c = this.view.layerContext;
    const size = this.view.cellSize;
    c.save();
    c.imageSmoothingEnabled = false;
    c.globalAlpha = PREVIEW_ALPHA;
    c.drawImage(tmp, minX * size, minY * size, w * size, h * size);
    c.restore();
  }

  private strokeRect(r: CellRect, color: string): void {
    const c = this.view.layerContext;
    const size = this.view.cellSize;
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.strokeRect(r.x * size + 0.5, r.y * size + 0.5, r.width * size - 1, r.height * size - 1);
  }

  private clearRect(): void {
    this.view.layerContext.clearRect(0, 0, this.view.layer.width, this.view.layer.height);
  }
}

/**
 * マスの一覧を書くコマンド（マップの外の分は書かない。書くマスが無ければ null）。
 * 移動許可を持つマスがあり `withMovements` なら paintCells（ブロックと移動許可）、そうでなければ paintBlocks（ブロックだけ）。
 */
export function cellsCommand(id: { bank: number; map: number }, grid: { inBounds(x: number, y: number): boolean }, list: readonly FillCell[], withMovements: boolean): Command | null {
  const cells = list.filter((c) => grid.inBounds(c.x, c.y));
  if (cells.length === 0) return null;
  if (withMovements && cells.every((c) => c.movement !== undefined)) {
    return new PaintCellValuesCommand({ bank: id.bank, map: id.map, cells: cells.map((c) => ({ x: c.x, y: c.y, block: c.block, movement: c.movement! })) });
  }
  return new PaintBlocksCommand({ bank: id.bank, map: id.map, cells: cells.map(({ x, y, block }) => ({ x, y, block })) });
}

/**
 * 選択を `cell` を左上にして置くコマンド（マップの外にはみ出す分は置かない。置くマスが無ければ null）。
 * 選択が移動許可を持ち、`withMovements` なら paintCells（ブロックと移動許可）、そうでなければ paintBlocks（ブロックだけ）。
 */
export function paintCommand(
  id: { bank: number; map: number },
  grid: { inBounds(x: number, y: number): boolean },
  cell: Cell,
  s: BlockSelection,
  withMovements: boolean,
): Command | null {
  const ok = s.movements !== undefined && s.movements.length === s.blocks.length;
  const sel = ok ? s : { width: s.width, height: s.height, blocks: s.blocks };
  return cellsCommand(id, grid, tileRect({ x: cell.x, y: cell.y, width: s.width, height: s.height }, sel), withMovements);
}

function hex4(n: number): string {
  return formatHex(n, 4);
}
