import type { MovementDirection, PathPoint } from "@zigzagumap/core";
import { int, str, type CommandTable } from "./registry";

const DIRECTIONS = ["down", "up", "left", "right"] as const;
function direction(value: unknown): MovementDirection {
  if (typeof value !== "string" || !(DIRECTIONS as readonly string[]).includes(value)) throw new Error("direction は down / up / left / right のいずれかです。");
  return value as MovementDirection;
}
function point(value: unknown): PathPoint | undefined {
  if (value === undefined || value === null) return undefined;
  const v = value as Record<string, unknown>;
  if (typeof v["x"] !== "number" || typeof v["y"] !== "number") throw new Error("start は {x, y, facing} です。");
  return { x: v["x"], y: v["y"], facing: v["facing"] === undefined ? "down" : direction(v["facing"]) };
}

/** 道をなぞる窓（#517）。 */
export const pathDrawCommands: CommandTable = {
  // from: 省略でそのまま開く / playback（再生の帯の「道をなぞる…」）/ person（人の番号 index の右クリック）/
  // line（スクリプトエディタの applymovement の行。path と 0 始まりの line）
  "pathDraw.open": async (app, req) => {
    const panel = await app.playback.pathDraw();
    const from = req["from"];
    if (from === "playback") {
      const controller = await app.playback.existing();
      if (!controller?.active) throw new Error("再生していません。");
      await controller.openPathDraw();
    } else if (from === "person") await app.playback.drawPathFrom(int(req, "index"));
    else if (from === "line") await app.playback.drawPathFromLine(str(req, "path"), int(req, "line"));
    else {
      const start = point(req["start"]);
      panel.open({ ...(typeof req["actor"] === "number" ? { actor: int(req, "actor") } : {}), ...(start ? { start } : {}) });
    }
    await panel.ready();
    return panel.state();
  },
  // 「ここで使う」（mode: replace / new、label、shared: rewrite / copy。省略で窓の選択）。返事は result と state
  "pathDraw.apply": async (app, req) => {
    const panel = await app.playback.pathDraw();
    if (!panel.isOpen) throw new Error("道をなぞるウィンドウが開いていません。");
    const mode = req["mode"], shared = req["shared"];
    if (mode !== undefined && mode !== "replace" && mode !== "new") throw new Error("mode は replace / new のいずれかです。");
    if (shared !== undefined && shared !== "rewrite" && shared !== "copy") throw new Error("shared は rewrite / copy のいずれかです。");
    const result = await panel.apply({ ...(mode ? { mode } : {}), ...(typeof req["label"] === "string" ? { label: req["label"] } : {}), ...(shared ? { shared } : {}) });
    const controller = await app.playback.existing();
    if (controller?.active) await controller.settled();
    return { result, state: panel.state() };
  },
  "pathDraw.state": async app => (await app.playback.existingPathDraw())?.state() ?? { open: false },
  // 窓を動かす（left・top はメインの画面の中の画素）。返事は pathDraw.state と同じ（position が動かした先）
  "pathDraw.move": async (app, req) => {
    const panel = await app.playback.existingPathDraw();
    if (!panel?.isOpen) throw new Error("道をなぞるウィンドウが開いていません。");
    panel.moveTo(int(req, "left"), int(req, "top"));
    return panel.state();
  },
  "pathDraw.close": async app => { (await app.playback.existingPathDraw())?.close(); return { open: false }; },
  // 1 歩・向きだけ（face: true）・ドラッグと同じくマスまで（to: {x, y}）
  "pathDraw.step": async (app, req) => {
    const panel = await app.playback.pathDraw();
    if (!panel.isOpen) throw new Error("道をなぞるウィンドウが開いていません。");
    if (req["to"]) { const to = req["to"] as Record<string, unknown>; panel.stepTo(Number(to["x"]), Number(to["y"])); }
    else panel.step(direction(req["direction"]), req["face"] === true);
    return panel.state();
  },
  "pathDraw.edit": async (app, req) => {
    const panel = await app.playback.pathDraw();
    if (!panel.isOpen) throw new Error("道をなぞるウィンドウが開いていません。");
    const action = str(req, "action");
    if (action === "undo") panel.undo();
    else if (action === "redo") panel.redo();
    else if (action === "clear") panel.clear();
    else if (action === "wait") panel.addWait(int(req, "frames"));
    else if (action === "speed") panel.setSpeed(int(req, "value"));
    else throw new Error("action は undo / redo / clear / wait / speed のいずれかです。");
    return panel.state();
  },
};
