import type { App } from "../App";
import { PAINT_TOOLS, brushSetting, currentTool, setBrush, setPaintTool, setSmartPath, toPaintTool } from "../paintTool";
import { int, optStr, settle, waitAtMost, type AutomationRequest, type CommandTable } from "./registry";
import { listDialogs } from "./dialogs";
import { describeSelection } from "./status";

/**
 * 描く道具（Phase5 列 1）。
 * - `tool.state`: 今の道具 `tool`（`pencil` / `fill` / `shift` / `select`）、スマートパス `smartPath`（設定）と、今の選択で使えるか `smartPathReady`、
 *   帯のボタンの状態 `buttons`（`tools.map.<道具>` の押されているもの）。
 *   ブラシ `brushSize`（1〜9）・`brushShape`（`square` / `circle`）と、今のタブで使うか `brushActive`（`map` / `movement`。Phase7 #515）。
 * - `tool.set {tool?, smartPath?, brushSize?, brushShape?}`: 道具・スマートパス・ブラシを変える（帯のボタン・欄・N・B・S・`[` `]` と同じ。
 *   個人設定に覚える。大きさは 1〜9 に収める）。
 * - `tool.fill {cell: [x, y], magic?, tab?}`: 今のタブ（`tab` で `map` / `movement` を選べる）で塗りつぶし（`magic: true` でマジック塗り）を
 *   1 回行う。座標は画面のマス（主マップの左上が原点。隣の帯の上も指せる）。道具の設定は変えない。返事の `count` は塗ったマスの数。
 * - `tool.shift {dx, dy}`: 表示中のマップをずらす（マップシフトのドラッグを離したときと同じ 1 回のコマンド）。
 * - `tool.resize {left, right, up, down, fill?}`: 4 辺を広げる・縮める（対話式リサイズの窓の OK と同じ。`fill` は `edge`（既定）/ `border` /
 *   `selection`）。返事の `done` は実行できたか（できなければエラーのダイアログが出たまま返る）、`width`・`height` は変えたあとの大きさ。
 * - `tool.resizeDialog`: 対話式リサイズの窓を開いてすぐ返す（部品は `resize.width` など。`setField` で入れ、`dialog` の `press: "ok"` で実行）。
 * - `select.state {tab?}`: 範囲の選択（Phase7 #516）。今の選択 `rect`（`[x, y, 幅, 高さ]`。無ければ null）。
 * - `select.move {rect: [x, y, 幅, 高さ], dx, dy, tab?}`: 矩形を選んで `dx`・`dy` だけ動かす（ドラッグで動かして離したのと同じ 1 回の操作。
 *   端で止める）。返事の `moved` は動かした量（`[dx, dy]`。動かなければ null）と、動かした後の選択 `rect`。道具の設定は変えない。
 * - `view.aids`: 表示の補助（#391）。`cursorFrame`・`playerView`（個人設定）、グリッドの形 `gridStyle`（確かめて直した値）と表示 `grid`、
 *   タブごとの枠 `layers`（`map` / `movement` / `event` の `cell`（マウスのマス）・`cursor`・`sight`（マスの矩形。出していなければ null））、
 *   移動許可の数値の欄の文字 `movementValue`。
 * マウスで道具を使うときは、`tool.set` で道具を選んでから `mouse`（`shift: true` で直線）を使う。
 */

function state(app: App): unknown {
  const t = app.tools;
  return {
    tool: currentTool(app.state),
    smartPath: app.state.settings.data.smartPath,
    smartPathReady: app.tools.mapTab.painter.smartPath.current() !== null,
    brushSize: brushSetting(app.state).size,
    brushShape: brushSetting(app.state).shape,
    brushActive: { map: app.tools.mapTab.painter.currentBrush() !== null, movement: app.tools.movementTab.painter.currentBrush() !== null },
    buttons: PAINT_TOOLS.map((p) => p.id).filter((id) => document.querySelector(`[data-auto-id="tools.map.${id}"]`)?.classList.contains("active")),
    strips: { map: t.mapStrip.element.isConnected, movement: t.movementStrip.element.isConnected },
  };
}

async function set(app: App, req: AutomationRequest): Promise<unknown> {
  const tool = optStr(req, "tool");
  if (tool !== null) {
    if (toPaintTool(tool) !== tool) throw new Error(`tool は ${PAINT_TOOLS.map((p) => p.id).join(" / ")} のどれかです: ${tool}`);
    setPaintTool(app.state, toPaintTool(tool));
  }
  if (typeof req["smartPath"] === "boolean") setSmartPath(app.state, req["smartPath"]);
  const size = req["brushSize"];
  const shape = optStr(req, "brushShape");
  if (shape !== null && shape !== "square" && shape !== "circle") throw new Error(`brushShape は square / circle です: ${shape}`);
  if (size !== undefined && typeof size !== "number") throw new Error("brushSize は 1〜9 の数です");
  setBrush(app.state, { ...(typeof size === "number" ? { size } : {}), ...(shape ? { shape } : {}) });
  await settle();
  return state(app);
}

function cellOf(req: AutomationRequest): { x: number; y: number } {
  const c = req["cell"];
  if (!Array.isArray(c) || c.length !== 2 || typeof c[0] !== "number" || typeof c[1] !== "number") throw new Error("cell は [x, y] で指定してください");
  return { x: c[0], y: c[1] };
}

async function fill(app: App, req: AutomationRequest): Promise<unknown> {
  const tab = optStr(req, "tab") ?? (app.state.tab === "movement" ? "movement" : "map");
  const cell = cellOf(req);
  const magic = req["magic"] === true;
  let count: number;
  if (tab === "movement") {
    count = app.tools.movementTab.painter.fillAt(cell, magic);
    await app.tools.movementTab.painter.cells.settle();
  } else if (tab === "map") {
    count = app.tools.mapTab.painter.fill.fill(cell, magic);
    await app.tools.mapTab.painter.cells.settle();
  } else throw new Error(`tab は map / movement です: ${tab}`);
  await settle();
  return { count, ...describeSelection(app) };
}

function selectTool(app: App, req: AutomationRequest) {
  const tab = optStr(req, "tab") ?? (app.state.tab === "movement" ? "movement" : "map");
  if (tab === "movement") return { tool: app.tools.movementTab.painter.select, cells: app.tools.movementTab.painter.cells };
  if (tab === "map") return { tool: app.tools.mapTab.painter.select, cells: app.tools.mapTab.painter.cells };
  throw new Error(`tab は map / movement です: ${tab}`);
}

function rectArray(r: { x: number; y: number; width: number; height: number } | null): number[] | null {
  return r ? [r.x, r.y, r.width, r.height] : null;
}

function selectState(app: App, req: AutomationRequest): unknown {
  return { rect: rectArray(selectTool(app, req).tool.rect) };
}

async function selectMove(app: App, req: AutomationRequest): Promise<unknown> {
  const { tool, cells } = selectTool(app, req);
  const r = req["rect"];
  if (!Array.isArray(r) || r.length !== 4 || !r.every((v) => Number.isInteger(v))) throw new Error("rect は [x, y, 幅, 高さ] で指定してください");
  const [x, y, width, height] = r as number[];
  if (!tool.select({ x: x!, y: y!, width: width!, height: height! })) throw new Error("rect がマップの中にありません");
  const moved = tool.rect ? tool.moveRegion(tool.rect, int(req, "dx"), int(req, "dy")) : null;
  await cells.settle();
  await settle();
  return { moved: moved ? [moved.dx, moved.dy] : null, rect: rectArray(tool.rect), ...describeSelection(app) };
}

async function shift(app: App, req: AutomationRequest): Promise<unknown> {
  app.tools.mapTab.painter.shift.run(int(req, "dx"), int(req, "dy"));
  await settle();
  return describeSelection(app);
}

async function resize(app: App, req: AutomationRequest): Promise<unknown> {
  const fill = optStr(req, "fill") ?? "edge";
  if (fill !== "edge" && fill !== "border" && fill !== "selection") throw new Error(`fill は edge / border / selection です: ${fill}`);
  const box = { left: int(req, "left"), right: int(req, "right"), up: int(req, "up"), down: int(req, "down") };
  // 失敗したときはエラーのダイアログを出したまま返す（ダイアログの答えを待たない）
  const done = await waitAtMost(app.tools.applyResize({ box, fill }), 3000);
  await settle();
  const map = app.state.map;
  return { done: done === true, width: map?.doc.width ?? 0, height: map?.doc.height ?? 0, dialogs: listDialogs() };
}

async function resizeDialog(app: App): Promise<unknown> {
  await app.tools.openResize();
  await settle();
  return { dialogs: listDialogs() };
}

function aids(app: App): unknown {
  const a = app.aids;
  const s = app.state.settings.data;
  return {
    cursorFrame: s.cursorFrame,
    playerView: s.playerView,
    grid: s.grid,
    gridStyle: a.gridStyle,
    layers: { map: a.layers.map.state, movement: a.layers.movement.state, event: a.layers.event.state },
    movementValue: document.querySelector<HTMLInputElement>('[data-auto-id="movement.value"]')?.value ?? null,
  };
}

export const toolCommands: CommandTable = {
  "tool.state": state,
  "tool.set": set,
  "tool.fill": fill,
  "tool.shift": shift,
  "tool.resize": resize,
  "tool.resizeDialog": resizeDialog,
  "select.state": selectState,
  "select.move": selectMove,
  "view.aids": aids,
};
