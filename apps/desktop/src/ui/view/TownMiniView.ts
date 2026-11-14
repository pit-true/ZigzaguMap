import {
  MAPSEC_NONE,
  REGION_IMAGE_HEIGHT,
  REGION_IMAGE_WIDTH,
  REGION_MAP_CELL_PIXELS,
  REGION_MAP_HEIGHT,
  REGION_MAP_ORIGIN_X,
  REGION_MAP_ORIGIN_Y,
  REGION_MAP_PAGES,
  REGION_MAP_WIDTH,
  RegionMapProject,
  type RegionMapDocument,
  type RegionMapGraphics,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaTownMini as t } from "../../i18n/ja.townMini";
import "../../styles/townMini.css";
import { scheduleIdleGc } from "../../util/idleGc";
import { toImageData } from "../canvas";
import { createDialog, type DialogFrame } from "../Dialog";

/** タウンマップの読み込み結果（小窓を出している間だけ持つ）。 */
interface TownData {
  readonly document: RegionMapDocument;
  readonly graphics: RegionMapGraphics;
}

/** 小窓の外の機能（App が渡す）。 */
export interface TownMiniHost {
  /** マスを押したとき: 一覧をその地名で絞る（#305 の「場所:58」）。 */
  filterByRegion(region: number): void;
  /** 地名の番号から名前（無ければ null）。 */
  regionName(region: number): string | null;
  /** 小窓を閉じた（× で閉じたとき、表示メニューのチェックも外す）。 */
  closed(): void;
}

/** 今のマップの地名を囲む枠の色。 */
const FRAME_COLOR = "#ff0000";

/**
 * タウンマップの小窓（#306。Bochi の TownMap）。メインの画面に浮かぶ小さな窓に、タウンマップを縮小して出し、
 * 今のマップの地名の位置を赤い枠で囲む。マスにマウスを乗せると地名を出し、押すと一覧をその地名で絞る。
 * - 絵とデータは、ワールドマップエディタと同じ core の `regionmap` から読む。ワールドマップエディタで読み込み済みなら
 *   そちら（編集中の中身）を使い、そうでなければ小窓を出したときに初めて読み込み、隠したら捨てる（メモリを残さない）。
 * - 閲覧だけ（編集はワールドマップエディタで行う）。
 */
export class TownMiniView {
  private frame: DialogFrame | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private label: HTMLElement | null = null;
  private pageSelect: HTMLSelectElement | null = null;
  private data: TownData | null = null;
  private loading: Promise<void> | null = null;
  private readonly pages = new Map<number, ImageData>();
  private page = 0;
  /** マウスを乗せているマスの地名（無ければ null）。 */
  hovered: number | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly host: TownMiniHost,
  ) {
    state.on("map", () => this.follow());
    state.on("session", () => {
      this.release();
      if (this.isOpen) void this.load();
    });
  }

  /** 出しているか。 */
  get isOpen(): boolean {
    return this.frame !== null;
  }

  /** 今の面（0〜3）。 */
  get currentPage(): number {
    return this.page;
  }

  /** 読み込み済みか。 */
  get loaded(): boolean {
    return this.data !== null;
  }

  /** 今のマップの地名（無ければ null）。 */
  get currentRegion(): number | null {
    return this.state.map?.doc.header.regionMapSectionId ?? null;
  }

  /** 今のマップの地名の枠（タウンマップのマス。面が違うか、置かれていなければ null）。 */
  frameRect(): { x: number; y: number; width: number; height: number } | null {
    const doc = this.document();
    const region = this.currentRegion;
    if (!doc || region === null || region === MAPSEC_NONE) return null;
    const at = doc.find(region);
    if (!at || at.page !== this.page) return null;
    const s = doc.section(region);
    return s && s.width > 0 && s.height > 0 ? { x: s.x, y: s.y, width: s.width, height: s.height } : { x: at.x, y: at.y, width: 1, height: 1 };
  }

  /** 出す（読み込みを待つ）。 */
  async open(): Promise<void> {
    if (!this.frame) this.build();
    await this.load();
    this.follow();
  }

  /** 隠す（読み込んだものを捨てる）。 */
  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.canvas = null;
    this.label = null;
    this.pageSelect = null;
    this.hovered = null;
    this.release();
  }

  /** 読み込み終えるまで待つ（自動操作用）。 */
  async settle(): Promise<void> {
    await this.loading;
  }

  /** 面を選ぶ。 */
  showPage(page: number): void {
    this.page = Math.min(REGION_MAP_PAGES.length - 1, Math.max(0, page));
    if (this.pageSelect) this.pageSelect.value = String(this.page);
    this.draw();
  }

  /** 面のマス（タウンマップの座標）の地名（無ければ null）。 */
  regionAt(x: number, y: number): number | null {
    const doc = this.document();
    if (!doc || x < 0 || y < 0 || x >= REGION_MAP_WIDTH || y >= REGION_MAP_HEIGHT) return null;
    const id = doc.cell(this.page, 0, x, y);
    return id === MAPSEC_NONE ? null : id;
  }

  /** マスを押したのと同じ（地名があれば一覧を絞る）。 */
  pick(x: number, y: number): number | null {
    const id = this.regionAt(x, y);
    if (id !== null) this.host.filterByRegion(id);
    return id;
  }

  /** 描いている絵（自動操作の canvasPng 用）。 */
  toPng(): string | null {
    return this.canvas?.toDataURL("image/png") ?? null;
  }

  private build(): void {
    const frame = createDialog({ title: t.title, modal: false, className: "town-mini", onClose: () => this.closeByUser() });
    frame.box.style.right = "24px";
    frame.box.style.bottom = "40px";
    frame.box.dataset["autoId"] = "town";
    const select = document.createElement("select");
    select.dataset["autoId"] = "town.page";
    t.pages.forEach((name, i) => select.append(new Option(name, String(i))));
    select.addEventListener("change", () => this.showPage(Number(select.value)));
    const canvas = document.createElement("canvas");
    canvas.width = REGION_IMAGE_WIDTH;
    canvas.height = REGION_IMAGE_HEIGHT;
    canvas.className = "town-mini-canvas";
    canvas.dataset["autoId"] = "town.canvas";
    canvas.addEventListener("mousemove", (e) => this.hover(this.cellOf(e)));
    canvas.addEventListener("mouseleave", () => this.hover(null));
    canvas.addEventListener("click", (e) => {
      const c = this.cellOf(e);
      if (c) this.pick(c.x, c.y);
    });
    const label = document.createElement("div");
    label.className = "town-mini-label";
    label.dataset["autoId"] = "town.label";
    frame.body.append(select, canvas, label);
    this.frame = frame;
    this.canvas = canvas;
    this.label = label;
    this.pageSelect = select;
    this.showLabel();
  }

  private closeByUser(): void {
    this.close();
    this.host.closed();
  }

  private document(): RegionMapDocument | null {
    // ワールドマップエディタで読み込み済みなら、編集中の中身を使う
    return this.state.session?.regionMap?.document ?? this.data?.document ?? null;
  }

  private async load(): Promise<void> {
    const session = this.state.session;
    if (!session || this.data) return;
    if (session.regionMap) {
      this.data = { document: session.regionMap.document, graphics: session.regionMap.graphics };
      this.draw();
      return;
    }
    this.loading ??= (async () => {
      try {
        // 飛び先の表はつながない（読むだけ。ワールドマップエディタの読み込みとは別のもの）
        const p = await RegionMapProject.open(session.project.rom, session.project.game.code, session.projectDir ? session.files : null, null);
        if (this.state.session === session && this.frame) this.data = { document: p.document, graphics: p.graphics };
      } catch (e) {
        if (this.label) this.label.textContent = t.failed(e instanceof Error ? e.message : String(e));
      } finally {
        this.loading = null;
      }
      this.draw();
    })();
    await this.loading;
  }

  private release(): void {
    if (!this.data && this.pages.size === 0) return;
    this.data = null;
    this.pages.clear();
    scheduleIdleGc(true);
  }

  /** 今のマップの地名がある面に切り替えて描く。 */
  private follow(): void {
    if (!this.frame) return;
    const doc = this.document();
    const region = this.currentRegion;
    const at = doc && region !== null ? doc.find(region) : null;
    if (at && at.page !== this.page) return this.showPage(at.page);
    this.draw();
  }

  private draw(): void {
    const canvas = this.canvas;
    if (!canvas) return;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "#000";
    c.fillRect(0, 0, canvas.width, canvas.height);
    const image = this.pageImage();
    if (image) c.putImageData(image, 0, 0);
    const r = this.frameRect();
    if (r) {
      c.strokeStyle = FRAME_COLOR;
      c.lineWidth = 2;
      c.strokeRect(REGION_MAP_ORIGIN_X + r.x * REGION_MAP_CELL_PIXELS + 1, REGION_MAP_ORIGIN_Y + r.y * REGION_MAP_CELL_PIXELS + 1, r.width * REGION_MAP_CELL_PIXELS - 2, r.height * REGION_MAP_CELL_PIXELS - 2);
    }
    this.showLabel();
  }

  private pageImage(): ImageData | null {
    const graphics = this.state.session?.regionMap?.graphics ?? this.data?.graphics;
    if (!graphics) return null;
    let image = this.pages.get(this.page);
    if (!image) {
      image = toImageData(graphics.render(this.page));
      this.pages.set(this.page, image);
    }
    return image;
  }

  private cellOf(e: MouseEvent): { x: number; y: number } | null {
    const canvas = this.canvas;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * REGION_IMAGE_WIDTH) / r.width;
    const sy = ((e.clientY - r.top) * REGION_IMAGE_HEIGHT) / r.height;
    const x = Math.floor((sx - REGION_MAP_ORIGIN_X) / REGION_MAP_CELL_PIXELS);
    const y = Math.floor((sy - REGION_MAP_ORIGIN_Y) / REGION_MAP_CELL_PIXELS);
    return x >= 0 && y >= 0 && x < REGION_MAP_WIDTH && y < REGION_MAP_HEIGHT ? { x, y } : null;
  }

  private hover(cell: { x: number; y: number } | null): void {
    this.hovered = cell ? this.regionAt(cell.x, cell.y) : null;
    if (this.canvas) this.canvas.style.cursor = this.hovered !== null ? "pointer" : "";
    this.showLabel();
  }

  /** 下の欄: マウスの下の地名か、今のマップの地名。 */
  private showLabel(): void {
    const label = this.label;
    if (!label) return;
    if (!this.document()) {
      if (!label.textContent) label.textContent = t.loading;
      return;
    }
    const id = this.hovered ?? this.currentRegion;
    const name = id !== null && id !== MAPSEC_NONE ? this.host.regionName(id) : null;
    if (this.hovered !== null) label.textContent = t.hover(this.hovered, name);
    else if (id !== null && id !== MAPSEC_NONE && !this.frameRect() && !this.document()?.find(id)) label.textContent = t.notPlaced(id, name);
    else label.textContent = id !== null && id !== MAPSEC_NONE ? t.current(id, name) : t.none;
  }
}
