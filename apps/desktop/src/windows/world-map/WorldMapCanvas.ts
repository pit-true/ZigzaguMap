import {
  MAPSEC_NONE,
  NO_FLAG,
  REGION_IMAGE_HEIGHT,
  REGION_IMAGE_WIDTH,
  REGION_MAP_CELL_PIXELS,
  REGION_MAP_HEIGHT,
  REGION_MAP_ORIGIN_X,
  REGION_MAP_ORIGIN_Y,
  REGION_MAP_WIDTH,
  RegionMapGraphics,
  type RegionMapDocument,
} from "@zigzagumap/core";

/** 何を重ねて描くか（左下のチェックボックス）。 */
export interface WorldMapOverlay {
  /** エディットレイヤーの表示（地名のあるマスに色を重ねる）。 */
  readonly editLayer: boolean;
  /** フライトポジション/人IDの表示（地名の位置に白い点）。 */
  readonly flyPoints: boolean;
  /** トップレイヤーの座標を読み込む（トップレイヤーのマスも描く）。 */
  readonly topLayer: boolean;
}

/** 選択枠の大きさ（AdvanceMap の Img_Auswahl、16×16 をマスの中心に置く）。 */
const CURSOR = 16;

/**
 * 世界地図（AdvanceMap の WorldmapBox、240×160）。タウンマップの絵の上に、地名のマスと選択枠を描く。
 * 左ボタンで押した・ドラッグして離したマスを選ぶ（AdvanceMap と同じく、ドラッグで区画は動かない）。
 */
export class WorldMapCanvas {
  readonly element: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private graphics: RegionMapGraphics | null = null;
  private readonly pages = new Map<number, ImageData>();
  private dragging = false;

  constructor(private readonly onSelect: (x: number, y: number) => void) {
    const c = document.createElement("canvas");
    c.width = REGION_IMAGE_WIDTH;
    c.height = REGION_IMAGE_HEIGHT;
    c.className = "wm-worldmap";
    c.dataset["autoId"] = "WorldmapBox";
    this.element = c;
    this.ctx = c.getContext("2d")!;
    c.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      c.setPointerCapture?.(e.pointerId);
      this.pick(e);
    });
    c.addEventListener("pointermove", (e) => {
      if (this.dragging) this.pick(e);
    });
    c.addEventListener("pointerup", (e) => {
      if (!this.dragging) return;
      this.dragging = false;
      this.pick(e);
    });
  }

  /** 絵の元データを渡す（面ごとの絵は初めて描くときに作る）。 */
  setGraphics(graphics: RegionMapGraphics): void {
    this.graphics = graphics;
    this.pages.clear();
  }

  /** 描き直す。 */
  draw(doc: RegionMapDocument, page: number, selected: { x: number; y: number } | null, overlay: WorldMapOverlay): void {
    const ctx = this.ctx;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, REGION_IMAGE_WIDTH, REGION_IMAGE_HEIGHT);
    const image = this.pageImage(page);
    if (image) ctx.putImageData(image, 0, 0);
    const px = (x: number) => REGION_MAP_ORIGIN_X + x * REGION_MAP_CELL_PIXELS;
    const py = (y: number) => REGION_MAP_ORIGIN_Y + y * REGION_MAP_CELL_PIXELS;
    if (overlay.editLayer) {
      for (let y = 0; y < REGION_MAP_HEIGHT; y++) {
        for (let x = 0; x < REGION_MAP_WIDTH; x++) {
          const base = doc.cell(page, 0, x, y);
          if (base !== MAPSEC_NONE) {
            const town = (doc.flyDestination(base)?.heal ?? 0) !== 0;
            ctx.fillStyle = town ? "rgba(214, 170, 0, 0.75)" : "rgba(0, 150, 150, 0.6)";
            ctx.fillRect(px(x), py(y), REGION_MAP_CELL_PIXELS, REGION_MAP_CELL_PIXELS);
          }
          if (overlay.topLayer && doc.cell(page, 1, x, y) !== MAPSEC_NONE) {
            ctx.fillStyle = "rgba(150, 210, 0, 0.9)";
            ctx.fillRect(px(x) + 2, py(y) + 2, REGION_MAP_CELL_PIXELS - 4, REGION_MAP_CELL_PIXELS - 4);
          }
        }
      }
    }
    if (overlay.flyPoints) {
      ctx.fillStyle = "#fff";
      const seen = new Set<number>();
      for (let y = 0; y < REGION_MAP_HEIGHT; y++) {
        for (let x = 0; x < REGION_MAP_WIDTH; x++) {
          const id = doc.cell(page, 0, x, y);
          if (id === MAPSEC_NONE || seen.has(id)) continue;
          seen.add(id);
          const fly = doc.flyDestination(id);
          if ((fly?.heal ?? 0) === 0 && doc.flag(0, id) === NO_FLAG) continue;
          const s = doc.section(id);
          if (!s) continue;
          ctx.fillRect(px(s.x) + 3, py(s.y) + 3, 2, 2);
        }
      }
    }
    if (selected) {
      ctx.strokeStyle = "#ff8000";
      ctx.lineWidth = 2;
      const off = (CURSOR - REGION_MAP_CELL_PIXELS) / 2;
      ctx.strokeRect(px(selected.x) - off + 1, py(selected.y) - off + 1, CURSOR - 2, CURSOR - 2);
    }
  }

  /** 描いている絵を PNG の data URL にする（自動操作の canvasPng 用）。 */
  toPng(): string {
    return this.element.toDataURL("image/png");
  }

  private pageImage(page: number): ImageData | null {
    if (!this.graphics) return null;
    let image = this.pages.get(page);
    if (!image) {
      const rgba = this.graphics.render(page);
      image = new ImageData(rgba.data, rgba.width, rgba.height);
      this.pages.set(page, image);
    }
    return image;
  }

  private pick(e: PointerEvent): void {
    const r = this.element.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * REGION_IMAGE_WIDTH) / r.width;
    const sy = ((e.clientY - r.top) * REGION_IMAGE_HEIGHT) / r.height;
    const x = Math.floor((sx - REGION_MAP_ORIGIN_X) / REGION_MAP_CELL_PIXELS);
    const y = Math.floor((sy - REGION_MAP_ORIGIN_Y) / REGION_MAP_CELL_PIXELS);
    // 地名の表の外（原点の左上など）は無視する。
    if (x < 0 || y < 0 || x >= REGION_MAP_WIDTH || y >= REGION_MAP_HEIGHT) return;
    this.onSelect(x, y);
  }
}
