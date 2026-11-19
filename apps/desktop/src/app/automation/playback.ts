import type { MovementEdit } from "@zigzagumap/core";
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
  "playback.centering": async app => app.previewPlayer.centering(),
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
  "playback.player.place": async (app, req) => {
    const gender = req["gender"], facing = req["facing"];
    app.playback.placePlayer(int(req, "x"), int(req, "y"), {
      ...(gender === "male" || gender === "female" ? { gender } : {}),
      ...(facing === "down" || facing === "up" || facing === "left" || facing === "right" ? { facing } : {}),
    });
    await app.previewPlayer.ready();
    return { player: app.previewPlayer.player };
  },
  "playback.player.move": async (app, req) => {
    const direction = str(req, "direction");
    if (direction !== "down" && direction !== "up" && direction !== "left" && direction !== "right") throw new Error("direction は down / up / left / right のいずれかです。");
    await app.previewPlayer.walk(direction);
    await app.playback.settled();
    const controller = await app.playback.existing();
    await controller?.ready();
    return { player: app.previewPlayer.player, playback: controller?.state() ?? { active: false } };
  },
  // 仮の主人公の歩きを 1 フレームずつ進める（#493。動画とテストで歩きのコマを確かめる用）。
  "playback.player.walkStart": (app, req) => {
    const direction = str(req, "direction");
    if (direction !== "down" && direction !== "up" && direction !== "left" && direction !== "right") throw new Error("direction は down / up / left / right のいずれかです。");
    void app.previewPlayer.walk(direction, true);
    return { player: app.previewPlayer.player, walk: app.previewPlayer.walkState };
  },
  "playback.player.walkStep": async (app, req) => {
    const frames = req["frames"] === undefined ? 1 : int(req, "frames");
    const frame = app.previewPlayer.stepWalk(frames);
    if (frame === null) {
      await app.playback.settled();
      const controller = await app.playback.existing();
      await controller?.ready();
      return { player: app.previewPlayer.player, walk: null, playback: controller?.state() ?? { active: false } };
    }
    return { player: app.previewPlayer.player, walk: app.previewPlayer.walkState };
  },
  "playback.player.talk": async app => {
    app.previewPlayer.talk();
    await app.playback.settled();
    const controller = await app.playback.existing();
    await controller?.ready();
    return { player: app.previewPlayer.player, playback: controller?.state() ?? { active: false }, status: app.state.status };
  },
  "playback.edit": async (app, req) => {
    const controller = await app.playback.get();
    const edit = req["edit"];
    if (!edit || typeof edit !== "object" || typeof (edit as { type?: unknown }).type !== "string") throw new Error("edit は {type, ...} のオブジェクトです（MovementEdit）。");
    const shared = req["shared"];
    if (shared !== undefined && shared !== "rewrite" && shared !== "copy") throw new Error("shared は rewrite / copy のいずれかです。");
    const result = await controller.editor.edit(int(req, "segment"), edit as MovementEdit, shared);
    await controller.settled(); await controller.ready();
    return { result, state: controller.state() };
  },
  "playback.locks": async app => {
    const controller = await app.playback.existing(), timeline = controller?.result;
    return controller && timeline ? controller.editor.locks(timeline) : null;
  },
  "playback.settled": async app => { const controller = await app.playback.existing(); await controller?.settled(); return controller?.state() ?? { active: false }; },
  "playback.layout": async app => (await app.playback.existing())?.timelineUi.layoutInfo() ?? null,
  "playback.wheel": async (app, req) => {
    const controller = await app.playback.get(); controller.timelineUi.wheel(Number(req["delta"] ?? -100), Number(req["x"] ?? 200)); return controller.timelineUi.layoutInfo();
  },
  /** メッセージの窓の今のページ（字の位置・出どころ・補った字。#497）。文が出ていなければ null。 */
  "playback.message": async app => {
    const window = (await app.playback.existing())?.messageWindow;
    if (!window) return null;
    await window.ready();
    await new Promise(resolve => requestAnimationFrame(() => resolve(null)));
    return window.info;
  },
  "playback.timeline": async app => {
    const timeline = (await app.playback.existing())?.result;
    return timeline ? { segments: timeline.segments, markers: timeline.markers, keyFrames: timeline.keyFrames(), lastFrame: timeline.lastFrame } : null;
  },
};
