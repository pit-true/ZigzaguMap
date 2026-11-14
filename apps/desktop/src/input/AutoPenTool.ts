import { BRUSH_SIZES, brushCells, brushRect, lineCells, type AutoPenPart, type PenSource, type PenWrite } from "@zigzagumap/core";
import type { AutoPenService } from "../app/AutoPenService";
import type { BlockUsageService } from "../app/BlockUsageService";
import type { EditorState } from "../app/EditorState";
import { jaPen } from "../i18n/ja.pen";
import type { Cell, MapView } from "../ui/map/MapView";
import type { FillCell } from "./paintPlans";

/** 自動ペンが描く道具に頼むこと（BlockPainter が受ける）。 */
export interface AutoPenHost {
  /** 画面のマスの値（u16。どのマップでもなければ null）。 */
  cellValue(cell: Cell): number | null;
  /** マスの一覧を書く（`merge` はドラッグの続き。`ownMovements` は移動許可を持つマスだけ移動許可も書く）。 */
  writeCells(list: readonly FillCell[], merge: boolean, ownMovements: boolean): void;
  /** カーソルに置く物を薄く重ねる（空なら消す）。 */
  showPreview(cells: readonly FillCell[]): void;
}

/** 下見の不透明度（カーソルに置く物）。 */
export const AUTOPEN_PREVIEW_ALPHA = 0.7;

/**
 * 自動ペン（#310・#311）。マップタブの右の欄の「自動ペン」（P）がオンで、選んでいるブロックが 1 つで、それがパーツに
 * 入っていれば、左ボタンの描画をこれが受ける（入っていなければふつうの鉛筆）。
 * - 筆の大きさは 1・2・3・5 マス。偶数の筆は、カーソルがマスのどちらの半分にあるかで寄せる側を決める。
 * - 速く動かして飛んだマスは線でつなぐ。1 回のドラッグで 1 回の Ctrl+Z。部品は押した所に 1 回だけ置く。
 * - 移動許可は、右の欄の「移動許可も付ける」がオンなら、パーツのマスの値、無ければ使用回数でいちばん多い値（無ければ今の値）。
 * - 隣のマップの帯の上でも描く（境界をまたぐ描画と同じ）。
 */
export class AutoPenTool {
  private stroke: { part: AutoPenPart; block: number; last: Cell } | null = null;
  /** カーソルのマスの中の位置（0〜1。偶数の筆の寄せる側）。 */
  private frac = { x: 0.5, y: 0.5 };
  /** 自動操作が渡すマスの中の位置（無ければ実際のマウスの位置）。 */
  forcedFraction: { x: number; y: number } | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly service: AutoPenService,
    private readonly usage: BlockUsageService | null,
    private readonly host: AutoPenHost,
    view: MapView,
  ) {
    view.stage.addEventListener("pointermove", (e) => this.track(view, e), true);
    view.stage.addEventListener("pointerdown", (e) => this.track(view, e), true);
  }

  private track(view: MapView, e: PointerEvent): void {
    const r = view.stage.getBoundingClientRect();
    const o = view.originPx;
    const size = view.cellSize;
    // ステージを CSS で広げているとき（#316）は、画面の上の位置をステージの中の位置に直す
    const k = view.screenScale;
    const fx = ((e.clientX - r.left) / k - o.x) / size;
    const fy = ((e.clientY - r.top) / k - o.y) / size;
    this.frac = { x: fx - Math.floor(fx), y: fy - Math.floor(fy) };
  }

  /** オンか。 */
  get active(): boolean {
    return this.state.settings.data.autoPen && this.state.tab === "map";
  }

  /** 筆の大きさ。 */
  get size(): number {
    const s = this.state.settings.data.autoPenSize;
    return (BRUSH_SIZES as readonly number[]).includes(s) ? s : 1;
  }

  /** 今の選択で描くパーツ（オフ・複数選択・パーツに無いブロックなら null）。 */
  partForSelection(): { part: AutoPenPart; block: number } | null {
    if (!this.active) return null;
    const s = this.state.selection;
    if (s.width !== 1 || s.height !== 1) return null;
    const block = s.blocks[0] ?? 0;
    const part = this.service.set?.index.partOf(block) ?? null;
    return part ? { part, block } : null;
  }

  private brush(cell: Cell): [number, number][] {
    const f = this.forcedFraction ?? this.frac;
    return brushCells(brushRect(cell.x, cell.y, this.size, f.x, f.y));
  }

  /** 押したとき。自動ペンで描くなら true（ふつうの鉛筆は描かない）。 */
  begin(cell: Cell): boolean {
    const target = this.partForSelection();
    if (!target) {
      if (this.active && this.service.set && this.service.set.parts.length === 0) this.state.setStatus(jaPen.autoPenNoParts);
      return false;
    }
    this.host.showPreview([]);
    this.stroke = { ...target, last: cell };
    this.state.setStatus(jaPen.autoPenPart(target.part.name, jaPen.kinds[target.part.kind] ?? target.part.kind));
    this.paint(target.part.kind === "piece" ? [[cell.x, cell.y]] : this.brush(cell), false);
    return true;
  }

  /** ドラッグ中（マスが変わったとき）。自動ペンで描いているなら true。 */
  drag(cell: Cell): boolean {
    const s = this.stroke;
    if (!s) return false;
    if (s.part.kind === "piece") return true;
    const cells = new Map<string, [number, number]>();
    for (const [x, y] of lineCells(s.last.x, s.last.y, cell.x, cell.y).slice(1)) {
      for (const c of this.brush({ x, y })) cells.set(`${c[0]},${c[1]}`, c);
    }
    s.last = cell;
    this.paint([...cells.values()], true);
    return true;
  }

  /** 離したとき。 */
  end(): void {
    this.stroke = null;
  }

  /** 描いているか。 */
  get drawing(): boolean {
    return this.stroke !== null;
  }

  /** カーソルに置く物を薄く重ねる。 */
  hover(cell: Cell | null): void {
    if (this.stroke) return;
    const target = cell ? this.partForSelection() : null;
    if (!target || !cell) return this.host.showPreview([]);
    if (target.part.kind === "piece") return this.host.showPreview(rawCells(target.part, cell));
    this.host.showPreview(this.brush(cell).map(([x, y]) => ({ x, y, block: target.block })));
  }

  private source(): PenSource {
    return { get: (x, y) => this.host.cellValue({ x, y }) };
  }

  private paint(cells: readonly (readonly [number, number])[], merge: boolean): void {
    const s = this.stroke;
    const set = this.service.set;
    if (!s || !set || cells.length === 0) return;
    const plan = s.part.kind === "piece" ? set.planner.placePiece(this.source(), s.block, cells[0]![0], cells[0]![1]) : set.planner.strokeWith(this.source(), s.part, s.block, cells);
    if (!plan || plan.writes.length === 0) return;
    this.host.writeCells(this.withMovements(plan.writes), merge, this.state.settings.data.autoPenMovement);
  }

  /** 書くマスに移動許可を付ける（オフなら付けない）。 */
  withMovements(writes: readonly PenWrite[]): FillCell[] {
    const map = this.state.map;
    const on = this.state.settings.data.autoPenMovement;
    const usage = this.usage?.ready ?? null;
    return writes.map((w) => {
      if (!on) return { x: w.x, y: w.y, block: w.block };
      let m: number | null = w.movement ?? null;
      if (m === null && usage && map) m = usage.mostMovement(w.block, map.doc.primaryTileset, map.doc.secondaryTileset);
      if (m === null) m = (this.host.cellValue({ x: w.x, y: w.y }) ?? 0) >> 10;
      return { x: w.x, y: w.y, block: w.block, movement: m };
    });
  }
}

/** 部品の本体を `cell` を左上に並べたもの（下見用）。 */
function rawCells(part: AutoPenPart, cell: Cell): FillCell[] {
  const body = part.slots["Body"];
  if (!body) return [];
  const out: FillCell[] = [];
  for (let y = 0; y < body.height; y++) {
    for (let x = 0; x < body.width; x++) {
      const c = body.cells[y * body.width + x];
      if (c) out.push({ x: cell.x + x, y: cell.y + y, block: c.block });
    }
  }
  return out;
}
