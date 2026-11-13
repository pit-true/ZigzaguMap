import { PaintBlocksCommand, formatHex } from "@zigzagumap/core";
import type { EditorState } from "../app/EditorState";
import { ja } from "../i18n/ja";
import type { Cell, MapView } from "../ui/map/MapView";
import { attachCellPointer } from "./CellPointer";

/**
 * マップタブのマウス操作（AdvanceMap に合わせる）。
 * - 左クリック: 選択中のブロック（スタンプなら左上をそのマス）を置く。移動許可は変えない。
 * - 左ドラッグ: 通ったマスに置く（1 回の操作にまとめる）。スタンプは押した位置に 1 回だけ置く。
 * - 右クリック・右ドラッグ: 離したマスのブロックを拾う。
 * - Ctrl＋右ドラッグ: 矩形を複数ブロック（スタンプ）として選ぶ。
 * - 修飾キーつきの左クリックは修飾キーなしと同じ。
 */
export class BlockPainter {
  private anchor: Cell | null = null;

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    /** ブロックを拾ったとき（パレットを追従させる）。 */
    private readonly onPicked: () => void,
  ) {
    attachCellPointer(view.stage, (e) => view.cellAt(e), {
      down: (cell, g) => {
        if (g.button === 0) this.paint(cell, false);
        else if (g.ctrl) {
          this.anchor = cell;
          this.drawRect(cell, cell);
        }
      },
      move: (cell, g) => {
        if (g.button === 0 && this.isSingle()) this.paint(cell, true);
        else if (g.button === 2 && this.anchor) this.drawRect(this.anchor, cell);
      },
      up: (cell, g) => {
        if (g.button !== 2) return;
        if (this.anchor) {
          this.selectRect(this.anchor, cell ?? this.anchor);
          this.anchor = null;
          this.clearRect();
        } else if (cell) {
          this.pick(cell);
        }
      },
      hover: (cell) => this.hover(cell),
    });
  }

  private isSingle(): boolean {
    return this.state.selection.width === 1 && this.state.selection.height === 1;
  }

  private paint(cell: Cell, merge: boolean): void {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session) return;
    const s = this.state.selection;
    const grid = map.doc.grid;
    const cells: { x: number; y: number; block: number }[] = [];
    for (let dy = 0; dy < s.height; dy++) {
      for (let dx = 0; dx < s.width; dx++) {
        const x = cell.x + dx;
        const y = cell.y + dy;
        if (grid.inBounds(x, y)) cells.push({ x, y, block: s.blocks[dy * s.width + dx] ?? 0 });
      }
    }
    if (cells.length === 0) return;
    session.bus.execute(new PaintBlocksCommand({ bank: map.id.bank, map: map.id.map, cells }), { merge });
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
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const w = Math.abs(a.x - b.x) + 1;
    const h = Math.abs(a.y - b.y) + 1;
    const blocks: number[] = [];
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) blocks.push(map.doc.grid.getBlock(x, y));
    this.state.selectStamp({ width: w, height: h, blocks });
    this.onPicked();
  }

  private hover(cell: Cell | null): void {
    const map = this.state.map;
    if (!cell || !map) return;
    this.state.setStatus(ja.statusMapCell(cell.x, cell.y, hex4(map.doc.grid.getBlock(cell.x, cell.y))));
  }

  private drawRect(a: Cell, b: Cell): void {
    const c = this.view.layerContext;
    const size = this.view.cellSize;
    this.clearRect();
    const x = Math.min(a.x, b.x) * size;
    const y = Math.min(a.y, b.y) * size;
    c.strokeStyle = "#ff0000";
    c.lineWidth = 1;
    c.strokeRect(x + 0.5, y + 0.5, (Math.abs(a.x - b.x) + 1) * size - 1, (Math.abs(a.y - b.y) + 1) * size - 1);
  }

  private clearRect(): void {
    this.view.layerContext.clearRect(0, 0, this.view.layer.width, this.view.layer.height);
  }
}

function hex4(n: number): string {
  return formatHex(n, 4);
}
