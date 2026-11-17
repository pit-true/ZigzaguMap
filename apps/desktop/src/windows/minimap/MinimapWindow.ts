import "../../styles/minimap.css";
import { emitTo } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { LogicalSize } from "@tauri-apps/api/dpi";
import { jaMinimap as t } from "../../i18n/ja.minimap";
import { PendingReplies } from "../../util/pendingReplies";
import { startToolWindowAutomation } from "../world-map/toolWindowAutomation";
import {
  MINIMAP_MESSAGE_EVENT,
  MINIMAP_REQUEST_EVENT,
  MINIMAP_TOWN_HEIGHT,
  type MinimapAll,
  type MinimapMessage,
  type MinimapRequest,
  type MinimapThumb,
  type MinimapTown,
  type MinimapView,
} from "./protocol";
import { drawMinimapImage } from "./rgba";

/** 見えている範囲の枠の色。 */
const FRAME_COLOR = "#ffe000";

/** 要求の中身（番号は付けて送る）。 */
type RequestBody = MinimapRequest extends infer R ? (R extends MinimapRequest ? Omit<R, "id"> : never) : never;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, autoId?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.className = className;
  if (autoId) e.dataset["autoId"] = autoId;
  return e;
}

/**
 * ミニマップのウィンドウ（#542。メインの外へ、別のモニターにも動かせる OS のウィンドウ）。
 * メインから届いた縮小図（長い辺 200 画素まで）を、ウィンドウの大きさに合わせて拡大・縮小して出し、見えている範囲の黄色の枠を重ねる。
 * 押すかドラッグすると、その位置をメインへ送ってスクロールしてもらう。下の「タウンマップも出す」で、タウンマップの拡大も出す。
 */
export class MinimapWindow {
  private readonly pending = new PendingReplies();
  /** 届いた縮小図（等倍）。 */
  private readonly thumb = document.createElement("canvas");
  private hasThumb = false;
  private view: MinimapView = { frame: null, note: null };
  private readonly stage = el("div", "minimap-stage");
  private readonly canvas = el("canvas", "minimap-canvas", "minimap.canvas");
  private readonly note = el("div", "minimap-note", "minimap.note");
  private readonly townCheck = el("input", "", "minimap.town");
  private readonly townBox = el("div", "minimap-town", "minimap.townView");
  private readonly townCanvas = el("canvas", "minimap-town-canvas", "minimap.townCanvas");
  private readonly townLabel = el("div", "minimap-note", "minimap.townLabel");
  /** 縮小図の 1 画素を出す大きさ（CSS ピクセル）。 */
  private displayScale = 1;
  private dragging = false;
  private pressing = false;
  private nextPress: { x: number; y: number } | null = null;

  constructor(private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    this.build();
    await getCurrentWebviewWindow().listen<MinimapMessage>(MINIMAP_MESSAGE_EVENT, (e) => this.onMessage(e.payload));
    const all = (await this.request({ op: "hello" })) as MinimapAll;
    this.townCheck.checked = all.townShown;
    this.townBox.hidden = !all.townShown;
    this.setThumb(all.thumb);
    this.view = all.view;
    this.setTown(all.town);
    this.layout();
    new ResizeObserver(() => this.layout()).observe(this.stage);
    await startToolWindowAutomation({
      describe: () => this.describe(),
      canvas: (id) => (id === "minimap.canvas" ? this.canvas : id === "minimap.townCanvas" ? this.townCanvas : null)?.toDataURL("image/png") ?? null,
    });
  }

  private request(body: RequestBody): Promise<unknown> {
    const { id, reply, fail } = this.pending.open();
    emitTo("main", MINIMAP_REQUEST_EVENT, { ...body, id }).catch(fail);
    return reply;
  }

  private onMessage(m: MinimapMessage): void {
    switch (m.type) {
      case "reply":
        this.pending.settle(m);
        return;
      case "thumb":
        this.setThumb(m.thumb);
        this.layout();
        return;
      case "view":
        this.view = m.view;
        this.layout();
        return;
      case "town":
        if (m.shown !== this.townCheck.checked) {
          this.townCheck.checked = m.shown;
          void this.showTown(m.shown);
        }
        this.setTown(m.town);
        return;
    }
  }

  private build(): void {
    document.title = t.title;
    this.root.classList.add("minimap-window");
    this.canvas.width = this.canvas.height = 0;
    this.note.hidden = true;
    this.canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      try {
        this.canvas.setPointerCapture(e.pointerId);
      } catch {
        // 自動操作の作った押下は捕まえられない（そのまま続ける）
      }
      this.pressAt(e);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (this.dragging) this.pressAt(e);
    });
    const stop = (): void => {
      this.dragging = false;
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
    this.stage.append(this.canvas, this.note);
    // タウンマップの現在地のまわりの拡大（個人設定に残す）
    const townRow = el("label", "minimap-town-check");
    this.townCheck.type = "checkbox";
    this.townCheck.addEventListener("change", () => {
      const on = this.townCheck.checked;
      void this.showTown(on);
      void this.request({ op: "town", on }).catch(() => undefined);
    });
    townRow.append(this.townCheck, t.town);
    this.townCanvas.width = this.townCanvas.height = 0;
    this.townBox.append(this.townCanvas, this.townLabel);
    this.townBox.hidden = true;
    this.root.append(this.stage, townRow, this.townBox);
  }

  private setThumb(thumb: MinimapThumb): void {
    if (thumb.image) drawMinimapImage(this.thumb, thumb.image);
    else this.thumb.width = this.thumb.height = 0;
    this.hasThumb = thumb.image !== null;
    const title = thumb.mapName ? `${t.title} - ${thumb.mapName}` : t.title;
    if (document.title !== title) {
      document.title = title;
      void getCurrentWebviewWindow().setTitle(title).catch(() => undefined);
    }
  }

  private setTown(town: MinimapTown | null): void {
    if (!town || !this.townCheck.checked) {
      this.townCanvas.width = this.townCanvas.height = 0;
      this.townCanvas.hidden = true;
      this.townLabel.textContent = "";
      return;
    }
    this.townLabel.textContent = town.text;
    this.townCanvas.hidden = town.image === null;
    if (town.image) drawMinimapImage(this.townCanvas, town.image);
    else this.townCanvas.width = this.townCanvas.height = 0;
  }

  /** 縮小図をウィンドウの大きさに合わせて描き、枠を重ねる。 */
  private layout(): void {
    const frame = this.view.frame;
    const show = this.hasThumb && frame !== null;
    this.canvas.hidden = !show;
    this.note.hidden = show || this.view.note === null;
    this.note.textContent = this.view.note ?? "";
    if (!show) return;
    const tw = this.thumb.width;
    const th = this.thumb.height;
    const availW = Math.max(16, this.stage.clientWidth);
    const availH = Math.max(16, this.stage.clientHeight);
    const s = Math.min(availW / tw, availH / th);
    this.displayScale = s;
    const cssW = Math.max(1, Math.floor(tw * s));
    const cssH = Math.max(1, Math.floor(th * s));
    const dpr = window.devicePixelRatio || 1;
    const canvas = this.canvas;
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    const bw = Math.round(cssW * dpr);
    const bh = Math.round(cssH * dpr);
    if (canvas.width !== bw || canvas.height !== bh) {
      canvas.width = bw;
      canvas.height = bh;
    }
    const c = canvas.getContext("2d")!;
    // 拡大するときは画素をそのまま大きくする（ぼかさない）
    c.imageSmoothingEnabled = s * dpr < 1;
    c.clearRect(0, 0, bw, bh);
    c.drawImage(this.thumb, 0, 0, bw, bh);
    const k = (bw / tw + bh / th) / 2;
    c.strokeStyle = FRAME_COLOR;
    c.lineWidth = Math.max(1, Math.round(dpr));
    const half = c.lineWidth / 2;
    c.strokeRect(Math.round(frame.x * k) + half, Math.round(frame.y * k) + half, Math.max(1, Math.round(frame.width * k) - c.lineWidth), Math.max(1, Math.round(frame.height * k) - c.lineWidth));
  }

  private pressAt(e: PointerEvent): void {
    const r = this.canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / this.displayScale;
    const y = (e.clientY - r.top) / this.displayScale;
    this.press(x, y);
  }

  /** メインへ押した位置を送る（ドラッグ中は返事を待ってから最後の位置だけを送る）。 */
  private press(x: number, y: number): void {
    if (this.pressing) {
      this.nextPress = { x, y };
      return;
    }
    this.pressing = true;
    void this.request({ op: "press", x, y })
      .catch(() => undefined)
      .finally(() => {
        this.pressing = false;
        const next = this.nextPress;
        this.nextPress = null;
        if (next) this.press(next.x, next.y);
      });
  }

  /** 「タウンマップも出す」を変えた。ウィンドウの高さも拡大の分だけ変える（最大化していなければ）。 */
  private async showTown(on: boolean): Promise<void> {
    this.townBox.hidden = !on;
    if (!on) this.setTown(null);
    const win = getCurrentWebviewWindow();
    try {
      if (!(await win.isMaximized())) {
        const sf = await win.scaleFactor();
        const size = (await win.innerSize()).toLogical(sf);
        await win.setSize(new LogicalSize(size.width, Math.max(80, size.height + (on ? MINIMAP_TOWN_HEIGHT : -MINIMAP_TOWN_HEIGHT))));
      }
    } catch {
      // 大きさを変えられなくても続ける
    }
  }

  private describe(): unknown {
    return {
      title: document.title,
      thumb: { width: this.thumb.width, height: this.thumb.height },
      shown: !this.canvas.hidden,
      displayScale: Math.round(this.displayScale * 1000) / 1000,
      frame: this.view.frame,
      note: this.note.hidden ? null : this.note.textContent,
      town: this.townCheck.checked ? { text: this.townLabel.textContent, width: this.townCanvas.width, height: this.townCanvas.height } : null,
      stage: { width: this.stage.clientWidth, height: this.stage.clientHeight },
    };
  }
}
