import type { EditorState } from "../../app/EditorState";
import { tabZoom, zoomPatch, type ZoomTab } from "../../app/mapZoom";
import { MAX_MAP_ZOOM, type MapView } from "./MapView";

/**
 * マップの拡大（#316。Q14 の推奨）: Ctrl＋ホイールで 1〜8 倍（マウスの位置を中心に）、中ボタンのドラッグでスクロール。
 * ホイールだけのときは今までどおりスクロールする（AdvanceMap と同じ）。倍率はタブごとに個人設定 `mapZoom` に残す。
 */
export class MapZoomControls {
  private drag: { pointerId: number; x: number; y: number; left: number; top: number } | null = null;

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly tab: ZoomTab,
  ) {
    const el = view.element;
    el.addEventListener(
      "wheel",
      (e) => {
        if (!e.ctrlKey || !state.map) return;
        e.preventDefault();
        e.stopPropagation();
        this.step(e.deltaY < 0 ? 1 : -1, e.clientX, e.clientY);
      },
      { passive: false },
    );
    // 中ボタン: 押している間、動かした分だけスクロールする（描く道具には渡さない）
    el.addEventListener(
      "pointerdown",
      (e) => {
        if (e.button !== 1) return;
        e.preventDefault();
        e.stopPropagation();
        try {
          el.setPointerCapture(e.pointerId);
        } catch {
          /* 自動操作で作ったイベントは捕まえられないことがある */
        }
        this.drag = { pointerId: e.pointerId, x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
        el.style.cursor = "grabbing";
      },
      true,
    );
    el.addEventListener(
      "pointermove",
      (e) => {
        const d = this.drag;
        if (!d || e.pointerId !== d.pointerId) return;
        e.stopPropagation();
        el.scrollLeft = d.left - (e.clientX - d.x);
        el.scrollTop = d.top - (e.clientY - d.y);
      },
      true,
    );
    const end = (e: PointerEvent): void => {
      if (!this.drag || e.pointerId !== this.drag.pointerId) return;
      e.stopPropagation();
      this.drag = null;
      el.style.cursor = "";
    };
    el.addEventListener("pointerup", end, true);
    el.addEventListener("pointercancel", end, true);
    // 中ボタンの自動スクロール（ブラウザの機能）を出さない
    el.addEventListener("mousedown", (e) => {
      if (e.button === 1) e.preventDefault();
    });
    el.addEventListener("auxclick", (e) => {
      if (e.button === 1) e.preventDefault();
    });
  }

  /** 倍率を 1 段変える（`clientX`・`clientY` の下のマスを動かさない）。 */
  step(delta: number, clientX?: number, clientY?: number): void {
    this.setZoom(tabZoom(this.state.settings.data, this.tab) + delta, clientX, clientY);
  }

  /** 倍率を決める。 */
  setZoom(zoom: number, clientX?: number, clientY?: number): void {
    const z = Math.min(MAX_MAP_ZOOM, Math.max(1, Math.round(zoom)));
    if (z === tabZoom(this.state.settings.data, this.tab) && z === this.view.zoom) return;
    this.view.zoomAt(z, clientX, clientY);
    this.state.settings.update(zoomPatch(this.state.settings.data, this.tab, z));
    this.state.emit("view");
  }
}
