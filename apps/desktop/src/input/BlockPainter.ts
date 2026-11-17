import { brushShapeCells, formatHex } from "@zigzagumap/core";
import type { BlockUsageService } from "../app/BlockUsageService";
import type { BlockSelection } from "../app/EditorState";
import type { EditorState } from "../app/EditorState";
import type { MixingBag } from "../app/MixingBag";
import { ja } from "../i18n/ja";
import type { Cell, MapView } from "../ui/map/MapView";
import type { AutoPenTool } from "./tools/AutoPenTool";
import { BlockDragTools, type DragToolKind, type PickedRect } from "./tools/BlockDragTools";
import { BlockWriter } from "./BlockWriter";
import { attachCellPointer } from "./CellPointer";
import { MapCells } from "./MapCells";
import { usableSelection } from "./paintCommands";
import { tileRect, type CellRect, type FillCell } from "./paintPlans";
import { PreviewCanvas } from "./PreviewCanvas";
import { tripleStatusSuffix } from "./tripleRules";
import { brushFor, currentTool, pressKind, type Brush, type PressKind } from "../app/paintTool";
import { BlockFillTool } from "./tools/FillTool";
import { LineGuide } from "./tools/LineGuide";
import { SelectMoveTool } from "./tools/SelectMoveTool";
import { ShiftTool } from "./tools/ShiftTool";
import { SmartPathTool } from "./tools/SmartPathTool";

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
 * 入れ替え）は BlockDragTools、オートペンは AutoPenTool、書き込み（3 層の次の番号を落とす所を含む）は BlockWriter。
 *
 * Phase5（#388・#389・#390）: 道具の帯で選んだ道具（app/paintTool.ts）で左ボタンの動きを変える。鉛筆のときは上のとおり（今と同じ）。
 * - 塗りつぶし: 左クリックで塗りつぶし（tools/FillTool）、Ctrl＋クリックでマジック塗り。Alt＋左ドラッグの入れ替えはそのまま。
 * - シフト: 左ドラッグでマップシフト（tools/ShiftTool）。Ctrl＋左ドラッグの矩形塗りと Alt＋左ドラッグの入れ替えはそのまま。
 * - 直線: 鉛筆（とスマートパス・オートペン）で Shift を押しながら描くと、横か縦に固定する（tools/LineGuide）。
 * - スマートパス: 帯のチェックがオンで選択が 3×3 なら、鉛筆と塗りつぶしをこれで描く（tools/SmartPathTool）。オートペンが先。
 *
 * Phase7 #515: 鉛筆のブラシの大きさ（2〜9）と形（正方形・円）。1 ブロックを選んでいて、オートペンが受けないときだけ、
 * カーソルのマスを真ん中にした形のマスへ描く（Shift の直線もその幅）。袋を使う選択なら、マスごとに袋から重みで選ぶ。
 * 1 回のドラッグの中で描いたマスは描き直さない（袋の絵がドラッグの間に変わらないように）。大きさ 1 は今までと同じ。
 * Phase7 #516: 道具が選択なら、左ドラッグで範囲を選び、範囲の中のドラッグで動かす（tools/SelectMoveTool）。
 */
export class BlockPainter {
  /** 最後にマウスが乗っていたマス（Ctrl+V で貼る位置）。 */
  hoverCell: Cell | null = null;
  /** 画面のマスとマップのマスの対応（隣の帯は App が `cells.neighbors` を入れる）。 */
  readonly cells: MapCells;
  /** ブロックの書き込み（オートペン・マップ作成補助・境界ブロックも使う）。 */
  readonly writer: BlockWriter;
  /** ドラッグの道具（矩形の選択・矩形塗り・入れ替え）。 */
  readonly drags: BlockDragTools;
  /** ミキシングバッグ（MapTab が入れる）。 */
  bag: MixingBag | null = null;
  /** ブロックの使用回数（袋から描くときの移動許可。App が入れる）。 */
  usage: BlockUsageService | null = null;
  /** オートペン（Phase4 #310。PenExtras が入れる）。オンでパーツのブロックを選んでいれば、左ボタンの描画を受ける。 */
  autoPen: AutoPenTool | null = null;
  /** 塗りつぶしとマジック塗り（Phase5 #388）。 */
  readonly fill: BlockFillTool;
  /** マップシフト（Phase5 #390）。 */
  readonly shift: ShiftTool;
  /** スマートパス（Phase5 #389）。 */
  readonly smartPath: SmartPathTool;
  /** 範囲を選んで動かす（Phase7 #516）。 */
  readonly select: SelectMoveTool;
  /** 直線（Phase5 #389）。 */
  private readonly line = new LineGuide();
  /** 押したときに決めた操作（離すまで変えない）。 */
  private press: PressKind = null;
  /** ブラシで、この押下の間に描いたマス（`x,y`）。 */
  private readonly stroke = new Set<string>();

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
    this.shift = new ShiftTool(view, state, preview);
    this.smartPath = new SmartPathTool(state, this.writer);
    this.select = new SelectMoveTool(view, state, this.writer, preview, "map");
    this.fill = new BlockFillTool(state, {
      cells: this.cells,
      writeFill: (list) => this.writeTiled(list),
      smartFill: (area) => this.smartPath.fill(area),
    });
    const startDrag = (tool: DragToolKind, cell: Cell): void => this.drags.start(tool, cell);
    attachCellPointer(view.stage, (e) => this.cellAt(e), {
      down: (cell, g) => {
        const kind = pressKind(currentTool(state), g, true);
        this.press = kind;
        if (kind === "fill") {
          // 塗りつぶし（Ctrl＋クリックでマジック塗り）。ダブルクリックで隣のマップを開くときは取り消せるよう覚える
          this.cells.pressStart();
          this.fill.fill(cell, g.ctrl);
        } else if (kind === "shift") this.shift.begin(cell, g.shift);
        else if (kind === "select") this.select.begin(cell);
        else if (kind === "rect" || kind === "swap" || kind === "pick") startDrag(kind, cell);
        else if (kind === "pencil") {
          // ダブルクリックで隣のマップを開くとき、この押下で描いた分を取り消せるよう覚える
          this.cells.pressStart();
          this.line.begin(cell, g.shift);
          if (this.autoPen?.begin(cell)) return;
          if (this.smartPath.begin(cell)) return;
          this.paint(cell, false);
        }
      },
      move: (cell, g, live) => {
        if (this.shift.active) return this.shift.move(cell, live.shift);
        if (this.select.active) return this.select.move(cell);
        const dragging = this.drags.tool !== null;
        if (dragging) return this.drags.move(cell);
        // 塗りつぶしは押したときに 1 回だけ
        if (g.button !== 0 || this.press !== "pencil") return;
        for (const c of this.line.next(cell, live.shift)) {
          if (this.autoPen?.drag(c)) continue;
          if (this.smartPath.drag(c)) continue;
          if (this.isSingle()) this.paint(c, true);
        }
      },
      up: (cell, g) => {
        this.cells.pressEnd();
        this.autoPen?.end();
        this.smartPath.end();
        this.line.end();
        this.press = null;
        if (this.shift.end()) return;
        if (this.select.end(cell)) return;
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

  /** 今の鉛筆のブラシ（大きさ 2 以上で、1 ブロックを選んでいて、オートペンが受けないとき。カーソルの枠にも使う）。 */
  currentBrush(): Brush | null {
    if (currentTool(this.state) !== "pencil" || this.autoPen?.partForSelection()) return null;
    return brushFor(this.state, this.state.selection);
  }

  private paint(cell: Cell, merge: boolean): void {
    const brush = brushFor(this.state, this.state.selection);
    if (brush) return this.paintBrush(cell, brush, merge);
    this.paintSelection(cell, this.state.selection, merge);
  }

  /** ブラシの形のマスへ 1 ブロックを置く（`merge` でなければ新しい押下。描いたマスの記録をやり直す）。 */
  private paintBrush(cell: Cell, brush: Brush, merge: boolean): void {
    if (!merge) this.stroke.clear();
    const sel = usableSelection(this.state.selection);
    const block = sel.blocks[0] ?? 0;
    const movement = sel.movements?.[0];
    const list: FillCell[] = [];
    for (const c of brushShapeCells(cell.x, cell.y, brush.size, brush.shape)) {
      const key = `${c.x},${c.y}`;
      if (this.stroke.has(key)) continue;
      this.stroke.add(key);
      list.push(movement === undefined ? { x: c.x, y: c.y, block } : { x: c.x, y: c.y, block, movement });
    }
    if (list.length === 0) return;
    if (this.bag?.appliesTo(this.state.selection)) return this.writer.write(this.fromBag(list), true, merge, true);
    this.writer.write(list, true, merge);
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
    this.writeTiled(tileRect(rect, this.state.selection));
  }

  /** 選択の柄で埋めたマスを 1 回の操作で書く（矩形塗りと塗りつぶし。袋を使う選択なら各マスを袋から選ぶ）。 */
  private writeTiled(list: readonly FillCell[]): void {
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
