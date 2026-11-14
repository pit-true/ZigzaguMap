import type { App } from "../App";
import { int, type AutomationRequest, type CommandTable } from "./registry";

/**
 * Phase4 の表示・一覧・調査（列 3）の命令。
 * - `seams.state {wait?}`: 接続の境目の注意（#305）。点検した主マップ `map`、調べ終えたか `done`、崩れるマスのある接続 `issues`
 *   （接続の番号 `index`・`side`・相手 `id`・マスの数 `count`・マス `cells`（主マップの左上が原点））、ステータスバーの注意の文 `status`
 *   （出ていなければ null）、主マップのタイルセット `tilesets` と上下左右の接続の相手のタイルセット `connections`（`index`・`bank`・`map`・
 *   `primary`・`secondary`。ポインタの値）。`wait: true` なら調べ終えるまで待つ。
 */
async function seamsState(app: App, req: AutomationRequest): Promise<unknown> {
  const seams = app.views.seams;
  if (req["wait"] === true) await seams.settle();
  const r = seams.current;
  const el = app.views.seamNotice.element;
  const session = app.state.session;
  const doc = app.state.map?.doc;
  const connections = [];
  for (const [index, c] of (doc?.connections ?? []).entries()) {
    if (c.direction < 1 || c.direction > 4 || !session) continue;
    const nd = session.project.loaded(c) ?? (await session.project.peek(c).catch(() => null));
    connections.push({ index, bank: c.bank, map: c.map, primary: nd ? nd.primaryTileset >>> 0 : null, secondary: nd ? nd.secondaryTileset >>> 0 : null });
  }
  return {
    tilesets: doc ? { primary: doc.primaryTileset >>> 0, secondary: doc.secondaryTileset >>> 0 } : null,
    connections,
    map: r.map,
    done: r.done,
    issues: r.issues.map((i) => ({ index: i.index, side: i.side, id: i.id, count: i.cells.length, cells: i.cells })),
    status: el.hidden ? null : el.textContent,
  };
}

/** `catalog.get {bank, map}`: マップ一覧の情報（地名の番号 `region`・配置の番号 `layoutId`・名前・タイルセットの番号）。無ければ null。 */
function catalogGet(app: App, req: AutomationRequest): unknown {
  return app.state.session?.catalog.get({ bank: int(req, "bank"), map: int(req, "map") }) ?? null;
}

export const viewToolCommands: CommandTable = {
  "seams.state": seamsState,
  "catalog.get": catalogGet,
};
