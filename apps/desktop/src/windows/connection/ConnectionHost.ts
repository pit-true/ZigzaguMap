import { emitTo, listen } from "@tauri-apps/api/event";
import { SetConnectionCommand, ShiftConnectionCommand, inverseOf, type Command, type CommandRecord, type MapConnection, type MapId } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { WindowPlacement } from "../../app/Settings";
import { ja } from "../../i18n/ja";
import { commit } from "../../ui/form/commit";
import { errorText } from "../../util/errors";
import { scheduleIdleGc } from "../../util/idleGc";
import { closeToolWindow, onToolWindowClosed, openToolWindow } from "../toolWindowCommands";
import { renderConnectionPreview } from "./connectionPreview";
import {
  CONNECTION_MESSAGE_EVENT,
  CONNECTION_REQUEST_EVENT,
  CONNECTION_SIZE,
  CONNECTION_WINDOW,
  type ConnectionData,
  type ConnectionMessage,
  type ConnectionPreview,
  type ConnectionRequest,
} from "./protocol";

/** ウィンドウの準備（`hello`）を待つ時間の上限（ミリ秒）。 */
const READY_TIMEOUT = 10_000;

/** `tool-placement` の中身。 */
interface PlacementEvent extends WindowPlacement {
  readonly label: string;
}

/** 自動操作の `connection.state` の返事（メイン側）。 */
export interface ConnectionHostState {
  readonly open: boolean;
  readonly ready: boolean;
  /** 絵を作った回数（開いてから）。 */
  readonly previews: number;
  /** 最後に作った絵（画像の中身は除く）。 */
  readonly preview: Omit<ConnectionPreview, "image"> & { readonly width: number; readonly height: number; readonly sentBytes: number } | null;
}

/**
 * メインウィンドウ側の、コネクションマネージャー（別ウィンドウ。#561）の受け手。ツール > マップの移動 を初めて選んだときに読み込む。
 *
 * - 接続の一覧は、マップを切り替えたとき・操作（実行・元に戻す・やり直す）のあとに送る。
 * - 接続先の絵は、ウィンドウが頼んだときに作る。接続・マップ・絵の番号（`generation`）が同じなら作らず、送らない。
 *   マップの絵やタイルセット・ほかのマップが変わったら番号を増やし、ウィンドウが頼み直す。
 * - 「保存」の変更は、設定 > 接続のずれを相手のマップにもそろえる（既定オン）なら相手もそろえ、1 回の操作で実行する。
 * - ウィンドウを開いている間だけ見張り、閉じたら捨てる。位置と大きさは個人設定の `toolWindows` に残す。
 */
export class ConnectionHost {
  static async create(state: EditorState, openMap: (id: MapId) => Promise<void>): Promise<ConnectionHost> {
    const host = new ConnectionHost(state, openMap);
    await host.start();
    return host;
  }

  private opened = false;
  private ready = false;
  private readonly offs: (() => void)[] = [];
  private unsubscribeBus: (() => void) | null = null;
  private generation = 0;
  private dataQueued: { force: boolean } | null = null;
  private previewKey = "";
  private previews = 0;
  private lastPreview: ConnectionHostState["preview"] = null;
  private waiters: (() => void)[] = [];

  private constructor(
    private readonly state: EditorState,
    private readonly openMap: (id: MapId) => Promise<void>,
  ) {}

  private async start(): Promise<void> {
    await listen<ConnectionRequest>(CONNECTION_REQUEST_EVENT, (e) => void this.onRequest(e.payload));
    await onToolWindowClosed((label) => {
      if (label === CONNECTION_WINDOW && this.opened) this.dispose();
    });
    await listen<PlacementEvent>("tool-placement", (e) => {
      const { label, ...placement } = e.payload;
      if (label !== CONNECTION_WINDOW) return;
      const settings = this.state.settings;
      settings.update({ toolWindows: { ...settings.data.toolWindows, [label]: placement } });
    });
  }

  get isOpen(): boolean {
    return this.opened;
  }

  /** ウィンドウを開く（開いていれば前に出す）。ウィンドウの準備ができるまで待つ。 */
  async open(): Promise<void> {
    if (!this.opened) {
      this.opened = true;
      this.watch();
    }
    const placement = this.state.settings.data.toolWindows[CONNECTION_WINDOW] ?? null;
    const ready = this.ready ? Promise.resolve() : new Promise<void>((resolve) => this.waiters.push(resolve));
    try {
      await openToolWindow(CONNECTION_WINDOW, ja.conn.title, CONNECTION_SIZE, { minWidth: CONNECTION_SIZE.minWidth, minHeight: CONNECTION_SIZE.minHeight, placement, remember: true });
    } catch (e) {
      this.dispose();
      throw e;
    }
    await Promise.race([ready, new Promise((r) => setTimeout(r, READY_TIMEOUT))]);
  }

  /** ウィンドウを閉じる（保存していない変更は捨てる。AdvanceMap と同じく確認しない）。 */
  async close(): Promise<void> {
    if (!this.opened) return;
    this.dispose();
    await closeToolWindow(CONNECTION_WINDOW).catch(() => undefined);
  }

  snapshot(): ConnectionHostState {
    return { open: this.opened, ready: this.ready, previews: this.previews, preview: this.lastPreview };
  }

  // ---- 内部 ----

  private watch(): void {
    const state = this.state;
    this.offs.push(
      state.on("map", () => this.queueData(true)),
      state.on("session", () => {
        this.subscribeBus();
        this.queueData(true);
      }),
      // マップの絵・タイルセット・時間帯やレイヤーの表示が変わったら、絵を頼み直してもらう
      state.on("cells", () => this.queueData(false)),
      state.on("tiles", () => this.queueData(false)),
      state.on("view", () => this.queueData(false)),
    );
    this.subscribeBus();
  }

  private subscribeBus(): void {
    this.unsubscribeBus?.();
    this.unsubscribeBus = this.state.session?.bus.subscribe(() => this.queueData(false)) ?? null;
  }

  private dispose(): void {
    this.opened = false;
    this.ready = false;
    for (const off of this.offs.splice(0)) off();
    this.unsubscribeBus?.();
    this.unsubscribeBus = null;
    this.previewKey = "";
    this.previews = 0;
    this.lastPreview = null;
    this.dataQueued = null;
    for (const w of this.waiters.splice(0)) w();
    scheduleIdleGc(true);
  }

  /** 一覧を送る（同じフレームの中の変更は 1 回にまとめる）。 */
  private queueData(force: boolean): void {
    if (!this.ready) return;
    this.generation++;
    if (this.dataQueued) {
      this.dataQueued.force ||= force;
      return;
    }
    const queued = { force };
    this.dataQueued = queued;
    setTimeout(() => {
      if (this.dataQueued !== queued) return;
      this.dataQueued = null;
      void this.send({ type: "data", data: this.data(queued.force) });
    }, 0);
  }

  /** 送るのを待っている一覧があれば、今すぐ送る。 */
  private async flushData(): Promise<void> {
    const queued = this.dataQueued;
    if (!queued) return;
    this.dataQueued = null;
    await this.send({ type: "data", data: this.data(queued.force) });
  }

  private data(force: boolean): ConnectionData {
    const map = this.state.map;
    return {
      key: map ? `${map.id.bank}.${map.id.map}` : "",
      mapName: map ? (map.doc.mapNameText() ?? ja.noName) : "",
      connections: (map?.doc.connections ?? []).map((c) => ({ ...c })),
      force,
      generation: this.generation,
    };
  }

  private async send(message: ConnectionMessage): Promise<void> {
    if (!this.opened) return;
    await emitTo(CONNECTION_WINDOW, CONNECTION_MESSAGE_EVENT, message).catch(() => undefined);
  }

  private async onRequest(req: ConnectionRequest): Promise<void> {
    try {
      const result = await this.handle(req);
      await this.send({ type: "reply", id: req.id, ok: true, result });
    } catch (e) {
      await this.send({ type: "reply", id: req.id, ok: false, error: errorText(e) });
    }
  }

  private async handle(req: ConnectionRequest): Promise<unknown> {
    switch (req.op) {
      case "hello":
        if (!this.opened) {
          this.opened = true;
          this.watch();
        }
        this.ready = true;
        this.previewKey = "";
        for (const w of this.waiters.splice(0)) w();
        return this.data(true);
      case "save": {
        const saved = await this.save(req.key, req.commands);
        await this.flushData();
        return { saved };
      }
      case "follow": {
        const id = { bank: req.bank, map: req.map };
        if (!this.state.session?.catalog.has(id)) {
          this.state.setStatus(ja.mapNotFound, undefined, true);
          return { opened: false };
        }
        await this.openMap(id);
        // 返事より先に新しいマップの一覧を届ける（ウィンドウの欄が返事のときに新しくなっているように）
        await this.flushData();
        return { opened: true };
      }
      case "preview": {
        const map = this.state.map;
        const key = JSON.stringify([req.key, req.generation, req.target, map ? `${map.id.bank}.${map.id.map}` : ""]);
        if (key === this.previewKey) return { unchanged: true };
        if (!req.target || !map || req.key !== `${map.id.bank}.${map.id.map}`) {
          this.previewKey = key;
          this.lastPreview = null;
          return { preview: null };
        }
        const preview = await renderConnectionPreview(this.state, req.target);
        this.previewKey = key;
        this.previews++;
        const { image, ...rest } = preview;
        this.lastPreview = { ...rest, width: image?.width ?? 0, height: image?.height ?? 0, sentBytes: image?.rgba.length ?? 0 };
        return { preview };
      }
    }
  }

  /** 表の変更を実行する（相手のずれもそろえる）。実行したら true。 */
  private async save(key: string, records: readonly CommandRecord[]): Promise<boolean> {
    const map = this.state.map;
    const session = this.state.session;
    if (!map || !session || key !== `${map.id.bank}.${map.id.map}`) return false;
    let commands: Command[] = records.map((r) => session.registry.create(r));
    // 設定 > 接続のずれを相手のマップにもそろえる（既定オン。Phase3 #229）
    if (this.state.settings.data.alignConnections) commands = await this.alignPartners(map.id, map.doc.connections ?? [], commands);
    return commit(this.state, commands);
  }

  /** ずれだけを変える setConnection を、相手もそろえる shiftConnection に置き換える（相手に逆の接続が無ければそのまま）。 */
  private async alignPartners(id: MapId, before: readonly MapConnection[], commands: Command[]): Promise<Command[]> {
    const session = this.state.session;
    if (!session) return commands;
    const out: Command[] = [];
    for (const c of commands) {
      const a = c.args as { index?: unknown; offset?: unknown };
      const keys = Object.keys(c.args).filter((k) => k !== "bank" && k !== "map" && k !== "index");
      const old = typeof a.index === "number" ? before[a.index] : undefined;
      const partner = old ? { bank: old.bank, map: old.map } : null;
      if (c.name !== SetConnectionCommand.NAME || keys.length !== 1 || typeof a.offset !== "number" || !old || !partner || !session.catalog.has(partner)) {
        out.push(c);
        continue;
      }
      const other = await session.project.load(partner).catch(() => null);
      if (!other || inverseOf(other.connections, id, old.direction, old.offset) === null) out.push(c);
      else out.push(ShiftConnectionCommand.of(id, a.index as number, a.offset, partner));
    }
    return out;
  }
}
