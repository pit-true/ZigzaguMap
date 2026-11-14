import type { App } from "../App";
import { neighborRange } from "../neighbors/NeighborService";
import type { AutomationRequest, CommandTable } from "./registry";

/**
 * 隣のマップの帯（Phase3 #223）。
 * - `neighbors.state {wait?}`: 見せ方の設定、帯の幅、隣の一覧（接続の番号・向き・相手・ずれ・置き場所・見せる部分）、
 *   主マップのまわりの余白、描き終えたか（`done`）、切り替え始めてから描き終えるまでの時間（`neighborsMs`）、帯を作る時間（`buildMs`）。
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
    neighbors: (current?.bands ?? []).map((b) => {
      const p = b.placement;
      return { index: p.index, direction: p.direction, side: p.side, bank: p.id.bank, map: p.id.map, offset: p.offset, placement: p.placement, band: p.band, bandAt: p.bandAt };
    }),
  };
}

export const neighborCommands: CommandTable = {
  "neighbors.state": state,
};
