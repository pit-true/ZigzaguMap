import type { App } from "../App";
import { PAINT_TOOLS, currentTool, setPaintTool, setSmartPath, toPaintTool } from "../paintTool";
import { int, optStr, settle, waitAtMost, type AutomationRequest, type CommandTable } from "./registry";
import { listDialogs } from "./dialogs";
import { describeSelection } from "./status";

/**
 * 描く道具（Phase5 列 1）。
 * - `tool.state`: 今の道具 `tool`（`pencil` / `fill` / `shift`）、スマートパス `smartPath`（設定）と、今の選択で使えるか `smartPathReady`、
 *   帯のボタンの状態 `buttons`（`tools.map.<道具>` の押されているもの）。
 * - `tool.set {tool?, smartPath?}`: 道具とスマートパスを変える（帯のボタン・N・B・S と同じ。個人設定に覚える）。
 * - `tool.fill {cell: [x, y], magic?, tab?}`: 今のタブ（`tab` で `map` / `movement` を選べる）で塗りつぶし（`magic: true` でマジック塗り）を
 *   1 回行う。座標は画面のマス（主マップの左上が原点。隣の帯の上も指せる）。道具の設定は変えない。返事の `count` は塗ったマスの数。
 * - `tool.shift {dx, dy}`: 表示中のマップをずらす（マップシフトのドラッグを離したときと同じ 1 回のコマンド）。
 * - `tool.resize {left, right, up, down, fill?}`: 4 辺を広げる・縮める（対話式リサイズの窓の OK と同じ。`fill` は `edge`（既定）/ `border` /
 *   `selection`）。返事の `done` は実行できたか（できなければエラーのダイアログが出たまま返る）、`width`・`height` は変えたあとの大きさ。
 * - `tool.resizeDialog`: 対話式リサイズの窓を開いてすぐ返す（部品は `resize.width` など。`setField` で入れ、`dialog` の `press: "ok"` で実行）。
 * マウスで道具を使うときは、`tool.set` で道具を選んでから `mouse`（`shift: true` で直線）を使う。
 */

function state(app: App): unknown {
  const t = app.tools;
  return {
    tool: currentTool(app.state),
    smartPath: app.state.settings.data.smartPath,
    smartPathReady: app.tools.mapTab.painter.smartPath.current() !== null,
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

export const toolCommands: CommandTable = {
  "tool.state": state,
  "tool.set": set,
  "tool.fill": fill,
  "tool.shift": shift,
  "tool.resize": resize,
  "tool.resizeDialog": resizeDialog,
};
