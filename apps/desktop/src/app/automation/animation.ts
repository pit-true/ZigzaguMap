import type { DoorEvent, PlaybackActorState } from "@zigzagumap/core";
import { renderActorScene } from "../ActorScene";
import { sceneNeighborBlocks } from "../SceneNeighbors";
import { canvasOf } from "../../ui/canvas";
import { int, type CommandTable } from "./registry";

/**
 * タイルアニメとドア（Phase6 #473・#474）。どれもマップ・ROM・履歴を変えない。
 * - `tileAnim.info`: 表示中のマップの主・副のアニメの読み取り結果と、読んだ絵・写しのバイト数。
 * - `tileAnim.frame {frame: number | null}`: フレーム番号を渡す（null で止めて元の絵へ戻す）。返事は表示中のコマ。
 * - `tileAnim.scene {frame?, x?, y?, width?, height?, actors?}`: そのフレームの 240×160（既定）の絵を PNG で返す。
 * - `tileAnim.clock {on?, tick?}`: 表示 > タイルアニメを動かす のオン・オフ（`on`）、時計の代わりに進める（`tick` フレーム）。返事は購読と時計の様子。
 * - `door.list`・`door.info {x, y}`・`door.run {kind, x, y, frame?}`・`door.state {frame?}`・`door.wait {frame}`・`door.clear`。
 */
const DOOR_KINDS: readonly DoorEvent["kind"][] = ["open", "close", "setOpen", "setClosed"];

export const animationCommands: CommandTable = {
  "tileAnim.info": (app) => ({ enabled: app.mapAnimations.enabled, frame: app.mapAnimations.frame, ...app.mapAnimations.info() }),
  "tileAnim.frame": (app, req) => {
    const frame = req["frame"];
    if (frame !== null && typeof frame !== "number") throw new Error("frame は数か null です");
    app.mapAnimations.setFrame(frame);
    return { enabled: app.mapAnimations.enabled, frame: app.mapAnimations.frame, shown: app.mapAnimations.shownFrames() };
  },
  "tileAnim.scene": async (app, req) => {
    const session = app.state.session, map = app.state.map;
    if (!session || !map) throw new Error("マップが開かれていません");
    if (typeof req["frame"] === "number") app.mapAnimations.setFrame(req["frame"]);
    const actors = (req["actors"] ?? []) as PlaybackActorState[];
    if (!Array.isArray(actors) || actors.length > 64) throw new Error("actors は64件までの配列です");
    const number = (key: string, fallback: number): number => (typeof req[key] === "number" ? req[key] : fallback);
    const outside = await sceneNeighborBlocks(session, map);
    const result = renderActorScene(session, map, { x: number("x", 0), y: number("y", 0), width: number("width", 240), height: number("height", 160) }, actors, undefined, outside);
    const canvas = canvasOf(result.image);
    const png = canvas.toDataURL("image/png").split(",")[1];
    canvas.width = 0; canvas.height = 0;
    return { png, frame: app.mapAnimations.frame, shown: app.mapAnimations.shownFrames(), unknownBlocks: result.unknownBlocks };
  },
  "tileAnim.clock": (app, req) => {
    if (typeof req["on"] === "boolean") app.mapAnimations.setTileAnimation(req["on"]);
    if (typeof req["tick"] === "number") app.mapAnimations.tick(req["tick"]);
    const c = app.mapAnimations.clockState;
    return { on: app.mapAnimations.tileAnimationOn, frame: app.mapAnimations.frame, subscribed: c.subscribed, holders: c.holders, clockFrame: c.frame, clock: app.gameClock.state };
  },
  "door.info": (app, req) => app.mapAnimations.doorInfo(int(req, "x"), int(req, "y")),
  "door.list": (app) => ({ doors: app.mapAnimations.doorList() }),
  "door.run": (app, req) => {
    const kind = req["kind"] as DoorEvent["kind"];
    if (!DOOR_KINDS.includes(kind)) throw new Error(`kind は ${DOOR_KINDS.join("・")} のどれかです`);
    return app.mapAnimations.door(kind, int(req, "x"), int(req, "y"), typeof req["frame"] === "number" ? req["frame"] : undefined);
  },
  "door.state": (app, req) => {
    const state = app.mapAnimations.doorState(typeof req["frame"] === "number" ? req["frame"] : undefined);
    if (!state) return { cells: [], task: null, results: [] };
    return {
      cells: [...state.cells].map(([at, entries]) => ({ at, entries: [...entries] })),
      tiles: state.tiles ? state.tiles[0] : null,
      task: state.task,
      results: state.results.map((r) => ({ ...r.event, ok: r.ok, reason: r.reason })),
    };
  },
  "door.wait": (app, req) => ({ resume: app.mapAnimations.doorWait(int(req, "frame")) }),
  "door.clear": (app) => { app.mapAnimations.clearDoors(); return { events: 0 }; },
};
