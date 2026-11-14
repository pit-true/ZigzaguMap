import type { MapView } from "../ui/map/MapView";

/**
 * ドラッグ中の下見を描く Canvas（ステージ全体を覆う。隣のマップの帯の上にも描ける。Phase3 #233・#234）。
 * ドラッグの間だけ置き、終わったら外す。重ね描きの Canvas（Ctrl を押している間は隠れる）とは別に置く。
 */
export class PreviewCanvas {
  private canvas: HTMLCanvasElement | null = null;

  constructor(private readonly view: MapView) {}

  /** 描く入口と、主マップの左上の位置（表示上の画素）。前に描いたものは消す。 */
  begin(): { c: CanvasRenderingContext2D; ox: number; oy: number; size: number } {
    const stage = this.view.stage;
    const width = Math.round(parseFloat(stage.style.width) || 0);
    const height = Math.round(parseFloat(stage.style.height) || 0);
    let canvas = this.canvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "map-preview";
      canvas.style.left = "0px";
      canvas.style.top = "0px";
      canvas.style.pointerEvents = "none";
      stage.append(canvas);
      this.canvas = canvas;
    }
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
    }
    const c = canvas.getContext("2d")!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const o = this.view.originPx;
    return { c, ox: o.x, oy: o.y, size: this.view.cellSize };
  }

  /** 外す。 */
  end(): void {
    this.canvas?.remove();
    this.canvas = null;
  }
}
