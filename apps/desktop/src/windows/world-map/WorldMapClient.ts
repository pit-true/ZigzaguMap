import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { CommandRecord } from "@zigzagumap/core";
import {
  WorldMapEvents,
  type WorldMapCurrent,
  type WorldMapEnvelope,
  type WorldMapInit,
  type WorldMapReply,
  type WorldMapRequest,
  type WorldMapState,
} from "./protocol";

/** メインウィンドウから知らせが来たときの受け手。 */
export interface WorldMapClientListener {
  state(state: WorldMapState): void;
  current(current: WorldMapCurrent | null): void;
  reset(): void;
}

/**
 * エディターのウィンドウからメインウィンドウへの窓口。編集中の状態と操作の履歴はメインウィンドウが持ち、
 * ここは要求を送って返事を待つだけ（アンドゥ・出力もメインの履歴と出力をそのまま使う）。
 */
export class WorldMapClient {
  private nextId = 1;
  private readonly waiting = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();

  /** 購読を始める。 */
  async connect(listener: WorldMapClientListener): Promise<void> {
    const win = getCurrentWebviewWindow();
    await win.listen<WorldMapReply>(WorldMapEvents.reply, (e) => {
      const reply = e.payload;
      const w = this.waiting.get(reply.id);
      if (!w) return;
      this.waiting.delete(reply.id);
      if (reply.ok) w.resolve(reply.result);
      else w.reject(new Error(reply.error));
    });
    await win.listen<WorldMapState>(WorldMapEvents.state, (e) => listener.state(e.payload));
    await win.listen<WorldMapCurrent | null>(WorldMapEvents.current, (e) => listener.current(e.payload));
    await win.listen(WorldMapEvents.reset, () => listener.reset());
  }

  load(): Promise<WorldMapInit> {
    return this.send({ type: "load" }) as Promise<WorldMapInit>;
  }

  command(record: CommandRecord): Promise<unknown> {
    return this.send({ type: "command", record });
  }

  undo(): Promise<unknown> {
    return this.send({ type: "undo" });
  }

  redo(): Promise<unknown> {
    return this.send({ type: "redo" });
  }

  exportMaps(): Promise<unknown> {
    return this.send({ type: "export" });
  }

  openMap(bank: number, map: number): Promise<unknown> {
    return this.send({ type: "openMap", bank, map });
  }

  private send(request: WorldMapRequest): Promise<unknown> {
    const id = this.nextId++;
    const envelope: WorldMapEnvelope = { id, request };
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      emitTo("main", WorldMapEvents.request, envelope).catch((e: unknown) => {
        this.waiting.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      });
    });
  }
}
