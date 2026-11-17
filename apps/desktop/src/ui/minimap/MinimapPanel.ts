import { BLOCK_PIXELS, downscaleImage } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaMinimap as t } from "../../i18n/ja.minimap";
import "../../styles/minimap.css";
import { createDialog, type DialogFrame } from "../Dialog";
import { visibleEvents } from "../event/eventVisibility";
import { placedEvents, type EventKind } from "../map/EventLayer";
import type { MapView } from "../map/MapView";
import { toImageData } from "../canvas";
import type { TownZoom, TownZoomState } from "./TownZoom";
import type { TownLinkStore } from "../view/TownLinkStore";

/** 縮小図の長い辺の上限（画素）。 */
export const MINIMAP_MAX_SIDE = 200;
/** 描いている間に縮小図を作り直す間（ミリ秒。この間の変更をまとめる）。 */
const REBUILD_DELAY = 200;
/** 見えている範囲の枠の色。 */
const FRAME_COLOR = "#ffe000";
/** イベントの点の色（イベントタブの箱の色に近い色）。 */
const EVENT_COLORS: Readonly<Record<EventKind, string>> = {
  person: "#8fe010",
  warp: "#9040e0",
  trap: "#20a030",
  sign: "#f08010",
  fly: "#f01050",
};

/** 窓の外の機能（App が渡す）。 */
export interface MinimapHost {
  /** 今のタブのマップの表示（マップ・移動エリア・イベントのタブでなければ null）。 */
  activeView(): MapView | null;
  /** スクロールを見張る表示（3 つのタブ）。 */
  views(): readonly MapView[];
  /** × で閉じた（個人設定を直し、表示メニューのチェックを外す）。 */
  closed(): void;
  /** 窓を動かした（左上の位置を個人設定に残す）。 */
  moved(left: number, top: number): void;
  /** タウンマップの拡大を出すか（個人設定）。 */
  townShown(): boolean;
  /** タウンマップの拡大のチェックを変えた（個人設定に残す）。 */
  setTownShown(show: boolean): void;
  /** 地名の番号から名前（無ければ null）。 */
  regionName(region: number): string | null;
  /** タウンマップの小窓の紐づけ（小窓を作っていれば）。 */
  townLinks(): TownLinkStore | null;
}

/** 自動操作の `minimap.state` の返事。 */
export interface MinimapState {
  readonly open: boolean;
  /** 縮小図の大きさ（画素。出していなければ 0）。 */
  readonly width: number;
  readonly height: number;
  /** 縮小図の 1 画素が、マップの何画素か（の逆数。縮小図の画素 = マップの画素 × scale）。 */
  readonly scale: number;
  /** 見えている範囲の枠（縮小図の画素）。 */
  readonly frame: { x: number; y: number; width: number; height: number } | null;
  /** 縮小図を作った回数（開いてから）。 */
  readonly builds: number;
  /** 最後に縮小図を作るのにかかった時間（ミリ秒）。 */
  readonly buildMs: number;
  /** 出しているイベントの点の数。 */
  readonly events: number;
  /** タウンマップの拡大（出していなければ null）。 */
  readonly town: TownZoomState | null;
}

/**
 * ミニマップの小窓（Phase7 #511）。メインの画面に浮かぶ小窓に、開いているマップの縮小図（長い辺が 200 画素まで）と、
 * 今見えている範囲の黄色の枠を出す。押すかドラッグでその位置を真ん中にスクロールする。イベントは種類の色の点で出す
 * （表示 > イベントの種類ごとの表示 に従う）。縮小図はマップの画像（MapImage）から縮めて作り、描き直したときだけ
 * 間を空けて作り直す。開いている間だけ縮小図を持ち、閉じたら捨てる。
 */
export class MinimapPanel {
  private frame: DialogFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private note: HTMLElement | null = null;
  /** 縮小図（イベントと枠を除いた絵）。 */
  private thumb: HTMLCanvasElement | null = null;
  private scale = 0;
  private rebuildTimer: ReturnType<typeof setTimeout> | null = null;
  private overlayQueued = false;
  private builds = 0;
  private buildMs = 0;
  private eventCount = 0;
  private lastFrame: MinimapState["frame"] = null;
  private dragging = false;
  private townCheck: HTMLInputElement | null = null;
  private stage: HTMLElement | null = null;
  /** タウンマップの拡大（チェックが付いている間だけ作る）。 */
  private town: TownZoom | null = null;
  private townLoading: Promise<void> | null = null;
  private readonly offs: (() => void)[] = [];

  constructor(
    private readonly state: EditorState,
    private readonly host: MinimapHost,
  ) {}

  get isOpen(): boolean {
    return this.frame !== null;
  }

  /** 開く（`left`・`top` は前回の位置。無ければ右上に出す）。 */
  open(left: number | null = null, top: number | null = null): void {
    if (this.frame) return;
    this.build(left, top);
    const state = this.state;
    this.offs.push(
      // マップを切り替えたときは、メインの絵を出してから作る（切り替えの時間に入れない）
      state.on("map", () => {
        this.scheduleRebuild(0);
        this.town?.draw();
      }),
      state.on("session", () => {
        this.scheduleRebuild(0);
        this.town?.reset();
        void this.town?.refresh();
      }),
      state.on("cells", () => this.scheduleRebuild()),
      state.on("tiles", () => this.scheduleRebuild()),
      state.on("tab", () => this.queueOverlay()),
      state.on("view", () => {
        this.queueOverlay();
        this.town?.draw();
      }),
    );
    for (const view of this.host.views()) {
      const onScroll = (): void => this.queueOverlay();
      view.element.addEventListener("scroll", onScroll, { passive: true });
      this.offs.push(() => view.element.removeEventListener("scroll", onScroll));
    }
    const onResize = (): void => this.queueOverlay();
    window.addEventListener("resize", onResize);
    this.offs.push(() => window.removeEventListener("resize", onResize));
    this.rebuild();
    if (this.host.townShown()) void this.setTown(true);
  }

  /** タウンマップの拡大を出す・隠す（隠したら絵を捨てる）。読み込みと描くまで待つ。 */
  async setTown(show: boolean): Promise<void> {
    if (!this.frame) return;
    if (this.townCheck) this.townCheck.checked = show;
    if (!show) {
      this.town?.dispose();
      this.town = null;
      return;
    }
    if (!this.town) {
      this.townLoading ??= import("./TownZoom").then(({ TownZoom }) => {
        if (!this.frame || !this.townCheck?.checked || this.town) return;
        this.town = new TownZoom(this.state, (r) => this.host.regionName(r), () => this.host.townLinks());
        this.stage?.after(this.town.element);
      }).finally(() => (this.townLoading = null));
      await this.townLoading;
    }
    await this.town?.refresh();
    this.fitInWindow();
  }

  /** 窓の下がウィンドウの外へ出ていたら上へ寄せる（タウンマップの拡大を足したときなど）。 */
  private fitInWindow(): void {
    const box = this.frame?.box;
    if (!box) return;
    const r = box.getBoundingClientRect();
    const over = r.bottom - window.innerHeight;
    if (over <= 0) return;
    box.style.top = `${Math.max(0, r.top - over - 4)}px`;
  }

  /** 閉じる（縮小図も捨てる）。 */
  close(): void {
    this.town?.dispose();
    this.town = null;
    this.townCheck = null;
    this.stage = null;
    for (const off of this.offs.splice(0)) off();
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    if (this.thumb) this.thumb.width = this.thumb.height = 0;
    if (this.canvas) this.canvas.width = this.canvas.height = 0;
    this.thumb = null;
    this.canvas = null;
    this.note = null;
    this.frame?.remove();
    this.frame = null;
    this.scale = 0;
    this.lastFrame = null;
    this.builds = 0;
  }

  /** 自動操作用の状態。 */
  snapshot(): MinimapState {
    return {
      open: this.isOpen,
      width: this.thumb?.width ?? 0,
      height: this.thumb?.height ?? 0,
      scale: this.scale,
      frame: this.lastFrame,
      builds: this.builds,
      buildMs: Math.round(this.buildMs * 10) / 10,
      events: this.eventCount,
      town: this.town?.snapshot() ?? null,
    };
  }

  /** 縮小図を今すぐ作り直す（予約があれば取り消す）。自動操作でも使う。 */
  rebuild(): void {
    if (this.rebuildTimer) clearTimeout(this.rebuildTimer);
    this.rebuildTimer = null;
    if (!this.frame) return;
    const image = this.state.mapImage;
    if (!image) {
      if (this.thumb) this.thumb.width = this.thumb.height = 0;
      this.thumb = null;
      this.scale = 0;
      this.drawOverlay();
      return;
    }
    const t0 = performance.now();
    const small = downscaleImage(image.image, MINIMAP_MAX_SIDE);
    const thumb = this.thumb ?? document.createElement("canvas");
    thumb.width = small.width;
    thumb.height = small.height;
    thumb.getContext("2d")!.putImageData(toImageData(small), 0, 0);
    this.thumb = thumb;
    this.scale = small.width / image.image.width;
    this.buildMs = performance.now() - t0;
    this.builds++;
    this.drawOverlay();
    this.fitInWindow();
  }

  /** 縮小図の (x, y) 画素を押したのと同じ（その位置を真ん中にスクロールする）。動かせたら true。 */
  press(x: number, y: number): boolean {
    const view = this.host.activeView();
    if (!view || !this.thumb || this.scale <= 0) return false;
    const cell = BLOCK_PIXELS * this.scale;
    view.centerOn(x / cell, y / cell);
    this.drawOverlay();
    return true;
  }

  /** 縮小図の画像（イベントの点と枠を含む。自動操作用）。 */
  toPng(): string | null {
    return this.canvas && this.canvas.width > 0 ? this.canvas.toDataURL("image/png") : null;
  }

  private build(left: number | null, top: number | null): void {
    const frame = createDialog({ title: t.title, modal: false, className: "minimap-panel", onClose: () => this.closeByUser() });
    if (left !== null && top !== null) {
      frame.box.style.left = `${Math.max(0, Math.min(left, window.innerWidth - 60))}px`;
      frame.box.style.top = `${Math.max(0, Math.min(top, window.innerHeight - 40))}px`;
    } else {
      frame.box.style.right = "24px";
      frame.box.style.top = "400px";
    }
    frame.box.dataset["autoId"] = "minimap";
    frame.titleBar.addEventListener("pointerup", () => {
      const r = frame.box.getBoundingClientRect();
      this.host.moved(Math.round(r.left), Math.round(r.top));
    });
    const stage = document.createElement("div");
    stage.className = "minimap-stage";
    const canvas = document.createElement("canvas");
    canvas.className = "minimap-canvas";
    canvas.dataset["autoId"] = "minimap.canvas";
    canvas.width = 0;
    canvas.height = 0;
    const note = document.createElement("div");
    note.className = "minimap-note";
    note.textContent = t.noMap;
    note.hidden = true;
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 自動操作の作った押下は捕まえられない（そのまま続ける）
      }
      this.pressAt(e);
    });
    canvas.addEventListener("pointermove", (e) => {
      if (this.dragging) this.pressAt(e);
    });
    const stop = (): void => {
      this.dragging = false;
    };
    canvas.addEventListener("pointerup", stop);
    canvas.addEventListener("pointercancel", stop);
    stage.append(canvas, note);
    // タウンマップの現在地のまわりの拡大（小窓の中のチェック。個人設定に残す）
    const townRow = document.createElement("label");
    townRow.className = "minimap-town-check";
    const townCheck = document.createElement("input");
    townCheck.type = "checkbox";
    townCheck.dataset["autoId"] = "minimap.town";
    townCheck.checked = this.host.townShown();
    townCheck.addEventListener("change", () => {
      this.host.setTownShown(townCheck.checked);
      void this.setTown(townCheck.checked);
    });
    townRow.append(townCheck, t.town);
    frame.body.append(stage, townRow);
    this.townCheck = townCheck;
    this.stage = stage;
    this.frame = frame;
    this.canvas = canvas;
    this.note = note;
  }

  private pressAt(e: PointerEvent): void {
    const r = this.canvas!.getBoundingClientRect();
    this.press(e.clientX - r.left, e.clientY - r.top);
  }

  private closeByUser(): void {
    this.close();
    this.host.closed();
  }

  private scheduleRebuild(delay = REBUILD_DELAY): void {
    if (!this.frame) return;
    if (this.rebuildTimer) {
      if (delay >= REBUILD_DELAY) return;
      clearTimeout(this.rebuildTimer);
    }
    this.rebuildTimer = setTimeout(() => this.rebuild(), delay);
  }

  private queueOverlay(): void {
    if (!this.frame || this.overlayQueued) return;
    this.overlayQueued = true;
    requestAnimationFrame(() => {
      this.overlayQueued = false;
      this.drawOverlay();
    });
  }

  /** 縮小図に、イベントの点と見えている範囲の枠を重ねて描く。 */
  private drawOverlay(): void {
    const canvas = this.canvas;
    if (!canvas || !this.note) return;
    const thumb = this.thumb;
    const view = this.host.activeView();
    const show = thumb !== null && view !== null;
    this.note.hidden = show || !this.state.map;
    canvas.hidden = !show;
    this.lastFrame = null;
    this.eventCount = 0;
    if (!show) return;
    if (canvas.width !== thumb.width || canvas.height !== thumb.height) {
      canvas.width = thumb.width;
      canvas.height = thumb.height;
    }
    const c = canvas.getContext("2d")!;
    c.drawImage(thumb, 0, 0);
    const cell = BLOCK_PIXELS * this.scale;
    // イベントの点（マスが小さくても見えるよう 2 画素以上）
    const events = visibleEvents(placedEvents(this.state.map?.doc.events ?? null), this.state.settings.data.hiddenEventKinds);
    const dot = Math.max(2, Math.round(cell));
    for (const e of events) {
      c.fillStyle = EVENT_COLORS[e.kind];
      c.fillRect(Math.floor((e.x + 0.5) * cell - dot / 2), Math.floor((e.y + 0.5) * cell - dot / 2), dot, dot);
    }
    this.eventCount = events.length;
    // 見えている範囲の枠
    const v = view.visibleCells();
    const fx = Math.round(v.x * cell);
    const fy = Math.round(v.y * cell);
    const fw = Math.max(2, Math.round(v.width * cell));
    const fh = Math.max(2, Math.round(v.height * cell));
    this.lastFrame = { x: fx, y: fy, width: fw, height: fh };
    c.strokeStyle = FRAME_COLOR;
    c.lineWidth = 1;
    c.strokeRect(fx + 0.5, fy + 0.5, fw - 1, fh - 1);
  }
}
