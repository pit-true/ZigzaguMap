import { SmartPath, lineCells, type PenWrite } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { currentTool } from "../../app/paintTool";
import type { Cell } from "../../ui/map/MapView";
import type { AutoPenHost } from "../AutoPenTool";
import type { FillCell } from "../paintPlans";

/** 描いたマスのまわりで、縁を選び直すかもしれない幅（読み込む隣のマップを決める）。 */
const AREA_MARGIN = 2;

/**
 * スマートパス（Phase5 #389。Q4 の推奨）。マップタブの道具の帯の「スマートパス」がオンで、選択がちょうど 3×3 のとき、
 * 鉛筆と塗りつぶしの描画をこれが受ける。9 マスを縁つきの一時的なパーツにして、オートペンの縁つきの解き方で描く（core の SmartPath）。
 * 移動許可は、選択が移動許可を持ち（マップから拾ったもの）「移動許可も貼る」がオンなら見本のマスのものを書く。
 * 1 回のドラッグ（塗りつぶしは 1 回の塗り）で 1 回の「元に戻す」。
 */
export class SmartPathTool {
  private stroke: { path: SmartPath; last: Cell } | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly host: AutoPenHost,
  ) {}

  /** 今の選択で描くスマートパス（オフ・3×3 でない・道具が合わないときは null）。 */
  current(): SmartPath | null {
    if (!this.state.settings.data.smartPath || this.state.tab !== "map") return null;
    const tool = currentTool(this.state);
    if (tool !== "pencil" && tool !== "fill") return null;
    const s = this.state.selection;
    if (s.holes?.some((h) => h)) return null;
    return SmartPath.of(s.width, s.height, s.blocks, s.movements?.length === 9 ? s.movements : undefined);
  }

  /** 鉛筆で押した。スマートパスで描くなら true。 */
  begin(cell: Cell): boolean {
    const path = this.current();
    if (!path) return false;
    this.stroke = { path, last: cell };
    this.paint(path, [[cell.x, cell.y]], false);
    return true;
  }

  /** ドラッグ中（マスが変わったとき）。スマートパスで描いているなら true。 */
  drag(cell: Cell): boolean {
    const s = this.stroke;
    if (!s) return false;
    const cells = lineCells(s.last.x, s.last.y, cell.x, cell.y).slice(1);
    s.last = cell;
    if (cells.length > 0) this.paint(s.path, cells, true);
    return true;
  }

  /** 離した。 */
  end(): void {
    this.stroke = null;
  }

  /** 塗りつぶしの範囲を描く（スマートパスで描いたら true）。 */
  fill(area: readonly Cell[]): boolean {
    const path = this.current();
    if (!path) return false;
    this.paint(
      path,
      area.map((c) => [c.x, c.y] as const),
      false,
    );
    return true;
  }

  private paint(path: SmartPath, cells: readonly (readonly [number, number])[], merge: boolean): void {
    const source = { get: (x: number, y: number) => this.host.cellValue({ x, y }) };
    const plan = (): readonly FillCell[] => path.stroke(source, cells).map(toFillCell);
    this.host.writePlanned(areaAround(cells, AREA_MARGIN), plan, merge, false);
  }
}

function toFillCell(w: PenWrite): FillCell {
  return w.movement === undefined ? { x: w.x, y: w.y, block: w.block } : { x: w.x, y: w.y, block: w.block, movement: w.movement };
}

/** マスの一覧を囲む矩形を `margin` マス広げたもの。 */
function areaAround(cells: readonly (readonly [number, number])[], margin: number): Cell[] {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of cells) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const out: Cell[] = [];
  for (let y = minY - margin; y <= maxY + margin; y++) for (let x = minX - margin; x <= maxX + margin; x++) out.push({ x, y });
  return out;
}
