import { floodRegion, matchingCells, patternCells, type FillMatch, type FillPoint } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaTools } from "../../i18n/ja.tools";
import type { Cell } from "../../ui/map/MapView";
import type { MapCells } from "../MapCells";

/**
 * 塗りつぶしとマジック塗りの範囲（Phase5 #388）。押したマスのマップ（主マップか、見せている隣の帯のマップ）の中だけで、
 * 押したマスと「同じ」マスを集め、画面のマスにして返す。隣のマップへは広げない。帯で見えていないマスは入れない
 * （ほかの道具と同じく、見えている所にだけ描く）。
 */
export function fillArea(cells: MapCells, cell: Cell, match: FillMatch, magic: boolean): Cell[] {
  const ref = cells.resolve(cell);
  const grid = ref ? cells.gridOf(ref.id) : null;
  if (!ref || !grid) return [];
  const region: FillPoint[] = magic ? matchingCells(grid, ref.x, ref.y, match) : floodRegion(grid, ref.x, ref.y, match);
  // 帯は主マップの座標をずらしたものなので、押したマスとのずれで画面のマスに戻す
  const ox = cell.x - ref.x;
  const oy = cell.y - ref.y;
  const out: Cell[] = [];
  for (const p of region) {
    const c = { x: p.x + ox, y: p.y + oy };
    const r = cells.resolve(c);
    if (r && r.id.bank === ref.id.bank && r.id.map === ref.id.map && r.x === p.x && r.y === p.y) out.push(c);
  }
  return out;
}

/** 塗ったマスの数をステータスバーに出す。 */
export function reportFill(state: EditorState, count: number, magic: boolean): void {
  if (count === 0) state.setStatus(jaTools.fillNothing);
  else state.setStatus(magic ? jaTools.magicFilled(count) : jaTools.filled(count));
}

/** マップタブの塗りつぶしが使うもの（BlockPainter が渡す）。 */
export interface BlockFillHost {
  readonly cells: MapCells;
  /** 柄で埋めたマスを書く（袋・3 層の次の番号・移動許可の扱いは鉛筆の矩形塗りと同じ）。 */
  writeFill(list: ReturnType<typeof patternCells>): void;
  /** スマートパスで書く（スマートパスがオンで選択が 3×3 のときだけ true を返して書く）。 */
  smartFill(area: readonly Cell[]): boolean;
}

/**
 * マップタブの塗りつぶし（B）とマジック塗り（塗りつぶしで Ctrl＋クリック）。「同じ」はブロックだけで見る（Q2 の推奨）。
 * 選択が複数マス（スタンプ）なら押したマスを左上にして柄をくり返す。1 回の塗りは 1 回の「元に戻す」。
 */
export class BlockFillTool {
  constructor(
    private readonly state: EditorState,
    private readonly host: BlockFillHost,
  ) {}

  fill(cell: Cell, magic: boolean): number {
    const area = fillArea(this.host.cells, cell, "block", magic);
    if (area.length > 0) {
      if (!this.host.smartFill(area)) this.host.writeFill(patternCells(area, cell, this.state.selection));
    }
    reportFill(this.state, area.length, magic);
    return area.length;
  }
}
