import type { App } from "../App";
import type { CommandTable } from "./registry";

/** `npc.hold` で掛けた止め（owner ごとの解除の関数）。 */
const holds = new Map<string, () => void>();
/** `clock.probe` の購読。 */
let probe: { dispose(): void } | null = null;

/**
 * 表示 > 人物を動かす（#471）。
 * - `npc.motion {enabled?, seed?}`: 始める・やめる。返事は今の状態（`npc.state` と同じ）。
 * - `npc.advance {frames}`: 時計を使わずに frames だけ進めて描く（止めていても進む。テスト用）。
 * - `npc.hold {owner, on}`: owner の名前で止める・解除する（再生 A-5 の止めと同じ口）。
 * - `npc.state`: `enabled`・`frame`・`seed`・`holders`・`clock`（`running`・`frames`・`subscriptions`）・`actors`・`missing`・`cost`。
 * - `npc.ranges {enabled?}`: 表示 > 人物の移動範囲と視界（#472）。返事は `enabled`・`rules`・`persons`（`localId`・`range`・`spotter`・`rays`）。
 * - `npc.image`: 動く人物の層を 1 枚にした PNG（マップと同じ等倍）。
 * - `follower.state`・`follower.set {enabled?, species?, shiny?, female?}`・`follower.advance {frames}`: 仮の主人公の連れ歩き（#476・#477）。
 * - `clock.probe {on}`: 何もしない購読で時計だけを回す（時計そのものの CPU を測る）。返事は時計の状態。
 */
export const npcCommands: CommandTable = {
  "npc.motion": async (app: App, req) => {
    if (req["enabled"] === true) await app.npcMotion.start({ seed: typeof req["seed"] === "number" ? req["seed"] : 0 });
    if (req["enabled"] === false) app.npcMotion.stop();
    return app.npcMotion.snapshot;
  },
  "npc.advance": (app: App, req) => {
    const frames = req["frames"];
    if (typeof frames !== "number" || !Number.isInteger(frames) || frames < 0) throw new Error("frames は 0 以上の整数です");
    app.npcMotion.advance(frames);
    return app.npcMotion.snapshot;
  },
  "npc.hold": (app: App, req) => {
    const owner = req["owner"];
    if (typeof owner !== "string" || !owner) throw new Error("owner を指定してください");
    if (req["on"] === false) { holds.get(owner)?.(); holds.delete(owner); }
    else if (!holds.has(owner)) holds.set(owner, app.npcMotion.hold(owner));
    return app.npcMotion.snapshot;
  },
  "npc.state": (app: App) => app.npcMotion.snapshot,
  "npc.ranges": async (app: App, req) => {
    if (req["enabled"] === true) await app.npcMotion.startRanges();
    if (req["enabled"] === false) app.npcMotion.stopRanges();
    return app.npcMotion.rangesSnapshot;
  },
  "npc.image": (app: App) => {
    const canvas = app.npcMotion.image();
    if (!canvas) throw new Error("人物を動かしていません");
    const png = canvas.toDataURL("image/png").split(",")[1];
    canvas.width = 0; canvas.height = 0;
    return { png };
  },
  "follower.state": async (app: App) => (await app.follower.ready()).snapshot,
  "follower.set": async (app: App, req) => {
    const f = await app.follower.ready();
    const patch: { enabled?: boolean; species?: number; shiny?: boolean; female?: boolean } = {};
    if (typeof req["enabled"] === "boolean") patch.enabled = req["enabled"];
    if (typeof req["species"] === "number") patch.species = req["species"];
    if (typeof req["shiny"] === "boolean") patch.shiny = req["shiny"];
    if (typeof req["female"] === "boolean") patch.female = req["female"];
    await f.set(patch);
    return f.snapshot;
  },
  "follower.advance": async (app: App, req) => {
    const frames = req["frames"];
    if (typeof frames !== "number" || !Number.isInteger(frames) || frames < 0 || frames > 36000) throw new Error("frames は 0〜36000 の整数です");
    const f = await app.follower.ready();
    f.advance(frames);
    return f.snapshot;
  },
  "clock.probe": (app: App, req) => {
    if (req["on"] === true) probe ??= app.gameClock.subscribe("probe", () => undefined);
    if (req["on"] === false) { probe?.dispose(); probe = null; }
    return app.gameClock.state;
  },
};
