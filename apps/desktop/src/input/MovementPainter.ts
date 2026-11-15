import { PaintMovementCommand } from "@zigzagumap/core";
import type { EditorState } from "../app/EditorState";
import { MOVEMENT_COLORS } from "../app/data/movementColors";
import { ja } from "../i18n/ja";
import { jaPaint } from "../i18n/ja.paint";
import type { Cell, MapView } from "../ui/map/MapView";
import { attachCellPointer } from "./CellPointer";
import { MapCells } from "./MapCells";
import { rectOf, type CellRect } from "./paintPlans";
import { PreviewCanvas } from "./PreviewCanvas";
import { strokeCellRect } from "./previewDraw";
import { currentTool, type PaintTool } from "../app/paintTool";
import { fillArea, reportFill } from "./tools/FillTool";
import { LineGuide } from "./tools/LineGuide";
import { ShiftTool } from "./tools/ShiftTool";

/** 移動許可の説明（[GehDaten]。無いものは ???）。 */
export function movementName(value: number): string {
  return ja.movementNames[value] ?? ja.movementUnknown;
}

/**
 * 移動エリアタブのマウス操作。
 * - 左クリック・左ドラッグ: 選択中の値を書く（ドラッグは 1 回の操作にまとめる。ブロック番号は変えない）。
 * - Ctrl＋左ドラッグ: 矩形に選択中の値を書く（Phase3 #233。ドラッグ中は枠で下見し、離したら 1 回で書く。Esc で取りやめ）。
 * - 右クリック・右ドラッグ: 離したマスの値を拾う。ほかの修飾キーは無視する。
 * どの操作も、隣のマップの帯の上でも動く（Phase3 #234・Q7。帯で見えていない部分には書かない）。
 * Phase5: 道具が塗りつぶしなら左クリックで塗りつぶし（移動許可だけで「同じ」を見る。Q2）、Ctrl＋クリックでマジック塗り。
 * シフトなら左ドラッグでマップシフト（ブロックと一緒に動く）。鉛筆で Shift を押しながら描くと直線（#389）。
 */
export class MovementPainter {
  private rect: { anchor: Cell; last: Cell; cancelled: boolean } | null = null;
  /** 画面のマスとマップのマスの対応（隣の帯は App が `cells.neighbors` を入れる）。 */
  readonly cells: MapCells;
  /** 矩形の下見（Ctrl を押している間は重ね描きの Canvas が隠れるため、別に置く）。 */
  private readonly preview: PreviewCanvas;
  /** マップシフト（Phase5 #390）。 */
  readonly shift: ShiftTool;
  /** 直線（Phase5 #389）。 */
  private readonly line = new LineGuide();
  /** 左ボタンを押したときの道具。 */
  private pressTool: PaintTool | null = null;

  constructor(
    view: MapView,
    private readonly state: EditorState,
    private readonly onPicked: () => void,
    /** 下見を消したあと、移動許可の重ね描きを描き直す。 */
    private readonly redrawLayer: () => void = () => undefined,
  ) {
    this.cells = new MapCells(state);
    this.preview = new PreviewCanvas(view);
    this.shift = new ShiftTool(view, state, this.preview);
    attachCellPointer(
      view.stage,
      (e) => {
        const c = view.cellAtAny(e);
        return c && this.cells.resolve(c) ? c : null;
      },
      {
        down: (cell, g) => {
          const tool = g.button === 0 ? currentTool(state) : null;
          this.pressTool = tool;
          if (tool === "fill") {
            this.cells.pressStart();
            this.fillAt(cell, g.ctrl);
          } else if (tool === "shift" && !g.ctrl) this.shift.begin(cell, g.shift);
          else if (g.button === 0 && g.ctrl) {
            this.rect = { anchor: cell, last: cell, cancelled: false };
            this.showPreview(rectOf(cell, cell));
          } else if (g.button === 0) {
            this.pressTool = "pencil";
            // ダブルクリックで隣のマップを開くとき、この押下で書いた分を取り消せるよう覚える
            this.cells.pressStart();
            this.line.begin(cell, g.shift);
            this.paint(cell, false);
          }
        },
        move: (cell, g, live) => {
          if (this.shift.active) return this.shift.move(cell, live.shift);
          const r = this.rect;
          if (r) {
            if (r.cancelled) return;
            r.last = cell;
            this.showPreview(rectOf(r.anchor, cell));
          } else if (g.button === 0 && this.pressTool === "pencil") for (const c of this.line.next(cell, live.shift)) this.paint(c, true);
        },
        up: (cell, g) => {
          this.cells.pressEnd();
          this.line.end();
          this.pressTool = null;
          if (this.shift.end()) {
            this.redrawLayer();
            return;
          }
          const r = this.rect;
          if (r) {
            this.rect = null;
            this.clearPreview();
            if (!r.cancelled) this.fill(rectOf(r.anchor, cell ?? r.last));
            return;
          }
          if (g.button === 2 && cell) this.pick(cell);
        },
        hover: (cell) => this.hover(cell),
      },
    );
    document.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || !this.rect || this.rect.cancelled) return;
      e.preventDefault();
      this.rect.cancelled = true;
      this.clearPreview();
      this.state.setStatus(jaPaint.dragCancelled);
    });
  }

  private paint(cell: Cell, merge: boolean): void {
    this.write([{ x: cell.x, y: cell.y, movement: this.state.movement }], true, merge);
  }

  /** 塗りつぶし（`magic` ならマジック塗り）。移動許可だけで「同じ」を見て、選択中の値を書く（1 回の操作）。 */
  fillAt(cell: Cell, magic: boolean): number {
    const area = fillArea(this.cells, cell, "movement", magic);
    if (area.length > 0) this.write(area.map((c) => ({ x: c.x, y: c.y, movement: this.state.movement })), false, false);
    reportFill(this.state, area.length, magic);
    return area.length;
  }

  /** 矩形に選択中の値を書く（1 回の操作）。 */
  private fill(r: CellRect): void {
    const list: { x: number; y: number; movement: number }[] = [];
    for (let y = r.y; y < r.y + r.height; y++) for (let x = r.x; x < r.x + r.width; x++) list.push({ x, y, movement: this.state.movement });
    this.write(list, false, false);
  }

  /** 画面のマスの一覧を、マップごとの paintMovement にして実行する（隣のマップは読み込んでから）。 */
  private write(list: readonly { x: number; y: number; movement: number }[], forDrag: boolean, merge: boolean): void {
    const groups = this.cells.split(list);
    if (groups.length === 0) return;
    this.cells.run(
      groups.map((g) => g.id),
      () => groups.map((g) => new PaintMovementCommand({ bank: g.id.bank, map: g.id.map, cells: g.cells })),
      forDrag,
      merge,
    );
  }

  /** 矩形の下見（選択中の値の色を薄く塗り、赤い枠を引く）。 */
  private showPreview(r: CellRect): void {
    const p = this.preview.begin();
    p.c.save();
    p.c.globalAlpha = 0.5;
    p.c.fillStyle = MOVEMENT_COLORS[this.state.movement] ?? "#000";
    p.c.fillRect(p.ox + r.x * p.size, p.oy + r.y * p.size, r.width * p.size, r.height * p.size);
    p.c.restore();
    strokeCellRect(p, r, "#ff0000");
  }

  private clearPreview(): void {
    this.preview.end();
    this.redrawLayer();
  }

  private pick(cell: Cell): void {
    const ref = this.cells.resolve(cell);
    const grid = ref ? this.cells.gridOf(ref.id) : null;
    if (!ref || !grid) return;
    this.state.selectMovement(grid.getMovement(ref.x, ref.y));
    this.onPicked();
  }

  private hover(cell: Cell | null): void {
    const map = this.state.map;
    // 隣の帯の上は、表示の補助の欄に隣のマップの座標を出す（#238）ので、ここでは出さない
    if (!cell || !map || !map.doc.grid.inBounds(cell.x, cell.y)) return;
    this.state.setStatus(ja.statusMapCell(cell.x, cell.y, movementName(map.doc.grid.getMovement(cell.x, cell.y))));
  }
}
