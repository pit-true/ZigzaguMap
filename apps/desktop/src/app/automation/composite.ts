import type { App } from "../App";
import { canvasPng, release, writeClipboard, type CompositeEvents } from "../CompositeImage";
import { jsHeapBytes } from "../../util/jsHeap";
import { type AutomationRequest, type CommandTable } from "./registry";

/**
 * `image.composite {whole?, events?, scale?, clipboard?, png?}`（#246）: 接続している全マップ（`whole: false` なら今のマップ）の画像を作る。
 * `events` は `none`（既定）/ `persons` / `all`。`scale` を省くと、辺が 16,384 画素を超えるときは収まるまで縮める（ダイアログは出さない）。
 * `clipboard: true` のときだけクリップボードへ渡す（テストでユーザーのクリップボードを汚さないため。既定は渡さない）。
 * 返事は画像の大きさ・マップの数と置き場所・縮めた割合・作っている間の JavaScript のヒープ（MB）と、`png: true` なら PNG（Base64）。
 */
async function composite(app: App, req: AutomationRequest): Promise<unknown> {
  const events = (typeof req["events"] === "string" ? req["events"] : "none") as CompositeEvents;
  if (!["none", "persons", "all"].includes(events)) throw new Error(`events は none / persons / all のどれかです: ${events}`);
  const scale = typeof req["scale"] === "number" ? req["scale"] : undefined;
  const r = await app.extras.composite.render({ whole: req["whole"] !== false, events, ask: false, ...(scale !== undefined ? { scale } : {}) });
  if (!r) throw new Error("マップが開かれていません");
  const heap = jsHeapBytes();
  try {
    if (req["clipboard"] === true) await writeClipboard(r.canvas);
    let png: string | null = null;
    if (req["png"] === true) {
      const bytes = new Uint8Array(await (await canvasPng(r.canvas)).arrayBuffer());
      let bin = "";
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      png = btoa(bin);
    }
    return {
      width: r.canvas.width,
      height: r.canvas.height,
      scale: r.scale,
      bounds: r.layout.bounds,
      maps: r.layout.maps.map((m) => ({ bank: m.id.bank, map: m.id.map, x: m.x, y: m.y, width: m.width, height: m.height })),
      heapMb: heap ? Math.round(heap.used / 10485.76) / 100 : null,
      png,
    };
  } finally {
    release(r.canvas);
  }
}

export const compositeCommands: CommandTable = {
  "image.composite": composite,
};
