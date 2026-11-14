import { formatHex } from "@zigzagumap/core";
import type { BlockUsageService } from "../app/BlockUsageService";
import type { BlockSelection } from "../app/EditorState";
import type { EditorState } from "../app/EditorState";
import type { MixingBag } from "../app/MixingBag";
import { ja } from "../i18n/ja";
import type { Cell, MapView } from "../ui/map/MapView";
import type { AutoPenTool } from "./AutoPenTool";
import { BlockDragTools, type DragToolKind, type PickedRect } from "./BlockDragTools";
import { BlockWriter } from "./BlockWriter";
import { attachCellPointer } from "./CellPointer";
import { MapCells } from "./MapCells";
import { usableSelection } from "./paintCommands";
import { tileRect, type CellRect, type FillCell } from "./paintPlans";
import { PreviewCanvas } from "./PreviewCanvas";
import { tripleStatusSuffix } from "./tripleRules";

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
 * ミキシングバッグ（#236）: 袋を使う選択のとき、鉛筆と矩形塗りは各マスのブロックを袋の中から乱数で選ぶ（移動許可は
 * 「移動許可を自動で選ぶ」（#235）がオンなら、そのブロックにいちばん多い移動許可も書く）。
 * どの操作も、隣のマップの帯の上でも動く（Phase3 #234。帯で見えていない部分には描かない）。2 枚にまたがる操作は、
 * マップごとのコマンドをまとめて 1 回の操作にする（隣のマップは書く前に読み込む）。
 * 3 層の次の番号（#301）: どの描き方でも書かない（そのマスは今のまま）。1 つも書けなかったときはステータスバーに理由を出す。
 * 拾ったブロックが 3 層の次の番号なら、1 つ前の 3 層のブロックを選ぶ（パレットと同じ）。
 *
 * 道具ごとに分けている（Phase4 #318）: ここはマウスの振り分けと鉛筆・拾う・座標の表示。ドラッグの道具（矩形の選択・矩形塗り・
 * 入れ替え）は BlockDragTools、自動ペンは AutoPenTool、書き込み（3 層の次の番号を落とす所を含む）は BlockWriter。
 */
export class BlockPainter {
  /** 最後にマウスが乗っていたマス（Ctrl+V で貼る位置）。 */
  hoverCell: Cell | null = null;
  /** 画面のマスとマップのマスの対応（隣の帯は App が `cells.neighbors` を入れる）。 */
  readonly cells: MapCells;
  /** ブロックの書き込み（自動ペン・マップ作成補助・境界ブロックも使う）。 */
  readonly writer: BlockWriter;
  /** ドラッグの道具（矩形の選択・矩形塗り・入れ替え）。 */
  readonly drags: BlockDragTools;
  /** ミキシングバッグ（MapTab が入れる）。 */
  bag: MixingBag | null = null;
  /** ブロックの使用回数（袋から描くときの移動許可。App が入れる）。 */
  usage: BlockUsageService | null = null;
  /** 自動ペン（Phase4 #310。PenExtras が入れる）。オンでパーツのブロックを選んでいれば、左ボタンの描画を受ける。 */
  autoPen: AutoPenTool | null = null;

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    /** ブロックを拾ったとき（パレットを追従させる）。 */
    private readonly onPicked: () => void,
  ) {
    this.cells = new MapCells(state);
    const preview = new PreviewCanvas(view);
    this.writer = new BlockWriter(state, this.cells, preview, () => this.drags.tool !== null);
    this.drags = new BlockDragTools(state, this.writer, preview, (rect) => this.fillRect(rect), onPicked);
    const startDrag = (tool: DragToolKind, cell: Cell): void => this.drags.start(tool, cell);
    attachCellPointer(view.stage, (e) => this.cellAt(e), {
      down: (cell, g) => {
        if (g.button === 0 && g.ctrl) startDrag("rect", cell);
        else if (g.button === 0 && g.alt) startDrag("swap", cell);
        else if (g.button === 0) {
          // ダブルクリックで隣のマップを開くとき、この押下で描いた分を取り消せるよう覚える
          this.cells.pressStart();
          if (this.autoPen?.begin(cell)) return;
          this.paint(cell, false);
        } else if (g.ctrl) startDrag("pick", cell);
      },
      move: (cell, g) => {
        const dragging = this.drags.tool !== null;
        if (!dragging && g.button === 0 && this.autoPen?.drag(cell)) return;
        if (dragging) this.drags.move(cell);
        else if (g.button === 0 && this.isSingle()) this.paint(cell, true);
      },
      up: (cell, g) => {
        this.cells.pressEnd();
        this.autoPen?.end();
        if (this.drags.end(cell)) return;
        if (g.button === 2 && cell) this.pick(cell);
      },
      hover: (cell) => {
        this.hover(cell);
        if (this.drags.tool === null) this.autoPen?.hover(cell);
      },
    });
  }

  /** 最後に Ctrl＋右ドラッグで選んだ矩形（主マップとその座標。マップ作成補助の「範囲」。#312）。 */
  get lastPick(): PickedRect | null {
    return this.drags.lastPick;
  }

  /** マウスの位置のマス（主マップか、見せている隣の帯の上だけ）。 */
  private cellAt(e: MouseEvent): Cell | null {
    const c = this.view.cellAtAny(e);
    return c && this.cells.resolve(c) ? c : null;
  }

  private isSingle(): boolean {
    return this.state.selection.width === 1 && this.state.selection.height === 1;
  }

  private paint(cell: Cell, merge: boolean): void {
    this.paintSelection(cell, this.state.selection, merge);
  }

  /** 選択（複数ブロックなら左上を `cell`）を置く。移動許可を持つ選択は、設定がオンなら移動許可ごと置く。 */
  paintSelection(cell: Cell, s: BlockSelection, merge = false): void {
    const sel = usableSelection(s);
    const list = tileRect({ x: cell.x, y: cell.y, width: s.width, height: s.height }, sel);
    if (this.bag?.appliesTo(s)) return this.writer.write(this.fromBag(list), true, merge, true);
    this.writer.write(list, true, merge);
  }

  /** 矩形塗り（1 回の操作）。 */
  private fillRect(rect: CellRect): void {
    const list = tileRect(rect, this.state.selection);
    if (this.bag?.appliesTo(this.state.selection)) return this.writer.write(this.fromBag(list), false, false, true);
    this.writer.write(list, false, false);
  }

  /** 各マスのブロックを袋から選ぶ（移動許可は、自動で選ぶ設定がオンで使用回数があれば、いちばん多いもの）。 */
  private fromBag(list: readonly FillCell[]): FillCell[] {
    const bag = this.bag!;
    const map = this.state.map;
    const usage = this.state.settings.data.autoMovement ? (this.usage?.ready ?? null) : null;
    return list.map((c) => {
      const block = bag.pick();
      const movement = usage && map ? usage.mostMovement(block, map.doc.primaryTileset, map.doc.secondaryTileset) : null;
      return movement === null ? { x: c.x, y: c.y, block } : { x: c.x, y: c.y, block, movement };
    });
  }

  private pick(cell: Cell): void {
    const value = this.writer.cellValue(cell);
    if (value === null) return;
    this.state.selectBlock(value & 0x3ff);
    const block = this.state.selection.blocks[0] ?? 0;
    // パレットで選んだときと同じく「3層」の印も出す（#339）
    this.state.setStatus(ja.statusBlock(block) + tripleStatusSuffix(this.state.map?.tiles.triple ?? null, block));
    this.onPicked();
  }

  private hover(cell: Cell | null): void {
    if (cell) this.hoverCell = cell;
    const map = this.state.map;
    // 隣の帯の上（主マップの外）は、表示の補助の欄に隣のマップの座標を出す（#238）ので、ここでは出さない
    if (!cell || !map || !map.doc.grid.inBounds(cell.x, cell.y)) return;
    this.state.setStatus(ja.statusMapCell(cell.x, cell.y, formatHex(map.doc.grid.getBlock(cell.x, cell.y), 4)));
  }
}
