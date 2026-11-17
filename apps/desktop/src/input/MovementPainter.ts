import { PaintMovementCommand, brushShapeCells } from "@zigzagumap/core";
import type { EditorState } from "../app/EditorState";
import { brushSetting, currentTool, pressKind, type Brush, type PressKind } from "../app/paintTool";
import { ja } from "../i18n/ja";
import type { Cell, MapView } from "../ui/map/MapView";
import { attachCellPointer } from "./CellPointer";
import { MapCells } from "./MapCells";
import type { CellRect } from "./paintPlans";
import { PreviewCanvas } from "./PreviewCanvas";
import { fillArea, reportFill } from "./tools/FillTool";
import { LineGuide } from "./tools/LineGuide";
import { MovementRectTool } from "./tools/MovementRectTool";
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
 * ここはマウスの振り分けと鉛筆・拾う・座標の表示。矩形塗りは tools/MovementRectTool、押したときの振り分けは app/paintTool の pressKind。
 * Phase7 #515: 鉛筆のブラシの大きさ（2〜9）と形も使う（移動許可はいつも 1 つなので、大きさを変えればいつも効く）。
 */
export class MovementPainter {
  /** 画面のマスとマップのマスの対応（隣の帯は App が `cells.neighbors` を入れる）。 */
  readonly cells: MapCells;
  /** 矩形塗り（Phase3 #233）。 */
  private readonly rect: MovementRectTool;
  /** マップシフト（Phase5 #390）。 */
  readonly shift: ShiftTool;
  /** 直線（Phase5 #389）。 */
  private readonly line = new LineGuide();
  /** 押したときに決めた操作（離すまで変えない）。 */
  private press: PressKind = null;
  /** ブラシで、この押下の間に書いたマス（`x,y`）。 */
  private readonly stroke = new Set<string>();

  constructor(
    view: MapView,
    private readonly state: EditorState,
    private readonly onPicked: () => void,
    /** 下見を消したあと、移動許可の重ね描きを描き直す。 */
    private readonly redrawLayer: () => void = () => undefined,
  ) {
    this.cells = new MapCells(state);
    // 下見は Ctrl を押している間は重ね描きの Canvas が隠れるため、別に置く（矩形塗りとシフトで共有）
    const preview = new PreviewCanvas(view);
    this.shift = new ShiftTool(view, state, preview);
    this.rect = new MovementRectTool(state, preview, (r) => this.fill(r), redrawLayer);
    attachCellPointer(
      view.stage,
      (e) => {
        const c = view.cellAtAny(e);
        return c && this.cells.resolve(c) ? c : null;
      },
      {
        down: (cell, g) => {
          // 移動エリアタブには入れ替えが無いので Alt は見ない。右ボタンの Ctrl（矩形の選択）も無い
          const kind = pressKind(currentTool(state), g, false);
          this.press = kind;
          if (kind === "fill") {
            this.cells.pressStart();
            this.fillAt(cell, g.ctrl);
          } else if (kind === "shift") this.shift.begin(cell, g.shift);
          else if (kind === "rect") this.rect.begin(cell);
          else if (kind === "pencil") {
            // ダブルクリックで隣のマップを開くとき、この押下で書いた分を取り消せるよう覚える
            this.cells.pressStart();
            this.line.begin(cell, g.shift);
            this.paint(cell, false);
          }
        },
        move: (cell, g, live) => {
          if (this.shift.active) return this.shift.move(cell, live.shift);
          if (this.rect.active) return this.rect.move(cell);
          if (g.button === 0 && this.press === "pencil") for (const c of this.line.next(cell, live.shift)) this.paint(c, true);
        },
        up: (cell, g) => {
          this.cells.pressEnd();
          this.line.end();
          this.press = null;
          if (this.shift.end()) {
            this.redrawLayer();
            return;
          }
          if (this.rect.end(cell)) return;
          if (g.button === 2 && cell) this.pick(cell);
        },
        hover: (cell) => this.hover(cell),
      },
    );
  }

  /** 今の鉛筆のブラシ（大きさ 2 以上のとき。カーソルの枠にも使う）。 */
  currentBrush(): Brush | null {
    const brush = brushSetting(this.state);
    return currentTool(this.state) === "pencil" && brush.size > 1 ? brush : null;
  }

  private paint(cell: Cell, merge: boolean): void {
    const brush = brushSetting(this.state);
    if (brush.size <= 1) return this.write([{ x: cell.x, y: cell.y, movement: this.state.movement }], true, merge);
    if (!merge) this.stroke.clear();
    const list: { x: number; y: number; movement: number }[] = [];
    for (const c of brushShapeCells(cell.x, cell.y, brush.size, brush.shape)) {
      const key = `${c.x},${c.y}`;
      if (this.stroke.has(key)) continue;
      this.stroke.add(key);
      list.push({ x: c.x, y: c.y, movement: this.state.movement });
    }
    if (list.length > 0) this.write(list, true, merge);
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
