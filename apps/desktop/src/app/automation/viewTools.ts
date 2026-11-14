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

/**
 * `town.state {wait?}`: タウンマップの小窓（#306）。出しているか `open`、読み込み済みか `loaded`、面 `page`、今のマップの地名 `region`、
 * 赤い枠 `frame`（タウンマップのマス。無ければ null）、マウスの下の地名 `hovered`、下の欄の文 `label`。`wait: true` なら読み込みを待つ。
 * 小窓を作っていなければ作らずに `open: false` を返す。
 */
async function townState(app: App, req: AutomationRequest): Promise<unknown> {
  const town = app.views.townIfCreated();
  if (!town) return { open: false, loaded: false };
  if (req["wait"] === true) await town.settle();
  return {
    open: town.isOpen,
    loaded: town.loaded,
    page: town.currentPage,
    region: town.currentRegion,
    frame: town.frameRect(),
    hovered: town.hovered,
    label: document.querySelector<HTMLElement>('[data-auto-id="town.label"]')?.textContent ?? null,
  };
}

/** `town.pick {x, y}`: 小窓のマス（タウンマップの座標）を押したのと同じ。返事は地名（無ければ null）と一覧の絞り込みの文。 */
async function townPick(app: App, req: AutomationRequest): Promise<unknown> {
  const town = await app.views.town();
  const region = town.pick(int(req, "x"), int(req, "y"));
  return { region, filter: app.treeFilter.input.value };
}

export const viewToolCommands: CommandTable = {
  "town.state": townState,
  "town.pick": townPick,
  "seams.state": seamsState,
  "catalog.get": catalogGet,
};
