import { emitTo, listen } from "@tauri-apps/api/event";
import { BLOCK_PIXELS, downscaleImage } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { WindowPlacement } from "../../app/Settings";
import { jaMinimap as t } from "../../i18n/ja.minimap";
import type { MapView } from "../../ui/map/MapView";
import type { TownLinkStore } from "../../ui/view/TownLinkStore";
import { errorText } from "../../util/errors";
import { scheduleIdleGc } from "../../util/idleGc";
import { closeToolWindow, onToolWindowClosed, openToolWindow } from "../toolWindowCommands";
import {
  MINIMAP_MESSAGE_EVENT,
  MINIMAP_REQUEST_EVENT,
  MINIMAP_SIZE,
  MINIMAP_TOWN_HEIGHT,
  MINIMAP_WINDOW,
  type MinimapAll,
  type MinimapFrame,
  type MinimapMessage,
  type MinimapRequest,
  type MinimapThumb,
  type MinimapTown,
  type MinimapView,
} from "./protocol";
import { rgbaOf } from "./rgba";
import { TownZoom, type TownZoomState } from "./TownZoom";

/** 縮小図の長い辺の上限（画素）。 */
export const MINIMAP_MAX_SIDE = 200;
/** 描いている間に縮小図を作り直す間（ミリ秒。この間の変更をまとめる）。 */
const REBUILD_DELAY = 200;

/** メインの画面の部品（App が渡す）。 */
export interface MinimapDeps {
  readonly state: EditorState;
  /** 今のタブのマップの表示（マップ・移動エリア・イベントのタブでなければ null）。 */
  activeView(): MapView | null;
  /** スクロールを見張る表示（3 つのタブ）。 */
  views(): readonly MapView[];
  /** ウィンドウの × で閉じた（個人設定を直し、表示メニューのチェックを外す）。 */
  closed(): void;
  /** 地名の番号から名前（無ければ null）。 */
  regionName(region: number): string | null;
  /** タウンマップの小窓の紐づけ（小窓を作っていれば）。 */
  townLinks(): TownLinkStore | null;
}

/** 自動操作の `minimap.state` の返事（メイン側）。 */
export interface MinimapState {
  /** ウィンドウを開いている（開こうとしている）か。 */
  readonly open: boolean;
  /** ウィンドウの準備ができた（`hello` が届いた）か。 */
  readonly ready: boolean;
  /** 縮小図の大きさ（画素。出していなければ 0）。 */
  readonly width: number;
  readonly height: number;
  /** 縮小図の画素 = マップの画素 × scale。 */
  readonly scale: number;
  /** 見えている範囲の枠（縮小図の画素）。 */
  readonly frame: MinimapFrame | null;
  /** 縮小図を作った回数（開いてから）。 */
  readonly builds: number;
  /** 最後に縮小図を作るのにかかった時間（ミリ秒）。 */
  readonly buildMs: number;
  /** 縮小図を送った大きさ（バイト。base64 の文字数。最後の 1 回）。 */
  readonly sentBytes: number;
  /** タウンマップの拡大（出していなければ null）。 */
  readonly town: TownZoomState | null;
}

/** `tool-placement` の中身。 */
interface PlacementEvent extends WindowPlacement {
  readonly label: string;
}

/**
 * メインウィンドウ側の、ミニマップ（別ウィンドウ。Phase7 #511 を #542 で別ウィンドウにした）の受け手。
 * 表示 > ミニマップ を初めて選んだときに読み込む。
 *
 * - 縮小図はメインのマップの画像（MapImage）から縮めて作り（長い辺 200 画素まで）、マップを切り替えたとき・描いたとき
 *   （間を空けてまとめる）だけ送る。メインの絵をそのまま送り続けることはしない。
 * - 見えている範囲の枠は、スクロールなどのたびに枠の位置だけを送る（同じなら送らない）。
 * - ウィンドウを開いている間だけ見張り、閉じたら見張りもタウンマップの絵も捨てる。
 * - ウィンドウの位置と大きさは個人設定の `toolWindows`（スクリプトエディタと同じ）に残す。
 */
export class MinimapHost {
  /** 受け手を作る（イベントの受け付けを始める）。 */
  static async create(deps: MinimapDeps): Promise<MinimapHost> {
    const host = new MinimapHost(deps);
    await host.start();
    return host;
  }

  private opened = false;
  private ready = false;
  private readonly offs: (() => void)[] = [];
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private viewQueued = false;
  private viewKey = "";
  private width = 0;
  private height = 0;
  private scale = 0;
  private frame: MinimapFrame | null = null;
  private builds = 0;
  private buildMs = 0;
  private sentBytes = 0;
  /** タウンマップの拡大（出している間だけ作る）。 */
  private town: TownZoom | null = null;
  private townKey = "";

  private constructor(private readonly deps: MinimapDeps) {}

  private async start(): Promise<void> {
    await listen<MinimapRequest>(MINIMAP_REQUEST_EVENT, (e) => void this.onRequest(e.payload));
    await onToolWindowClosed((label) => {
      if (label !== MINIMAP_WINDOW || !this.opened) return;
      // × で閉じた（メインから閉じたときは先に opened を下ろしている）
      this.dispose();
      this.deps.closed();
    });
    await listen<PlacementEvent>("tool-placement", (e) => {
      const { label, ...placement } = e.payload;
      if (label !== MINIMAP_WINDOW) return;
      const settings = this.deps.state.settings;
      settings.update({ toolWindows: { ...settings.data.toolWindows, [label]: placement } });
    });
  }

  /** ウィンドウを開いているか。 */
  get isOpen(): boolean {
    return this.opened;
  }

  /** ウィンドウを開く（開いていれば前に出す）。 */
  async open(): Promise<void> {
    const state = this.deps.state;
    if (!this.opened) {
      this.opened = true;
      this.watch();
    }
    const placement = state.settings.data.toolWindows[MINIMAP_WINDOW] ?? null;
    const town = state.settings.data.minimap.town === true;
    const size = { width: MINIMAP_SIZE.width, height: MINIMAP_SIZE.height + (town ? MINIMAP_TOWN_HEIGHT : 0) };
    try {
      await openToolWindow(MINIMAP_WINDOW, t.title, size, { minWidth: MINIMAP_SIZE.minWidth, minHeight: MINIMAP_SIZE.minHeight, placement, remember: true });
    } catch (e) {
      this.dispose();
      throw e;
    }
  }

  /** ウィンドウを閉じる（縮小図とタウンマップの絵も捨てる）。 */
  async close(): Promise<void> {
    if (!this.opened) return;
    this.dispose();
    await closeToolWindow(MINIMAP_WINDOW).catch(() => undefined);
  }

  /** 自動操作用の状態。 */
  snapshot(): MinimapState {
    return {
      open: this.opened,
      ready: this.ready,
      width: this.width,
      height: this.height,
      scale: this.scale,
      frame: this.frame,
      builds: this.builds,
      buildMs: Math.round(this.buildMs * 10) / 10,
      sentBytes: this.sentBytes,
      town: this.town?.snapshot() ?? null,
    };
  }

  /** 縮小図を今すぐ作り直して送る（予約があれば取り消す）。自動操作でも使う。 */
  rebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    if (!this.ready) return;
    void this.send({ type: "thumb", thumb: this.makeThumb() });
    this.sendView(true);
  }

  /** 縮小図の (x, y) 画素を押したのと同じ（その位置を真ん中にスクロールする）。動かせたら true。 */
  press(x: number, y: number): boolean {
    const view = this.deps.activeView();
    if (!view || this.scale <= 0) return false;
    const cell = BLOCK_PIXELS * this.scale;
    view.centerOn(x / cell, y / cell);
    this.sendView(false);
    return true;
  }

  /** タウンマップの拡大を出す・隠す（個人設定に残す。隠したら絵を捨てる）。読み込んで送るまで待つ。 */
  async setTown(on: boolean): Promise<void> {
    const settings = this.deps.state.settings;
    if ((settings.data.minimap.town === true) !== on) settings.update({ minimap: { ...settings.data.minimap, town: on } });
    if (!on) {
      this.town?.dispose();
      this.town = null;
      this.townKey = "";
      await this.send({ type: "town", shown: false, town: null });
      return;
    }
    if (!this.opened) return;
    const town = this.ensureTown();
    const drawn = await town.refresh();
    if (this.town === town) await this.sendTown(drawn, true);
  }

  // ---- 内部 ----

  /** 開いている間の見張り。 */
  private watch(): void {
    const state = this.deps.state;
    this.offs.push(
      // マップを切り替えたときは、メインの絵を出してから作る（切り替えの時間に入れない）
      state.on("map", () => {
        this.scheduleRebuild(0);
        this.redrawTown();
      }),
      state.on("session", () => {
        this.scheduleRebuild(0);
        const town = this.town;
        if (!town) return;
        town.reset();
        void town.refresh().then(async (drawn) => {
          if (this.town === town) await this.sendTown(drawn, false);
        });
      }),
      state.on("cells", () => this.scheduleRebuild()),
      state.on("tiles", () => this.scheduleRebuild()),
      state.on("tab", () => this.queueView()),
      state.on("view", () => {
        this.queueView();
        this.redrawTown();
      }),
    );
    for (const view of this.deps.views()) {
      const onScroll = (): void => this.queueView();
      view.element.addEventListener("scroll", onScroll, { passive: true });
      this.offs.push(() => view.element.removeEventListener("scroll", onScroll));
    }
    const onResize = (): void => this.queueView();
    window.addEventListener("resize", onResize);
    this.offs.push(() => window.removeEventListener("resize", onResize));
  }

  /** 見張りをやめ、持っているものを捨てる。 */
  private dispose(): void {
    this.opened = false;
    this.ready = false;
    for (const off of this.offs.splice(0)) off();
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    this.town?.dispose();
    this.town = null;
    this.townKey = "";
    this.viewKey = "";
    this.width = this.height = this.scale = 0;
    this.frame = null;
    this.builds = 0;
    this.sentBytes = 0;
    scheduleIdleGc(true);
  }

  private scheduleRebuild(delay = REBUILD_DELAY): void {
    if (!this.ready || this.rebuildTimer) return;
    this.rebuildTimer = setTimeout(() => this.rebuild(), delay);
  }

  /** 縮小図を作る（送る形）。 */
  private makeThumb(): MinimapThumb {
    const map = this.deps.state.map;
    const image = this.deps.state.mapImage;
    const mapName = map ? (map.doc.mapNameText() ?? `${map.id.bank}.${map.id.map}`) : "";
    if (!image) {
      this.width = this.height = this.scale = 0;
      this.sentBytes = 0;
      return { image: null, mapName };
    }
    const t0 = performance.now();
    const small = downscaleImage(image.image, MINIMAP_MAX_SIDE);
    const sent = rgbaOf(small);
    this.width = small.width;
    this.height = small.height;
    this.scale = small.width / image.image.width;
    this.buildMs = performance.now() - t0;
    this.builds++;
    this.sentBytes = sent.rgba.length;
    return { image: sent, mapName };
  }

  /** 枠（タブがマップを出さないか、縮小図が無ければ null）。 */
  private view(): MinimapView {
    const view = this.deps.activeView();
    if (!view || this.scale <= 0) {
      this.frame = null;
      return { frame: null, note: this.deps.state.map ? t.noMap : null };
    }
    const cell = BLOCK_PIXELS * this.scale;
    const v = view.visibleCells();
    this.frame = {
      x: Math.round(v.x * cell),
      y: Math.round(v.y * cell),
      width: Math.max(2, Math.round(v.width * cell)),
      height: Math.max(2, Math.round(v.height * cell)),
    };
    return { frame: this.frame, note: null };
  }

  /** 枠を送る（次のフレームでまとめる）。 */
  private queueView(): void {
    if (!this.ready || this.viewQueued) return;
    this.viewQueued = true;
    requestAnimationFrame(() => {
      this.viewQueued = false;
      this.sendView(false);
    });
  }

  /** 枠を送る（`force` でなければ、前に送ったものと同じなら送らない）。 */
  private sendView(force: boolean): void {
    if (!this.ready) return;
    const view = this.view();
    const key = JSON.stringify(view);
    if (!force && key === this.viewKey) return;
    this.viewKey = key;
    void this.send({ type: "view", view });
  }

  private redrawTown(): void {
    if (this.town) void this.sendTown(this.town.draw(), false);
  }

  /** タウンマップの拡大を送る（`force` でなければ、場所と文字が前と同じなら送らない）。 */
  private async sendTown(town: MinimapTown, force: boolean): Promise<void> {
    const s = this.town?.snapshot();
    const key = JSON.stringify([s?.area, s?.frame, town.text]);
    if (!force && key === this.townKey) return;
    this.townKey = key;
    await this.send({ type: "town", shown: true, town });
  }

  private ensureTown(): TownZoom {
    return (this.town ??= new TownZoom(
      this.deps.state,
      (r) => this.deps.regionName(r),
      () => this.deps.townLinks(),
    ));
  }

  private async send(message: MinimapMessage): Promise<void> {
    if (!this.opened) return;
    await emitTo(MINIMAP_WINDOW, MINIMAP_MESSAGE_EVENT, message).catch(() => undefined);
  }

  private async onRequest(req: MinimapRequest): Promise<void> {
    try {
      const result = await this.handle(req);
      await this.send({ type: "reply", id: req.id, ok: true, result });
    } catch (e) {
      await this.send({ type: "reply", id: req.id, ok: false, error: errorText(e) });
    }
  }

  private async handle(req: MinimapRequest): Promise<unknown> {
    switch (req.op) {
      case "hello": {
        if (!this.opened) {
          // メインが知らないうちに開いた（自動操作で開き直したときなど）
          this.opened = true;
          this.watch();
        }
        this.ready = true;
        this.viewKey = "";
        const thumb = this.makeThumb();
        const view = this.view();
        this.viewKey = JSON.stringify(view);
        const townShown = this.deps.state.settings.data.minimap.town === true;
        let town: MinimapTown | null = null;
        if (townShown) {
          const zoom = this.ensureTown();
          town = await zoom.refresh();
          const s = zoom.snapshot();
          this.townKey = JSON.stringify([s.area, s.frame, town.text]);
        }
        const all: MinimapAll = { thumb, view, townShown, town };
        return all;
      }
      case "press":
        this.press(req.x, req.y);
        return this.frame;
      case "town":
        await this.setTown(req.on);
        return null;
    }
  }
}
