import { resolveCell } from "@zigzagumap/core";
import type { EditorState, TabId } from "../../app/EditorState";
import type { NeighborService } from "../../app/neighbors/NeighborService";
import { jaViewExtras as t } from "../../i18n/ja.viewExtras";
import { movementName } from "../../input/MovementPainter";
import { blockAttribute } from "../event/warpCheck";
import { ctrlPeek } from "./ctrlPeek";
import type { Cell, MapView } from "./MapView";

/** 挙動の番号の部分。 */
const BEHAVIOR_MASK = 0x1ff;

/**
 * マップのタブ（マップ・移動エリア・イベント）の表示の補助（#238）。
 * - Ctrl を押している間、移動エリアタブとイベントタブの重ね描き（移動許可・イベントの箱）を隠す。Ctrl＋ドラッグの間も隠れたまま。
 *   マップタブの重ね描きは矩形選択の枠だけなので隠さない。
 * - ステータスバーの補助の欄（AdvanceMap と同じ左の欄はそのまま）: Ctrl＋ドラッグ（矩形選択・矩形塗り）の間は押したマスからの
 *   「W×H」、隣のマップの帯の上では「隣のマップ名 (x, y)」、マップタブのブロックの上では番号・移動許可・挙動（Q8）。
 */
export function installViewExtras(view: MapView, state: EditorState, tab: TabId, neighbors: NeighborService): void {
  const hides = tab === "movement" || tab === "event";
  const apply = (): void => {
    if (hides) view.setOverlayHidden(ctrlPeek.held && state.tab === tab);
  };
  ctrlPeek.on(apply);
  state.on("tab", apply);

  let start: Cell | null = null;
  const stage = view.stage;
  stage.addEventListener("pointerdown", (e) => {
    start = e.ctrlKey ? view.rawCellAt(e) : null;
  });
  const finish = (): void => {
    if (start) state.setStatusInfo("");
    start = null;
  };
  stage.addEventListener("pointerup", finish);
  stage.addEventListener("pointercancel", finish);
  stage.addEventListener("pointermove", (e) => {
    if (state.tab !== tab || !state.map) return;
    const raw = view.rawCellAt(e);
    if (e.buttons !== 0) {
      // Ctrl＋ドラッグ: 押したマスから今のマスまでの大きさ
      if (tab === "map" && start && e.ctrlKey) {
        const w = Math.abs(raw.x - start.x) + 1;
        const h = Math.abs(raw.y - start.y) + 1;
        state.setStatusInfo(t.rect(Math.min(raw.x, start.x), Math.min(raw.y, start.y), w, h));
      }
      return;
    }
    const doc = state.map.doc;
    const inside = raw.x >= 0 && raw.y >= 0 && raw.x < doc.width && raw.y < doc.height;
    if (!inside) {
      const frame = neighbors.frame;
      const hit = frame && view.cellAtAny(e) ? resolveCell(frame.layout, { id: state.map.id, width: doc.width, height: doc.height }, raw.x, raw.y) : null;
      state.setStatusInfo(hit?.neighbor ? t.neighborCell(hit.id.bank, hit.id.map, state.session?.catalog.get(hit.id)?.name ?? null, hit.x, hit.y) : "");
      return;
    }
    if (tab === "map") {
      // Q8: ブロックの番号・移動許可・挙動（BlockPainter の座標とブロックの表示に足す）
      const block = doc.grid.getBlock(raw.x, raw.y);
      const movement = doc.grid.getMovement(raw.x, raw.y);
      const attr = blockAttribute(state.map.tiles, block);
      state.setStatusInfo(t.blockCell(block, movement, movementName(movement), attr === null ? null : attr & BEHAVIOR_MASK));
    } else {
      state.setStatusInfo("");
    }
  });
  stage.addEventListener("pointerleave", () => {
    if (state.tab === tab) state.setStatusInfo("");
  });
  if (tab === "map") {
    state.on("map", () => state.setStatusInfo(""));
    state.on("tab", () => state.setStatusInfo(""));
  }
}
