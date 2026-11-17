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
  "pathDraw.open": async (app, req) => {
    const panel = await app.playback.pathDraw();
    const start = point(req["start"]);
    panel.open({ ...(typeof req["actor"] === "number" ? { actor: int(req, "actor") } : {}), ...(start ? { start } : {}) });
    return panel.state();
  },
  "pathDraw.state": async app => (await app.playback.existingPathDraw())?.state() ?? { open: false },
  "pathDraw.close": async app => { (await app.playback.existingPathDraw())?.close(); return { open: false }; },
  // 1 歩・向きだけ（face: true）・ドラッグと同じくマスまで（to: {x, y}）
  "pathDraw.step": async (app, req) => {
    const panel = await app.playback.pathDraw();
    if (!panel.isOpen) throw new Error("道をなぞる窓が開いていません。");
    if (req["to"]) { const to = req["to"] as Record<string, unknown>; panel.stepTo(Number(to["x"]), Number(to["y"])); }
    else panel.step(direction(req["direction"]), req["face"] === true);
    return panel.state();
  },
  "pathDraw.edit": async (app, req) => {
    const panel = await app.playback.pathDraw();
    if (!panel.isOpen) throw new Error("道をなぞる窓が開いていません。");
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
