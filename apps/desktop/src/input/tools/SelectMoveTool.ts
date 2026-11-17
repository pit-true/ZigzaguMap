import { clampRegionMove, clipRegion, planRegionMove, widenForTriple, type RegionCell, type RegionFill, type RegionRect } from "@zigzagumap/core";
import type { BlockUsageService } from "../../app/BlockUsageService";
import { selectionWrites, type EditorState } from "../../app/EditorState";
import { matchesKey } from "../../app/keymap";
import { currentTool } from "../../app/paintTool";
import { jaPaint } from "../../i18n/ja.paint";
import { jaTools } from "../../i18n/ja.tools";
import type { Cell, MapView } from "../../ui/map/MapView";
import type { BlockWriter } from "../BlockWriter";
import { rectOf } from "../paintPlans";
import type { PreviewCanvas } from "../PreviewCanvas";
import { drawPreviewBlocks } from "../previewDraw";

/** ドラッグ中の操作。 */
type Drag =
  | { readonly mode: "select"; readonly anchor: Cell; last: Cell; moved: boolean; cancelled: boolean }
  | { readonly mode: "move"; readonly anchor: Cell; readonly rect: RegionRect; dx: number; dy: number; cancelled: boolean };

/**
 * 範囲を選んで動かす道具（Phase7 #516。Q8 の推奨）。道具が「選択」（M）のとき、マップタブと移動エリアタブの左ボタンで使う。
 * - 範囲の外で左ドラッグ: 矩形を選ぶ（点線の枠）。範囲は表示中のマップの中だけ（隣のマップの帯の上では選べない。はみ出た分は切る）。
 *   右端で 3 層のブロックと次の番号を切るときは 1 マス広げる（今の矩形の選択と同じ）。
 * - 範囲の中で左ドラッグ: ブロックと移動許可を一緒に動かす。ドラッグの間は下見を出し、マップの端で止める。離すと 1 回の操作。
 *   動かした跡は今選んでいるブロック（スタンプは跡の左上からくり返す）で埋める。移動許可は、選択が移動許可を持ち「移動許可も貼る」が
 *   オンならそれ、「移動許可を自動で選ぶ」がオンならそのブロックにいちばん多いもの、どちらでもなければそのマスの今の値。
 *   3 層の次の番号は、ほかの描き方と同じく BlockWriter が書かない。イベントは動かさない（#399 のまとめての移動で動かす）。
 * - 範囲の外のクリック（ドラッグしない）か Esc で選択を外す。ドラッグ中の Esc はドラッグだけやめる。選択は履歴に入れない。
 * 道具を変えたとき・マップを変えたときも選択を外す。
 */
export class SelectMoveTool {
  /** 今の選択（無ければ null）。 */
  private rectValue: RegionRect | null = null;
  private drag: Drag | null = null;
  private readonly frame: HTMLElement;
  /** 選んだときのマップ（変わったら外す）。 */
  private mapKey = "";
  /** 跡の移動許可を自動で選ぶときの使用回数（App が入れる）。 */
  usage: BlockUsageService | null = null;

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly writer: BlockWriter,
    private readonly preview: PreviewCanvas,
    /** この道具を置いたタブ（キーはそのタブを出しているときだけ受ける）。 */
    private readonly tab: "map" | "movement",
  ) {
    this.frame = document.createElement("div");
    this.frame.className = "map-select-frame";
    this.frame.hidden = true;
    view.stage.append(this.frame);
    document.addEventListener("keydown", (e) => {
      if (!matchesKey("drag.cancel", e) || this.state.tab !== this.tab) return;
      if (this.drag) {
        if (this.drag.cancelled) return;
        e.preventDefault();
        this.drag.cancelled = true;
        this.preview.end();
        this.state.setStatus(jaPaint.dragCancelled);
      } else if (this.rectValue) {
        e.preventDefault();
        this.clear(true);
      }
    });
    state.on("tool", () => {
      if (currentTool(state) !== "select") this.clear(false);
    });
    state.on("map", () => {
      if (this.rectValue && this.keyOfMap() !== this.mapKey) this.clear(false);
    });
    for (const topic of ["view", "neighbors", "tab", "map"] as const) state.on(topic, () => this.place());
  }

  /** 今の選択（自動操作用）。 */
  get rect(): RegionRect | null {
    return this.rectValue;
  }

  /** ドラッグ中か。 */
  get active(): boolean {
    return this.drag !== null;
  }

  /** 押した。範囲の中なら動かし始め、外なら選び始める（帯の上なら選択を外すだけ）。 */
  begin(cell: Cell): void {
    const map = this.state.map;
    if (!map) return;
    const r = this.rectValue;
    if (r && inside(r, cell)) {
      this.drag = { mode: "move", anchor: cell, rect: r, dx: 0, dy: 0, cancelled: false };
      this.drawMove();
      return;
    }
    if (!map.doc.grid.inBounds(cell.x, cell.y)) {
      this.clear(true);
      return;
    }
    this.drag = { mode: "select", anchor: cell, last: cell, moved: false, cancelled: false };
  }

  /** 動かした。 */
  move(cell: Cell): void {
    const d = this.drag;
    const map = this.state.map;
    if (!d || d.cancelled || !map) return;
    if (d.mode === "select") {
      if (cell.x === d.last.x && cell.y === d.last.y) return;
      d.last = cell;
      d.moved = true;
      const r = this.clipped(rectOf(d.anchor, cell));
      this.place(r);
      if (r) this.state.setStatus(jaTools.selecting(r.width, r.height));
      return;
    }
    const m = clampRegionMove(d.rect, cell.x - d.anchor.x, cell.y - d.anchor.y, map.doc.width, map.doc.height);
    if (m.dx === d.dx && m.dy === d.dy) return;
    d.dx = m.dx;
    d.dy = m.dy;
    this.drawMove();
  }

  /** 離した。ドラッグ中だったら true。 */
  end(cell: Cell | null): boolean {
    const d = this.drag;
    this.drag = null;
    if (!d) return false;
    if (d.mode === "move") this.preview.end();
    if (d.cancelled) {
      this.place();
      return true;
    }
    if (d.mode === "move") {
      this.moveRegion(d.rect, d.dx, d.dy);
      return true;
    }
    // ドラッグせずに離したら選択を外す（範囲の外のクリック）
    const last = cell ?? d.last;
    if (!d.moved && last.x === d.anchor.x && last.y === d.anchor.y) {
      this.clear(true);
      return true;
    }
    this.select(rectOf(d.anchor, last));
    return true;
  }

  /** 矩形を選ぶ（マップの中に切り、3 層を切るなら広げる。自動操作からも使う）。選べたら true。 */
  select(rect: RegionRect): boolean {
    const r = this.clipped(rect);
    if (!r) {
      this.clear(false);
      return false;
    }
    this.rectValue = r;
    this.mapKey = this.keyOfMap();
    this.place();
    this.state.setStatus(jaTools.selected(r.width, r.height));
    return true;
  }

  /** 選択を外す（`report` ならステータスバーに出す）。 */
  clear(report: boolean): void {
    if (this.drag?.mode === "move") this.preview.end();
    this.drag = null;
    const had = this.rectValue !== null;
    this.rectValue = null;
    this.place();
    if (report && had) this.state.setStatus(jaTools.selectCleared);
  }

  /**
   * 矩形の中を `dx`・`dy` だけ動かす（端で止める。1 回の操作）。動かしたら選択も動かした先にする。動かした量を返す（動かなければ null）。
   */
  moveRegion(rect: RegionRect, dx: number, dy: number): { dx: number; dy: number } | null {
    const map = this.state.map;
    if (!map) return null;
    const grid = map.doc.grid;
    const m = clampRegionMove(rect, dx, dy, grid.width, grid.height);
    if (m.dx === 0 && m.dy === 0) {
      this.place();
      return null;
    }
    const list: RegionCell[] = planRegionMove((x, y) => grid.getCell(x, y), rect, m.dx, m.dy, this.fill(rect));
    this.writer.write(list, false, false, true);
    this.rectValue = { ...rect, x: rect.x + m.dx, y: rect.y + m.dy };
    this.mapKey = this.keyOfMap();
    this.place();
    this.state.setStatus(jaTools.regionMoved(m.dx, m.dy));
    return m;
  }

  /** 跡を埋めるもの（今の選択。スタンプは跡の矩形の左上からくり返す。穴のマスは書かない）。 */
  private fill(rect: RegionRect): RegionFill {
    const s = this.state.selection;
    const map = this.state.map!;
    const grid = map.doc.grid;
    const settings = this.state.settings.data;
    const usage = settings.autoMovement ? (this.usage?.ready ?? null) : null;
    const ownMovements = settings.pasteMovements && s.movements !== undefined && s.movements.length === s.blocks.length;
    return (x, y) => {
      const i = (((y - rect.y) % s.height) + s.height) % s.height * s.width + ((((x - rect.x) % s.width) + s.width) % s.width);
      if (!selectionWrites(s, i)) return null;
      const block = s.blocks[i] ?? 0;
      let movement = ownMovements ? s.movements![i]! : null;
      if (movement === null && usage) movement = usage.mostMovement(block, map.doc.primaryTileset, map.doc.secondaryTileset);
      return { block, movement: movement ?? grid.getMovement(x, y) };
    };
  }

  /** マップの中に切り、右端で 3 層を切るなら 1 マス広げる。 */
  private clipped(rect: RegionRect): RegionRect | null {
    const map = this.state.map;
    if (!map) return null;
    const grid = map.doc.grid;
    const r = clipRegion(rect, grid.width, grid.height);
    if (!r) return null;
    const triple = map.tiles.triple;
    return widenForTriple(r, (x, y) => grid.getCell(x, y), (b) => triple.isTriple(b), grid.width);
  }

  /** 下見: 跡を埋める絵と、動かした先の絵（今の絵の写し）と枠。 */
  private drawMove(): void {
    const d = this.drag;
    const map = this.state.map;
    if (!d || d.mode !== "move" || !map) return;
    const p = this.preview.begin();
    const { rect, dx, dy } = d;
    if (dx !== 0 || dy !== 0) {
      const fill = this.fill(rect);
      const cells = planRegionMove(() => 0, rect, dx, dy, fill).slice(rect.width * rect.height);
      drawPreviewBlocks(p, map.tiles, cells, 1);
    }
    const base = this.view.stage.querySelector<HTMLCanvasElement>("canvas.map-base");
    const c = p.c;
    c.save();
    c.imageSmoothingEnabled = false;
    const tx = p.ox + (rect.x + dx) * p.size;
    const ty = p.oy + (rect.y + dy) * p.size;
    const w = rect.width * p.size;
    const h = rect.height * p.size;
    if (base && base.width > 0) {
      // ブロックの画像は等倍（1 マス 16 画素）で持っている
      const k = base.width / map.doc.width;
      c.drawImage(base, rect.x * k, rect.y * k, rect.width * k, rect.height * k, tx, ty, w, h);
    }
    const layer = this.view.overlayHidden ? null : this.view.layer;
    if (layer && layer.width > 0) {
      const k = layer.width / map.doc.width;
      c.drawImage(layer, rect.x * k, rect.y * k, rect.width * k, rect.height * k, tx, ty, w, h);
    }
    // 下見の Canvas は点線の枠の要素より上に重なるので、枠もここに描く
    c.lineWidth = 1;
    c.setLineDash([4, 4]);
    c.strokeStyle = "#000000";
    c.strokeRect(tx + 1.5, ty + 1.5, w - 3, h - 3);
    c.strokeStyle = "#ffffff";
    c.strokeRect(tx + 0.5, ty + 0.5, w - 1, h - 1);
    c.restore();
    this.place({ ...rect, x: rect.x + dx, y: rect.y + dy });
    this.state.setStatus(jaTools.regionMoving(dx, dy));
  }

  /** 点線の枠を置く（`r` を渡せばその矩形。省けば、動かしている間は動かした先、ほかは今の選択）。 */
  private place(r?: RegionRect | null): void {
    const d = this.drag;
    const rect = r !== undefined ? r : d?.mode === "move" ? { ...d.rect, x: d.rect.x + d.dx, y: d.rect.y + d.dy } : this.rectValue;
    if (!rect || this.view.mapSize.width === 0) {
      this.frame.hidden = true;
      return;
    }
    const size = this.view.cellSize;
    const o = this.view.originPx;
    this.frame.hidden = false;
    this.frame.style.left = `${o.x + rect.x * size}px`;
    this.frame.style.top = `${o.y + rect.y * size}px`;
    this.frame.style.width = `${rect.width * size}px`;
    this.frame.style.height = `${rect.height * size}px`;
  }

  private keyOfMap(): string {
    const id = this.state.map?.id;
    return id ? `${id.bank}.${id.map}` : "";
  }
}

function inside(r: RegionRect, c: Cell): boolean {
  return c.x >= r.x && c.y >= r.y && c.x < r.x + r.width && c.y < r.y + r.height;
}
