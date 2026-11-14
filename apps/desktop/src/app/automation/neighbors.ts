import type { App } from "../App";
import { neighborRange } from "../neighbors/NeighborService";
import type { Side } from "@zigzagumap/core";
import { openContextMenu } from "../../ui/ContextMenu";
import { settle, str, type AutomationRequest, type CommandTable } from "./registry";

/**
 * 隣のマップの帯（Phase3 #223）。
 * - `neighbors.state {wait?}`: 見せ方の設定、帯の幅、隣の一覧（接続の番号・向き・相手・ずれ・置き場所・見せる部分）、
 *   主マップのまわりの余白、主マップの接続の全部（`connections`。ダイブ・浮上も）、描き終えたか（`done`）、切り替え始めてから描き終えるまでの時間（`neighborsMs`）、帯を作る時間（`buildMs`）。
 *   `wait: true` なら描き終えるまで待ってから返す。
 */
async function state(app: App, req: AutomationRequest): Promise<unknown> {
  const service = app.neighbors;
  if (req["wait"] === true) await service.settle();
  const view = app.state.settings.data.neighborView;
  const frame = service.frame;
  const main = app.state.map;
  const current = frame && main && frame.main.bank === main.id.bank && frame.main.map === main.id.map ? frame : null;
  return {
    view,
    range: neighborRange(view) ?? null,
    done: service.done,
    neighborsMs: Math.round(service.lastMs * 10) / 10,
    buildMs: Math.round(service.lastBuildMs * 10) / 10,
    margins: current?.layout.margins ?? { left: 0, top: 0, right: 0, bottom: 0 },
    connectedSides: current?.layout.connectedSides ?? [],
    // 主マップの接続の全部（ダイブ・浮上も。帯に出ないものも含む）
    connections: (main?.doc.connections ?? []).map((c, index) => ({ index, direction: c.direction, offset: c.offset, bank: c.bank, map: c.map })),
    neighbors: (current?.bands ?? []).map((b) => {
      const p = b.placement;
      return { index: p.index, direction: p.direction, side: p.side, bank: p.id.bank, map: p.id.map, offset: p.offset, placement: p.placement, band: p.band, bandAt: p.bandAt };
    }),
  };
}

/**
 * `connection.handles`: 辺のつまみ（`edge:<up|down|left|right>`、`side`・`at`）と、隣の帯のつまみの一覧（`id`（`corner:<接続の番号>:<start|end>`）、接続の番号・向き・相手・ずれ、
 * つまみの中心のマス `at`（主マップの左上が原点））。つまみは `mouse` の `target: "connectionHandle"`・`handle: <id>` でドラッグする。
 */
function handles(app: App): unknown {
  const edges = app.edgeHandles.list().map((h) => ({ id: h.id, side: h.side, at: h.at }));
  return [...edges, ...app.connectionHandles.list().map((h) => ({
    id: h.id,
    end: h.end,
    index: h.placement.index,
    direction: h.placement.direction,
    side: h.placement.side,
    bank: h.placement.id.bank,
    map: h.placement.id.map,
    offset: h.placement.offset,
    at: h.at,
  }))];
}

/** `connection.menu {side}`: 辺のつまみの右クリックのメニューを出し、項目（`id`・`label`・`enabled`）を返す。押すのは `contextMenu.press`。 */
async function menu(app: App, req: AutomationRequest): Promise<unknown> {
  const side = str(req, "side");
  if (!["up", "down", "left", "right"].includes(side)) throw new Error(`side は up / down / left / right のどれかです: ${side}`);
  app.edgeHandles.openMenu(side as Side);
  await settle();
  return (openContextMenu()?.items ?? []).map((i) => ({ id: i.id, label: i.label, enabled: i.enabled !== false }));
}

/** `resize.refs`: 最後の辺のつまみのリサイズ（左・上）で見つけた、直していない `.s` の座標の行（#231）。 */
function refs(app: App): unknown {
  return app.edgeResize.lastRefs;
}

export const neighborCommands: CommandTable = {
  "resize.refs": refs,
  "neighbors.state": state,
  "connection.handles": handles,
  "connection.menu": menu,
};
