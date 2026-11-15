import type { EditorState } from "../../app/EditorState";
import { matchesKey } from "../../app/keymap";
import { jaPaint } from "../../i18n/ja.paint";
import { jaPen } from "../../i18n/ja.pen";
import type { Cell } from "../../ui/map/MapView";
import type { BlockWriter } from "../BlockWriter";
import { rectOf, tileRect, type CellRect } from "../paintPlans";
import type { PreviewCanvas } from "../PreviewCanvas";
import { drawPreviewBlocks, strokeCellRect } from "../previewDraw";

/** ドラッグで使う道具（Phase3 #233）。 */
export type DragToolKind = "pick" | "rect" | "swap";

/** ドラッグ中の道具。 */
type Drag =
  | { readonly tool: "pick"; readonly anchor: Cell; cancelled: boolean }
  | { readonly tool: "rect"; readonly anchor: Cell; last: Cell; cancelled: boolean }
  | { readonly tool: "swap"; readonly anchor: Cell; last: Cell; cancelled: boolean };

/** 最後に Ctrl＋右ドラッグで選んだ矩形（主マップとその座標）。 */
export interface PickedRect {
  readonly id: { bank: number; map: number };
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * マップタブのドラッグの道具（Phase3 #233・#225）。押したマスから離したマスまでの矩形に働く。
 * - pick（Ctrl＋右ドラッグ）: 矩形を複数ブロック（スタンプ）として選ぶ。ブロックと一緒に移動許可も拾う。下見は赤い枠。
 * - rect（Ctrl＋左ドラッグ）: 矩形塗り。下見はブロックを半透明で描き、離したら 1 回で書く。スタンプは左上を基準に敷き詰める。
 * - swap（Alt＋左ドラッグ）: 押したマスと離したマスのブロックと移動許可を入れ替える。下見は 2 マスの枠。
 * Esc でドラッグを取りやめる。
 */
export class BlockDragTools {
  private drag: Drag | null = null;
  /** 最後に選んだ矩形（マップ作成補助の「範囲」。#312）。 */
  lastPick: PickedRect | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly writer: BlockWriter,
    private readonly preview: PreviewCanvas,
    /** 矩形の塗り（袋から描くときは BlockPainter が袋の中から選ぶ）。 */
    private readonly fillRect: (rect: CellRect) => void,
    /** 矩形を選んだとき（パレットを追従させる）。 */
    private readonly onPicked: () => void,
  ) {
    document.addEventListener("keydown", (e) => {
      if (!matchesKey("drag.cancel", e) || !this.drag || this.drag.cancelled) return;
      e.preventDefault();
      this.drag.cancelled = true;
      this.preview.end();
      this.state.setStatus(jaPaint.dragCancelled);
    });
  }

  /** ドラッグ中の道具（無ければ null）。 */
  get tool(): DragToolKind | null {
    return this.drag?.tool ?? null;
  }

  /** ドラッグを始める（pick は今のマス、ほかは押したマスで下見を出す）。 */
  start(tool: DragToolKind, cell: Cell): void {
    const d: Drag = tool === "pick" ? { tool, anchor: cell, cancelled: false } : { tool, anchor: cell, last: cell, cancelled: false };
    this.drag = d;
    this.drawPreview(d, cell);
  }

  /** ドラッグ中にマウスが動いた。 */
  move(cell: Cell): void {
    const d = this.drag;
    if (!d || d.cancelled) return;
    if (d.tool !== "pick") d.last = cell;
    this.drawPreview(d, cell);
  }

  /** ボタンを離した。ドラッグ中だったら true（離したマスが無ければ最後のマスで決める）。 */
  end(cell: Cell | null): boolean {
    const d = this.drag;
    this.drag = null;
    if (!d) return false;
    this.preview.end();
    if (d.cancelled) return true;
    const end = cell ?? (d.tool === "pick" ? d.anchor : d.last);
    if (d.tool === "pick") this.selectRect(d.anchor, end);
    else if (d.tool === "rect") this.fillRect(rectOf(d.anchor, end));
    else this.swap(d.anchor, end);
    return true;
  }

  /** 2 マスのブロックと移動許可を入れ替える（1 回の操作。2 枚のマップにまたがってもよい）。 */
  private swap(a: Cell, b: Cell): void {
    const cells = this.writer.cells;
    const ra = cells.resolve(a);
    const rb = cells.resolve(b);
    if (!ra || !rb || (a.x === b.x && a.y === b.y)) return;
    const ga = cells.gridOf(ra.id);
    const gb = cells.gridOf(rb.id);
    if (!ga || !gb) return;
    const va = ga.getCell(ra.x, ra.y);
    const vb = gb.getCell(rb.x, rb.y);
    // 3 層の次の番号を動かすと片方だけ書かれてしまうので、入れ替えない（#301）。書く先のマップのタイルセットで見る（#337）
    const childA = cells.tripleChildOf(ra.id);
    const childB = cells.tripleChildOf(rb.id);
    if (childB?.(va & 0x3ff) || childA?.(vb & 0x3ff)) {
      this.state.setStatus(jaPen.tripleChildSkipped(1), undefined, true);
      return;
    }
    this.writer.write(
      [
        { x: a.x, y: a.y, block: vb & 0x3ff, movement: vb >> 10 },
        { x: b.x, y: b.y, block: va & 0x3ff, movement: va >> 10 },
      ],
      false,
      false,
    );
    this.state.setStatus(jaPaint.swapped(a.x, a.y, b.x, b.y));
  }

  private selectRect(a: Cell, b: Cell): void {
    if (!this.state.map) return;
    const r = rectOf(a, b);
    const blocks: number[] = [];
    const movements: number[] = [];
    for (let y = r.y; y < r.y + r.height; y++) {
      for (let x = r.x; x < r.x + r.width; x++) {
        const v = this.writer.cellValue({ x, y }) ?? 0;
        blocks.push(v & 0x3ff);
        movements.push(v >> 10);
      }
    }
    this.lastPick = { id: { ...this.state.map.id }, x: r.x, y: r.y, width: r.width, height: r.height };
    this.state.selectStamp({ width: r.width, height: r.height, blocks, movements });
    this.onPicked();
  }

  /** ドラッグ中の下見（矩形の選択は赤い枠、矩形塗りはブロックを半透明で、入れ替えは 2 マスの枠）。 */
  private drawPreview(d: Drag, cell: Cell): void {
    const p = this.preview.begin();
    if (d.tool === "pick") return strokeCellRect(p, rectOf(d.anchor, cell), "#ff0000");
    if (d.tool === "swap") {
      strokeCellRect(p, rectOf(d.anchor, d.anchor), "#ffd000");
      return strokeCellRect(p, rectOf(cell, cell), "#ffd000");
    }
    const rect = rectOf(d.anchor, cell);
    const map = this.state.map;
    if (map) drawPreviewBlocks(p, map.tiles, tileRect(rect, this.state.selection).filter((c) => this.writer.cells.resolve(c)));
    strokeCellRect(p, rect, "#ff0000");
  }
}
