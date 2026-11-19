import type { App } from "../App";
import { int, num, type AutomationRequest, type CommandTable } from "./registry";
import { LAYER_ITEMS } from "../LayerToggles";
import { TOOLBAR_LAYOUT } from "../../ui/Toolbar";

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

/**
 * `minimap.state {rebuild?}`: ミニマップ（Phase7 #511、#542 から別ウィンドウ）のメイン側の状態。ウィンドウを開いているか `open`、
 * ウィンドウの準備ができたか `ready`、縮小図の大きさ `width`・`height`、縮小の割合 `scale`（縮小図の画素 = マップの画素 × scale）、
 * 見えている範囲の枠 `frame`（縮小図の画素）、作った回数 `builds`、作る時間 `buildMs`、最後に送った縮小図の大きさ `sentBytes`、
 * タウンマップの拡大 `town`、個人設定 `setting`、今のタブのスクロールの位置 `scroll`。`rebuild: true` なら作り直す予約を待たずに
 * 作り直して送ってから返す。ウィンドウの中の絵は `window: "minimap"` の `state`・`canvasPng` で見る。
 */
async function minimapState(app: App, req: AutomationRequest): Promise<unknown> {
  const host = await app.views.minimap();
  if (req["rebuild"] === true) host.rebuild();
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  const tab = app.state.tab;
  const el = tab === "map" || tab === "movement" || tab === "event" ? app.tabs[tab].view.element : null;
  return {
    ...host.snapshot(),
    setting: app.state.settings.data.minimap,
    placement: app.state.settings.data.toolWindows["minimap"] ?? null,
    scroll: el ? { left: el.scrollLeft, top: el.scrollTop } : null,
  };
}

/** `minimap.click {x, y}`: 縮小図の (x, y) 画素を押したのと同じ（その位置を真ん中にスクロールする）。返事は `minimap.state` と同じ。 */
async function minimapClick(app: App, req: AutomationRequest): Promise<unknown> {
  const host = await app.views.minimap();
  if (!host.isOpen) throw new Error("ミニマップが開いていません");
  if (!host.press(num(req, "x"), num(req, "y"))) throw new Error("ミニマップに縮小図が出ていません");
  return minimapState(app, {});
}

/**
 * `minimap.town {on}`: ウィンドウの「タウンマップも出す」の印を変えたのと同じ（個人設定に残し、ウィンドウの印も合わせる）。
 * タウンマップを読み込んで送るまで待つ。返事は `minimap.state` と同じ（`town` に枠 `frame`・出す範囲 `area`・下の欄の文字 `text`）。
 */
async function minimapTown(app: App, req: AutomationRequest): Promise<unknown> {
  const host = await app.views.minimap();
  if (!host.isOpen) throw new Error("ミニマップが開いていません");
  await host.setTown(req["on"] === true);
  return minimapState(app, {});
}

/**
 * `connection.state`: コネクションマネージャー（#561 から別ウィンドウ `connection`）のメイン側の状態。ウィンドウを開いているか `open`、
 * 準備ができたか `ready`、接続先の絵を作った回数 `previews`（開いてから）、最後に作った絵 `preview`（範囲 `region`・接続先の帯の置き場所 `bandAt`・
 * 1 マスの画素 `cell`・下の欄の文字 `text`・大きさ `width`・`height`・送った大きさ `sentBytes`）、ウィンドウの位置 `placement`。
 * ウィンドウの中は `window: "connection"` の `state`・`getField`・`setField`・`click`・`canvasPng`（`conn.preview`）で見る・操作する。
 */
async function connectionState(app: App): Promise<unknown> {
  const host = await app.connectionHost();
  return { ...host.snapshot(), placement: app.state.settings.data.toolWindows["connection"] ?? null };
}

/**
 * `view.layers {bottom?, top?, third?}`: レイヤーごとの表示（Phase7 #513）。渡した項目を true / false にして描き直す
 * （表示 > レイヤーの表示 のチェックと同じ）。返事は今の `bottom`・`top`・`third` と、ステータスバーの文 `status`（全部出していれば null）。
 */
function viewLayers(app: App, req: AutomationRequest): unknown {
  const toggles = app.views.layers;
  let mask = toggles.mask;
  for (const [name, bit] of LAYER_ITEMS) {
    const v = req[name];
    if (v === true) mask |= bit;
    else if (v === false) mask &= ~bit;
  }
  toggles.set(mask);
  const out: Record<string, unknown> = {};
  for (const [name, bit] of LAYER_ITEMS) out[name] = (toggles.mask & bit) !== 0;
  out["status"] = toggles.element.hidden ? null : toggles.element.textContent;
  return out;
}

/** 最後に `projectWatch.check` で始めた調べ（自動操作用）。 */
let watchRun: Promise<unknown> | null = null;
let watchResult: unknown = null;

/**
 * `projectWatch.check`: ファイルの変化を調べる（Phase5 #404。メインのウィンドウに戻ったときと同じ）。聞くダイアログが出たら、
 * 待たずに返す（`dialog` で答え、`projectWatch.state` で結果を読む）。返事は `projectWatch.state` と同じ。
 */
async function projectWatchCheck(app: App): Promise<unknown> {
  watchResult = null;
  const run = app.watcher.check().then((r) => (watchResult = r));
  watchRun = run;
  const { openDialogs } = await import("../../ui/Dialog");
  for (let i = 0; i < 400 && watchResult === null && openDialogs.length === 0; i++) await new Promise((r) => setTimeout(r, 25));
  return projectWatchState(app);
}

/** `projectWatch.state {wait?}`: 控えているファイルの数 `watched`、最後の調べの結果 `result`（`changes`・`reloaded`。途中なら null）。`wait: true` なら終わるまで待つ。 */
async function projectWatchState(app: App, req: AutomationRequest = {}): Promise<unknown> {
  await app.watcher.settle();
  if (req["wait"] === true && watchRun) await watchRun;
  return { watched: app.watcher.watchedCount, result: watchResult };
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
async function mapExportState(app: App): Promise<unknown> {
  const { openMapExport } = await import("../../ui/export/MapExportDialog");
  const d = openMapExport();
  if (!d) return { open: false };
  await d.settle();
  return { open: true, choice: d.choice, last: d.last, folder: app.views.folderNotice().path };
}

/**
 * `mapExport.run {action}`: 窓のボタンを押して終わるまで待つ（`save` / `copy` / `timelapse` / `gif-anim`）。保存先は先に `queuePath` で渡す。
 * 返事は `save` が保存したパス、`copy` が大きさ、`timelapse` がパス・コマの数・大きさ、`gif-anim`（タイルアニメの GIF。#514）が
 * パス・コマの数 `frames`・大きさ・長さ `durationCs`・周期がそろったか `complete`・ファイルのバイト数 `bytes`・1 コマの画像のバイト数
 * `frameBytes`・書く間のヒープの増え方 `heapGrowthMb`（取りやめた・動くタイルが無ければ null）。
 */
async function mapExportRun(_app: App, req: AutomationRequest): Promise<unknown> {
  const { openMapExport } = await import("../../ui/export/MapExportDialog");
  const d = openMapExport();
  if (!d) throw new Error("マップの画像の書き出しのウィンドウが開いていません");
  await d.settle();
  const action = req["action"];
  if (action === "save") return d.save();
  if (action === "copy") return d.copy();
  if (action === "timelapse") return d.saveTimelapse();
  if (action === "gif-anim") return d.saveAnimation();
  throw new Error(`action が不正です: ${String(action)}`);
}

/**
 * `allSettings.state`: すべての設定の窓（Phase5 #404。`action` の `opt.allSettings` で開く）。開いているか `open`、チェックの欄の
 * 状態 `checks`（アクション ID → チェック）、プロジェクトの欄の値 `project`、最後の保存の結果 `message`。欄は `allSettings.<アクション ID>`
 * （`setField` に true / false、窓を開く項目は `click`）、プロジェクトの欄は `allSettings.project.<項目>`、保存は `allSettings.project.save`。
 */
async function allSettingsState(): Promise<unknown> {
  const { openAllSettings } = await import("../../ui/settings/AllSettingsDialog");
  const d = openAllSettings();
  if (!d) return { open: false };
  await d.ready;
  const checks: Record<string, boolean> = {};
  for (const el of document.querySelectorAll<HTMLInputElement>(".all-settings-dialog input[type=checkbox][data-action]")) checks[el.dataset["action"]!] = el.checked;
  const project: Record<string, string | boolean> = {};
  for (const el of document.querySelectorAll<HTMLInputElement>(".all-settings-project input")) {
    project[el.dataset["autoId"]!.replace("allSettings.project.", "")] = el.type === "checkbox" ? el.checked : el.value;
  }
  return { open: true, checks, project, message: d.message };
}

/** `allSettings.save`: プロジェクトの欄を保存して終わるまで待つ。返事は保存できたか `ok` と `allSettings.state`。 */
async function allSettingsSave(): Promise<unknown> {
  const { openAllSettings } = await import("../../ui/settings/AllSettingsDialog");
  const d = openAllSettings();
  if (!d) throw new Error("すべての設定のウィンドウが開いていません");
  await d.ready;
  const ok = await d.saveProject();
  return { ok, ...((await allSettingsState()) as object) };
}

/**
 * `toolbar.icons {wait?}`: ツールバーのアイコン（#541）。ワールドマップエディタの絵がどれか `worldMap`（`rom` = ROM のタウンマップから
 * 切り出した絵、`fallback` = 自作の絵）と、ボタンごとの絵（HTML）の要約 `keys`（アイコンの名前ごと。絵が違えば違う値になる短い文字列）、
 * ボタンごとのヒントの文 `hints` と押したときのアクション ID `actions`（#556）。`wait: true` なら差し替えを待つ。
 */
async function toolbarIcons(app: App, req: AutomationRequest): Promise<unknown> {
  if (req["wait"] === true) await app.worldMapIcon.settle();
  const keys: Record<string, string> = {};
  const hints: Record<string, string> = {};
  for (const el of document.querySelectorAll<HTMLElement>(".toolbar-button[data-icon]")) {
    hints[el.dataset["icon"]!] = el.title;
    let h = 5381;
    for (const ch of el.innerHTML) h = (Math.imul(h, 33) + ch.charCodeAt(0)) >>> 0;
    keys[el.dataset["icon"]!] = `${el.innerHTML.length.toString(16)}-${h.toString(16)}`;
  }
  return { worldMap: app.worldMapIcon.source, keys, hints, actions: Object.fromEntries(TOOLBAR_LAYOUT.flatMap((e) => (e && e !== "sort" ? [[e.icon, e.id]] : []))) };
}

export const viewToolCommands: CommandTable = {
  "toolbar.icons": toolbarIcons,
  "allSettings.state": allSettingsState,
  "allSettings.save": allSettingsSave,
  "projectWatch.check": projectWatchCheck,
  "projectWatch.state": projectWatchState,
  "userScripts.state": userScriptsState,
  "userScripts.run": userScriptsRun,
  "userScripts.reload": userScriptsReload,
  "userScripts.stop": (app: App) => {
    app.views.userScripts.stop();
    return userScriptsState(app);
  },
  "mapExport.state": mapExportState,
  "mapExport.run": mapExportRun,
  "view.layers": viewLayers,
  "connection.state": connectionState,
  "minimap.state": minimapState,
  "minimap.click": minimapClick,
  "minimap.town": minimapTown,
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
