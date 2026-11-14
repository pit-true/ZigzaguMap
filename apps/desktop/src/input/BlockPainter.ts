import { PaintBlocksCommand, PaintCellValuesCommand, formatHex, type Command } from "@zigzagumap/core";
import type { BlockSelection } from "../app/EditorState";
import type { EditorState } from "../app/EditorState";
import { ja } from "../i18n/ja";
import type { Cell, MapView } from "../ui/map/MapView";
import { attachCellPointer } from "./CellPointer";

/**
 * マップタブのマウス操作（AdvanceMap に合わせる）。
 * - 左クリック: 選択中のブロック（スタンプなら左上をそのマス）を置く。移動許可は変えない。
 * - 左ドラッグ: 通ったマスに置く（1 回の操作にまとめる）。スタンプは押した位置に 1 回だけ置く。
 * - 右クリック・右ドラッグ: 離したマスのブロックを拾う。
 * - Ctrl＋右ドラッグ: 矩形を複数ブロック（スタンプ）として選ぶ。ブロックと一緒に移動許可も拾う（Phase3 #225）。
 *   移動許可を持つ選択は、マップタブの「移動許可も貼る」がオンなら移動許可ごと貼る（paintCells）。
 * - 修飾キーつきの左クリックは修飾キーなしと同じ。
 */
export class BlockPainter {
  private anchor: Cell | null = null;
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
    const movements: number[] = [];
    for (let y = y0; y < y0 + h; y++) {
      for (let x = x0; x < x0 + w; x++) {
        blocks.push(map.doc.grid.getBlock(x, y));
        movements.push(map.doc.grid.getMovement(x, y));
      }
    }
    this.state.selectStamp({ width: w, height: h, blocks, movements });
    this.onPicked();
  }

  private hover(cell: Cell | null): void {
    if (cell) this.hoverCell = cell;
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
  const useMovements = withMovements && s.movements !== undefined && s.movements.length === s.blocks.length;
  const cells: { x: number; y: number; block: number; movement: number }[] = [];
  for (let dy = 0; dy < s.height; dy++) {
    for (let dx = 0; dx < s.width; dx++) {
      const x = cell.x + dx;
      const y = cell.y + dy;
      const i = dy * s.width + dx;
      if (grid.inBounds(x, y)) cells.push({ x, y, block: s.blocks[i] ?? 0, movement: s.movements?.[i] ?? 0 });
    }
  }
  if (cells.length === 0) return null;
  if (useMovements) return new PaintCellValuesCommand({ bank: id.bank, map: id.map, cells });
  return new PaintBlocksCommand({ bank: id.bank, map: id.map, cells: cells.map(({ x, y, block }) => ({ x, y, block })) });
}

function hex4(n: number): string {
  return formatHex(n, 4);
}
