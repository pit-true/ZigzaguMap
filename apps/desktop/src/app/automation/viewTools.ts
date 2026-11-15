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
 * `town.state {wait?}`: タウンマップの小窓（#306・#386）。出しているか `open`、読み込み済みか `loaded`、面 `page`、今のマップの地名 `region`、
 * 枠 `frame`（今の面のタウンマップのマス。無ければ null）、枠をどこから出したか `source`（`map` = マップ単位の紐づけ、`section` = 地名の紐づけ、
 * `rom` = ROM のデータ、無ければ null）と面も含めた位置 `at`（`page`・`x`・`y`・`width`・`height`。無ければ null）、紐づけの一覧 `links`
 * （`sections`: `region` と範囲、`maps`: `bank`・`map` と範囲）、保存先 `store`（`project` = zigzagumap.json、`personal` = 個人設定）、
 * 読めなかったときの理由 `storeError`、右ドラッグで選んでいる範囲 `selection`、マウスの下の地名 `hovered`、下の欄の文 `label`。
 * `wait: true` なら読み込みを待つ。小窓を作っていなければ作らずに `open: false` を返す。
 */
async function townState(app: App, req: AutomationRequest): Promise<unknown> {
  const town = app.views.townIfCreated();
  if (!town) return { open: false, loaded: false };
  if (req["wait"] === true) await town.settle();
  const f = town.currentFrame();
  const links = town.links;
  return {
    open: town.isOpen,
    loaded: town.loaded,
    page: town.currentPage,
    region: town.currentRegion,
    frame: town.frameRect(),
    source: f?.source ?? null,
    at: f ? { ...f.rect } : null,
    links: {
      sections: [...links.sections].map(([region, r]) => ({ region, ...r })),
      maps: [...links.maps].map(([key, r]) => {
        const [bank, map] = key.split(".").map(Number);
        return { bank, map, ...r };
      }),
    },
    store: town.linkPlace,
    storeError: town.store.error,
    selection: town.selection,
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

/** 紐づけの単位（`section` / `map`）。 */
function townScope(req: AutomationRequest): "section" | "map" {
  const scope = req["scope"] ?? "section";
  if (scope !== "section" && scope !== "map") throw new Error(`scope は section / map のどちらかです: ${String(scope)}`);
  return scope;
}

/**
 * `town.link {scope?, x, y, width?, height?, page?}`: 小窓の右クリックのメニューの「ここに紐づける」と同じ（#386）。`scope` は `section`（既定。
 * 今の地名）か `map`（今のマップだけ）、範囲はタウンマップのマス（`width`・`height` は既定 1、`page` は省くと今の面）。すぐ保存する。
 * 小窓を出していなければ出す。返事は `town.state` と同じ形。
 */
async function townLink(app: App, req: AutomationRequest): Promise<unknown> {
  const town = await app.views.town();
  if (!town.isOpen) await app.views.setTownMap(true);
  await town.settle();
  const opt = (key: string, fallback: number | undefined): number | undefined => (req[key] === undefined ? fallback : int(req, key));
  await town.link(townScope(req), { x: int(req, "x"), y: int(req, "y"), width: opt("width", 1)!, height: opt("height", 1)!, page: opt("page", undefined) });
  return townState(app, {});
}

/** `town.unlink {scope?}`: 今の地名（`section`。既定）か今のマップ（`map`）の紐づけを外す。返事は外したか `removed` と `town.state`。 */
async function townUnlink(app: App, req: AutomationRequest): Promise<unknown> {
  const town = await app.views.town();
  await town.settle();
  const removed = await town.unlink(townScope(req));
  return { removed, ...((await townState(app, {})) as object) };
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

/** マップのタブの名前（`map` / `movement` / `event`）。 */
function zoomTab(req: AutomationRequest): "map" | "movement" | "event" {
  const tab = typeof req["tab"] === "string" ? req["tab"] : "map";
  if (tab !== "map" && tab !== "movement" && tab !== "event") throw new Error(`tab は map / movement / event のどれかです: ${tab}`);
  return tab;
}

/**
 * `zoom.state {tab?}`: マップの拡大（#316）。倍率 `zoom`、描く大きさ `cellSize`、画面の上の大きさ `screenCellSize`、CSS で広げる割合
 * `scale`、重ね描きの Canvas の画素数 `layer`（`width`・`height`）、スクロールの大きさ `scrollSize` と位置 `scroll`、個人設定 `mapZoom`。
 */
function zoomState(app: App, req: AutomationRequest): unknown {
  const tab = zoomTab(req);
  const view = app.tabs[tab].view;
  const el = view.element;
  return {
    tab,
    zoom: view.zoom,
    cellSize: view.cellSize,
    screenCellSize: view.screenCellSize,
    scale: view.screenScale,
    layer: { width: view.layer.width, height: view.layer.height },
    scrollSize: { width: el.scrollWidth, height: el.scrollHeight },
    scroll: { left: el.scrollLeft, top: el.scrollTop },
    mapZoom: app.state.settings.data.mapZoom,
  };
}

/**
 * `zoom.wheel {tab?, cell, delta}`: マスの上で Ctrl＋ホイールを回したのと同じ（`delta` が負なら拡大、正なら縮小。既定 -1）。
 * `cell` は主マップの左上が原点のマス。返事は `zoom.state` と、回したあとの同じマスの画面の上の位置 `at`（マウスの位置との差 `drift`）。
 */
function zoomWheel(app: App, req: AutomationRequest): unknown {
  const tab = zoomTab(req);
  const view = app.tabs[tab].view;
  const c = req["cell"];
  if (!Array.isArray(c) || c.length !== 2) throw new Error("cell は [x, y] で指定してください");
  const where = (): { x: number; y: number } => {
    const r = view.stage.getBoundingClientRect();
    const o = view.originPx;
    const k = view.screenScale;
    return { x: r.left + (o.x + (Number(c[0]) + 0.5) * view.cellSize) * k, y: r.top + (o.y + (Number(c[1]) + 0.5) * view.cellSize) * k };
  };
  const before = where();
  const delta = typeof req["delta"] === "number" ? req["delta"] : -1;
  view.element.dispatchEvent(new WheelEvent("wheel", { deltaY: delta * 100, ctrlKey: true, clientX: before.x, clientY: before.y, bubbles: true, cancelable: true }));
  const after = where();
  return { ...(zoomState(app, req) as object), at: after, drift: Math.round(Math.hypot(after.x - before.x, after.y - before.y)) };
}

/**
 * `editHistory.state`: 履歴の窓（Phase5 #402）。出しているか `open`、今の位置 `position`（実行済みの数）、行 `rows`
 * （新しい順。`position`（押したときに移る位置）・`text`・`current`・`redo`。最後が「（最初の状態）」）。
 */
async function editHistoryState(app: App): Promise<unknown> {
  const panel = await app.views.history();
  return { open: panel.isOpen, position: app.state.session?.bus.position ?? 0, rows: panel.rows() };
}

/** `editHistory.goTo {position}`: 履歴の窓の行を押す（その位置まで戻す・進める。窓が開いていれば画面の行を押す）。返事は `editHistory.state` と同じ形と `steps`。 */
async function editHistoryGoTo(app: App, req: AutomationRequest): Promise<unknown> {
  const panel = await app.views.history();
  const position = int(req, "position");
  const row = document.querySelector<HTMLElement>(`[data-auto-id="editHistory.list"] .history-row[data-position="${position}"]`);
  const before = app.state.session?.bus.position ?? 0;
  if (row) row.click();
  else panel.goTo(position);
  const after = app.state.session?.bus.position ?? 0;
  return { steps: Math.abs(after - before), ...((await editHistoryState(app)) as object) };
}

/** `userScripts.state {wait?}`: 利用者のスクリプト（Phase5 #405）。Worker を作っているか `active`、`files`・`enabled`、登録された操作 `actions`、ログ `logs`、読めなかったもの `loadErrors`。`wait: true` なら読み込みと動いている呼び出しが終わるまで待つ。 */
async function userScriptsState(app: App, req: AutomationRequest = {}): Promise<unknown> {
  const h = app.views.userScripts;
  if (req["wait"] === true) {
    await h.settle();
    await h.idle();
  }
  return { active: h.active, files: h.listing.files, enabled: h.listing.enabled, actions: h.actions, logs: h.logs, loadErrors: Object.fromEntries(h.loadErrors) };
}

/** `userScripts.run {action, wait?}`: 登録された操作を動かす。`wait: false` でなければ終わるまで待つ（ダイアログを出す操作は false にして `dialog` で答える）。返事は `userScripts.state`。 */
async function userScriptsRun(app: App, req: AutomationRequest): Promise<unknown> {
  app.views.userScripts.runAction(String(req["action"]));
  await new Promise((r) => setTimeout(r, 50));
  return userScriptsState(app, { wait: req["wait"] !== false });
}

/** `userScripts.reload` / `userScripts.stop`: 読み直す（終わるまで待つ）・止める。返事は `userScripts.state`。 */
async function userScriptsReload(app: App): Promise<unknown> {
  await app.views.userScripts.reload();
  return userScriptsState(app, { wait: true });
}

/** `mapExport.state`: マップの画像の書き出しの窓（Phase5 #403）。開いているか `open`、選択 `choice`、プレビューの大きさ `last`（プレビューを作り終えるまで待つ）。 */
async function mapExportState(): Promise<unknown> {
  const { openMapExport } = await import("../../ui/export/MapExportDialog");
  const d = openMapExport();
  if (!d) return { open: false };
  await d.settle();
  return { open: true, choice: d.choice, last: d.last };
}

/**
 * `mapExport.run {action}`: 窓のボタンを押して終わるまで待つ（`save` / `copy` / `timelapse`）。保存先は先に `queuePath` で渡す。
 * 返事は `save` が保存したパス、`copy` が大きさ、`timelapse` がパス・コマの数・大きさ（取りやめたら null）。
 */
async function mapExportRun(_app: App, req: AutomationRequest): Promise<unknown> {
  const { openMapExport } = await import("../../ui/export/MapExportDialog");
  const d = openMapExport();
  if (!d) throw new Error("マップの画像の書き出しの窓が開いていません");
  await d.settle();
  const action = req["action"];
  if (action === "save") return d.save();
  if (action === "copy") return d.copy();
  if (action === "timelapse") return d.saveTimelapse();
  throw new Error(`action が不正です: ${String(action)}`);
}

export const viewToolCommands: CommandTable = {
  "userScripts.state": userScriptsState,
  "userScripts.run": userScriptsRun,
  "userScripts.reload": userScriptsReload,
  "userScripts.stop": (app: App) => {
    app.views.userScripts.stop();
    return userScriptsState(app);
  },
  "mapExport.state": mapExportState,
  "mapExport.run": mapExportRun,
  "editHistory.state": editHistoryState,
  "editHistory.goTo": editHistoryGoTo,
  "zoom.state": zoomState,
  "zoom.wheel": zoomWheel,
  "thumbs.state": thumbsState,
  "recent.state": recentState,
  "pointers.state": pointersState,
  "pointers.search": pointersSearch,
  "pointers.select": pointersSelect,
  "town.state": townState,
  "town.pick": townPick,
  "town.link": townLink,
  "town.unlink": townUnlink,
  "seams.state": seamsState,
  "catalog.get": catalogGet,
};
