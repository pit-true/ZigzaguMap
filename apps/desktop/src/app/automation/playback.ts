import { int, optStr, str, type CommandTable } from "./registry";

export const playbackCommands: CommandTable = {
  "playback.start": async (app, req) => {
    const label = optStr(req, "label");
    const map = app.state.map;
    if (!map) throw new Error("再生するマップを開いてください。");
    if (label !== null) await app.playback.start({ label });
    else {
      const kind = str(req, "kind");
      if (kind !== "person" && kind !== "sign" && kind !== "trap" && kind !== "map") throw new Error("kind は person / sign / trap / map のいずれかです。");
      await app.playback.start({ target: { map: map.id, kind, index: typeof req["index"] === "number" ? int(req, "index") : 0 } });
    }
    return (await app.playback.existing())?.state();
  },
  "playback.stop": async app => { const controller = await app.playback.existing(); controller?.stop(); await controller?.ready(); return { active: false }; },
  "playback.state": async app => (await app.playback.existing())?.state() ?? { active: false },
  "playback.seek": async (app, req) => { const controller = await app.playback.get(); controller.seek(int(req, "frame")); await controller.ready(); return controller.state(); },
  "playback.step": async (app, req) => {
    const direction = str(req, "direction");
    if (direction !== "previous" && direction !== "next") throw new Error("direction は previous / next のいずれかです。");
    const controller = await app.playback.get(); controller.step(direction === "previous" ? -1 : 1, req["singleFrame"] === true); await controller.ready(); return controller.state();
  },
  "playback.speed": async (app, req) => { const controller = await app.playback.get(); controller.setSpeed(Number(req["value"])); return controller.state(); },
  "playback.play": async app => { const controller = await app.playback.get(); controller.toggle(); return controller.state(); },
  "playback.answer": async (app, req) => {
    if (typeof req["taken"] !== "boolean") throw new Error("taken は真偽値です。");
    const controller = await app.playback.get(); controller.answer(str(req, "key"), req["taken"]); await controller.ready(); return controller.state();
  },
  "playback.choose": async (app, req) => {
    const controller = await app.playback.get(); controller.choose(str(req, "key"), int(req, "value")); await controller.ready(); return controller.state();
  },
  "playback.layout": async app => (await app.playback.existing())?.timelineUi.layoutInfo() ?? null,
  "playback.wheel": async (app, req) => {
    const controller = await app.playback.get(); controller.timelineUi.wheel(Number(req["delta"] ?? -100), Number(req["x"] ?? 200)); return controller.timelineUi.layoutInfo();
  },
  "playback.timeline": async app => {
    const timeline = (await app.playback.existing())?.result;
    return timeline ? { segments: timeline.segments, markers: timeline.markers, keyFrames: timeline.keyFrames(), lastFrame: timeline.lastFrame } : null;
  },
};
