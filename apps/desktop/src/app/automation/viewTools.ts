import type { App } from "../App";
import { int, num, type AutomationRequest, type CommandTable } from "./registry";

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

/**
 * `pointers.state`: ポインタ一覧（#307）。開いているか `open`、上の説明 `note`、一覧 `rows`（`kind`・`index`・`location`・`value`・`bytes`）、
 * 選んでいる行 `selected`（無ければ -1）、最後の検索 `last`（`value`・`rom`・`hits`（`offset`・`place`）・`ms`・`chunks`）、
 * 最後にコピーした文字 `lastCopied`（自動操作ではクリップボードへ書かない）。窓を作っていなければ作るが、開きはしない。
 */
async function pointersState(app: App): Promise<unknown> {
  const d = await app.views.pointers();
  return {
    open: d.isOpen,
    note: document.querySelector<HTMLElement>(".pointer-note")?.textContent ?? null,
    rows: d.list,
    selected: d.selectedRow,
    last: d.last,
    lastCopied: app.views.lastCopied,
  };
}

/**
 * `pointers.search {address, rom?}`: 参照元を探す（窓を開いてから。`address` は ROM の上の位置かポインタの値の数、`rom` はほかの ROM の
 * パス）。返事は `pointers.state` の `last` と同じ形と、探している間の画面の止まり `maxGapMs`（0ms の待ちを繰り返し、間のいちばん長い時間）。
 */
async function pointersSearch(app: App, req: AutomationRequest): Promise<unknown> {
  const d = await app.views.pointers();
  d.open();
  const rom = typeof req["rom"] === "string" ? req["rom"] : null;
  let last = performance.now();
  let maxGap = 0;
  let running = true;
  const tick = (): void => {
    const now = performance.now();
    maxGap = Math.max(maxGap, now - last);
    last = now;
    if (running) setTimeout(tick, 0);
  };
  setTimeout(tick, 0);
  try {
    const r = await d.search(num(req, "address"), rom);
    return { ...r, maxGapMs: Math.round(maxGap * 10) / 10 };
  } finally {
    running = false;
  }
}

/** `pointers.select {row}`: 一覧の行を押したのと同じ（イベントの行ならイベントタブで選ぶ）。 */
async function pointersSelect(app: App, req: AutomationRequest): Promise<unknown> {
  const d = await app.views.pointers();
  d.selectRow(int(req, "row"));
  return { selected: d.selectedRow };
}

/** `recent.state`: 最近使ったブロック（#308）。`blocks`（新しい順の番号）と、それぞれの持ち主のタイルセット `tilesets`（ポインタ）。 */
function recentState(app: App): unknown {
  const r = app.views.recent;
  return { blocks: r.model.list.map((i) => i.block), tilesets: r.model.list.map((i) => i.tileset) };
}

/**
 * `thumbs.state {wait?}`: マップ一覧のサムネイル（#315）。設定でオンか `enabled`、作っている最中か `running`、作り終えたマップの数 `maps`、
 * 作った絵の数 `images`（配置が同じマップは 1 枚を使い回す）、全部を作るのにかかった時間 `ms`、一覧でサムネイルを描いた行の数 `rows`
 * （開いている枝の分だけ）。`wait: true` なら作り終えるまで待つ。
 */
async function thumbsState(app: App, req: AutomationRequest): Promise<unknown> {
  const t = app.views.thumbnails;
  if (req["wait"] === true) await t.settle();
  return { ...t.status(), rows: app.tree.thumbnailRows() };
}

export const viewToolCommands: CommandTable = {
  "thumbs.state": thumbsState,
  "recent.state": recentState,
  "pointers.state": pointersState,
  "pointers.search": pointersSearch,
  "pointers.select": pointersSelect,
  "town.state": townState,
  "town.pick": townPick,
  "seams.state": seamsState,
  "catalog.get": catalogGet,
};
