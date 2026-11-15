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
  isTownLinkRect,
  townMapKey,
  type RegionMapDocument,
  type RegionMapGraphics,
  type TownLinkRect,
  type TownLinks,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaTownMini as t } from "../../i18n/ja.townMini";
import "../../styles/townMini.css";
import { scheduleIdleGc } from "../../util/idleGc";
import { toImageData } from "../canvas";
import { showContextMenu, type ContextMenuItem } from "../ContextMenu";
import { createDialog, type DialogFrame } from "../Dialog";
import { TownLinkStore, type TownLinkPlace } from "./TownLinkStore";

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

/** マスの範囲（タウンマップの座標）。 */
export interface TownArea {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 今のマップの地名を囲む枠の色（ROM のデータ）。 */
const FRAME_COLOR = "#ff0000";
/** 自分で紐づけた枠の色（ROM のデータの赤と見分ける。黒い縁取りを付け、明るい地図の上でも見えるようにする）。 */
const LINK_COLOR = "#00e0ff";

/** 枠をどこから出したか（`map` = マップ単位の紐づけ、`section` = 地名の紐づけ、`rom` = ROM のデータ）。 */
export type TownFrameSource = "map" | "section" | "rom";

/** 紐づけの単位（`section` = 地名、`map` = 今のマップだけ）。 */
export type TownLinkScope = "section" | "map";

/** 今のマップの位置（面とマス）と、どこから出したか。 */
export interface TownFrame {
  readonly rect: TownLinkRect;
  readonly source: TownFrameSource;
}

/**
 * タウンマップの小窓（#306。Bochi の TownMap）。メインの画面に浮かぶ小さな窓に、タウンマップを縮小して出し、
 * 今のマップの地名の位置を赤い枠で囲む。マスにマウスを乗せると地名を出し、押すと一覧をその地名で絞る。
 * - 位置は自分でも決められる（#386）。右クリック・右ドラッグのメニューで、今の地名か今のマップをそのマスに紐づける。
 *   引く順は「マップ単位の紐づけ → 地名の紐づけ → ROM のデータ」。紐づけは ZigzaguMap の画面でだけ使い、
 *   ROM・maps\regionmap.json・ワールドマップエディタの中身には入れない（保存は TownLinkStore）。
 * - 絵とデータは、ワールドマップエディタと同じ core の `regionmap` から読む。ワールドマップエディタで読み込み済みなら
 *   そちら（編集中の中身）を使い、そうでなければ小窓を出したときに初めて読み込み、隠したら捨てる（メモリを残さない）。
 * - タウンマップの中身は閲覧だけ（編集はワールドマップエディタで行う）。
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
  /** 紐づけの読み書き。 */
  readonly store: TownLinkStore;
  /** 右ドラッグで選んでいる範囲の始まりと今のマス（ドラッグしていなければ null）。 */
  private drag: { start: { x: number; y: number }; end: { x: number; y: number } } | null = null;
  /** 右クリックのメニューを出している間の、選んだ範囲（描くため）。 */
  private menuArea: TownArea | null = null;
  /** 右ボタンを離したときの範囲（続く contextmenu でメニューを出すまで）。 */
  private released: TownArea | null = null;
  /** この時刻までの contextmenu は無視する（離したときにメニューを出したあとの重複を防ぐ）。 */
  private quietUntil = 0;

  constructor(
    private readonly state: EditorState,
    private readonly host: TownMiniHost,
  ) {
    this.store = new TownLinkStore(state);
    state.on("map", () => this.follow());
    state.on("session", () => {
      this.release();
      if (this.isOpen) void this.open();
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

  /** 今の紐づけ。 */
  get links(): TownLinks {
    return this.store.links;
  }

  /** 紐づけの保存先（ROM を開いていなければ null）。 */
  get linkPlace(): TownLinkPlace | null {
    return this.store.place;
  }

  /** 選んでいる範囲（右ドラッグ中か、メニューを出している間。無ければ null。自動操作用）。 */
  get selection(): TownArea | null {
    const d = this.drag;
    return d ? areaOf(d.start, d.end) : this.menuArea;
  }

  /** 今のマップ（バンク.マップの鍵。開いていなければ null）。 */
  private get mapKey(): string | null {
    const id = this.state.map?.id;
    return id ? townMapKey(id.bank, id.map) : null;
  }

  /** 今のマップの地名のうち、紐づけに使えるもの（無い・「無し」なら null）。 */
  private get linkRegion(): number | null {
    const region = this.currentRegion;
    return region === null || region === MAPSEC_NONE ? null : region;
  }

  /** 今のマップの位置（面は問わない）。マップ単位の紐づけ → 地名の紐づけ → ROM のデータ の順に引き、どれにも無ければ null。 */
  currentFrame(): TownFrame | null {
    const key = this.mapKey;
    const byMap = key !== null ? this.store.links.maps.get(key) : undefined;
    if (byMap) return { rect: byMap, source: "map" };
    const region = this.linkRegion;
    if (region === null) return null;
    const bySection = this.store.links.sections.get(region);
    if (bySection) return { rect: bySection, source: "section" };
    const doc = this.document();
    const at = doc?.find(region);
    if (!doc || !at) return null;
    const s = doc.section(region);
    const size = s && s.width > 0 && s.height > 0 ? { x: s.x, y: s.y, width: s.width, height: s.height } : { x: at.x, y: at.y, width: 1, height: 1 };
    return { rect: { page: at.page, ...size }, source: "rom" };
  }

  /** 今のマップの枠（タウンマップのマス。面が違うか、どこにも無ければ null）。 */
  frameRect(): { x: number; y: number; width: number; height: number } | null {
    const f = this.currentFrame();
    if (!f || f.rect.page !== this.page) return null;
    return { x: f.rect.x, y: f.rect.y, width: f.rect.width, height: f.rect.height };
  }

  /**
   * 今の地名（`section`）か今のマップ（`map`）を範囲に紐づけ、すぐ保存する（取り消しの対象にしない）。`page` を省くと今の面。
   * 保存できなければ例外。
   */
  async link(scope: TownLinkScope, area: TownArea & { page?: number }): Promise<void> {
    await this.store.load();
    const rect: TownLinkRect = { page: area.page ?? this.page, x: area.x, y: area.y, width: area.width, height: area.height };
    if (!isTownLinkRect(rect)) throw new Error(`範囲がタウンマップの外です: ${JSON.stringify(rect)}`);
    const links = this.store.links;
    let next: TownLinks;
    let what: string;
    if (scope === "section") {
      const region = this.linkRegion;
      if (region === null) throw new Error("今のマップに地名がありません");
      next = { sections: new Map(links.sections).set(region, rect), maps: links.maps };
      what = t.whatSection(region, this.host.regionName(region));
    } else {
      const id = this.state.map?.id;
      if (!id) throw new Error("マップを開いていません");
      next = { sections: links.sections, maps: new Map(links.maps).set(townMapKey(id.bank, id.map), rect) };
      what = t.whatMap(id.bank, id.map);
    }
    await this.saveLinks(next);
    this.state.setStatus(t.linked(what, rect.page, rect.x, rect.y, rect.width, rect.height));
    this.follow();
  }

  /** 今の地名（`section`）か今のマップ（`map`）の紐づけを外し、すぐ保存する。外したかを返す（無ければ false）。 */
  async unlink(scope: TownLinkScope): Promise<boolean> {
    await this.store.load();
    const links = this.store.links;
    let next: TownLinks;
    let what: string;
    if (scope === "section") {
      const region = this.linkRegion;
      if (region === null || !links.sections.has(region)) return false;
      const sections = new Map(links.sections);
      sections.delete(region);
      next = { sections, maps: links.maps };
      what = t.whatSection(region, this.host.regionName(region));
    } else {
      const id = this.state.map?.id;
      const key = this.mapKey;
      if (!id || key === null || !links.maps.has(key)) return false;
      const maps = new Map(links.maps);
      maps.delete(key);
      next = { sections: links.sections, maps };
      what = t.whatMap(id.bank, id.map);
    }
    await this.saveLinks(next);
    this.state.setStatus(t.unlinked(what));
    this.follow();
    return true;
  }

  /** 保存する（できなければステータスバーに出して例外）。 */
  private async saveLinks(next: TownLinks): Promise<void> {
    try {
      await this.store.save(next);
    } catch (e) {
      const message = t.saveFailed(e instanceof Error ? e.message : String(e));
      this.state.setStatus(message, undefined, true);
      throw new Error(message);
    }
  }

  /** 右クリックのメニューの項目（範囲 `area` に紐づける・外す。外す項目は紐づけがあるときだけ）。 */
  menuItems(area: TownArea): ContextMenuItem[] {
    const region = this.linkRegion;
    const name = region !== null ? this.host.regionName(region) : null;
    const hasMap = this.state.map !== null;
    const run = (p: Promise<unknown>): void => void p.catch(() => undefined);
    const items: ContextMenuItem[] = [
      {
        id: "town.linkSection",
        label: region !== null ? t.linkSection(region, name) : t.linkSectionNone,
        enabled: hasMap && region !== null,
        run: () => run(this.link("section", area)),
      },
      { id: "town.linkMap", label: t.linkMap, enabled: hasMap, run: () => run(this.link("map", area)) },
    ];
    const key = this.mapKey;
    if (key !== null && this.store.links.maps.has(key)) items.push({ id: "town.unlinkMap", label: t.unlinkMap, run: () => run(this.unlink("map")) });
    if (region !== null && this.store.links.sections.has(region)) {
      items.push({ id: "town.unlinkSection", label: t.unlinkSection(region, name), run: () => run(this.unlink("section")) });
    }
    return items;
  }

  /** 出す（読み込みを待つ）。 */
  async open(): Promise<void> {
    if (!this.frame) this.build();
    await Promise.all([this.load(), this.store.load()]);
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
    this.drag = null;
    this.menuArea = null;
    this.release();
  }

  /** 読み込み終えるまで待つ（自動操作用）。 */
  async settle(): Promise<void> {
    await Promise.all([this.loading, this.store.load()]);
  }

  /** 面を選ぶ。 */
  showPage(page: number): void {
    this.page = Math.min(REGION_MAP_PAGES.length - 1, Math.max(0, page));
    if (this.pageSelect) this.pageSelect.value = String(this.page);
    this.draw();
  }

  /** 面のマス（タウンマップの座標）の地名（無ければ null）。自分で紐づけた地名を ROM のデータより先に引く。 */
  regionAt(x: number, y: number): number | null {
    const doc = this.document();
    if (!doc || x < 0 || y < 0 || x >= REGION_MAP_WIDTH || y >= REGION_MAP_HEIGHT) return null;
    // 重なっていれば小さい範囲
    let best: { id: number; size: number } | null = null;
    for (const [id, r] of this.store.links.sections) {
      if (r.page !== this.page || x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height) continue;
      const size = r.width * r.height;
      if (!best || size < best.size) best = { id, size };
    }
    if (best) return best.id;
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
    // 右ボタン: 押して動かすと範囲を選び、離すと紐づけのメニューを出す。動かさなければ 1 マス
    canvas.addEventListener("pointerdown", (e) => {
      if (e.button !== 2) return;
      const c = this.cellOf(e);
      if (!c) return;
      this.drag = { start: c, end: c };
      try {
        // 小窓の外へ出ても離すまで追う（自動操作の送るイベントでは捕まえられないので、失敗しても続ける）
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // 何もしない
      }
      this.draw();
    });
    canvas.addEventListener("pointermove", (e) => {
      if (!this.drag || (e.buttons & 2) === 0) return;
      const c = this.cellOf(e, true);
      if (c && (c.x !== this.drag.end.x || c.y !== this.drag.end.y)) {
        this.drag.end = c;
        this.draw();
      }
    });
    canvas.addEventListener("pointerup", (e) => {
      if (e.button !== 2 || !this.drag) return;
      const d = this.drag;
      this.drag = null;
      const area = areaOf(d.start, this.cellOf(e, true) ?? d.end);
      const at = { x: e.clientX, y: e.clientY };
      this.released = area;
      // ふつうはこのあと contextmenu が来てメニューを出す。来なければ（小窓の外で離したなど）ここで出す
      setTimeout(() => {
        if (this.released !== area) return;
        this.released = null;
        this.quietUntil = performance.now() + 500;
        this.showMenu(area, at.x, at.y);
      }, 0);
    });
    canvas.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      const released = this.released;
      this.released = null;
      if (released) return this.showMenu(released, e.clientX, e.clientY);
      if (performance.now() < this.quietUntil) return;
      const c = this.cellOf(e);
      if (c) this.showMenu(areaOf(c, c), e.clientX, e.clientY);
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

  /** 右ボタンを離した: 選んだ範囲（ドラッグしていなければその 1 マス）の紐づけのメニューを出す。 */
  private showMenu(area: TownArea, clientX: number, clientY: number): void {
    this.menuArea = area;
    this.draw();
    const menu = showContextMenu(clientX, clientY, this.menuItems(area));
    // メニューを閉じたら選んだ範囲の点線を消す
    const close = menu.close.bind(menu);
    (menu as { close: () => void }).close = () => {
      close();
      if (this.menuArea === area) this.menuArea = null;
      this.draw();
    };
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

  /** 今のマップの位置がある面に切り替えて描く。 */
  private follow(): void {
    if (!this.frame) return;
    const f = this.currentFrame();
    if (f && f.rect.page !== this.page) return this.showPage(f.rect.page);
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
    const f = this.currentFrame();
    if (f && f.rect.page === this.page) strokeCells(c, f.rect, f.source === "rom" ? FRAME_COLOR : LINK_COLOR, f.source !== "rom");
    // 右ドラッグで選んでいる範囲（メニューを出している間も）。白と黒の点線
    const area = this.selection;
    if (area) {
      const p = cellPixels(area);
      c.save();
      c.lineWidth = 1;
      c.setLineDash([2, 2]);
      c.strokeStyle = "#000";
      c.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      c.lineDashOffset = 2;
      c.strokeStyle = "#fff";
      c.strokeRect(p.x + 0.5, p.y + 0.5, p.w - 1, p.h - 1);
      c.restore();
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

  /** マウスの下のマス（表の外なら null。`clamp` なら表の端に寄せる。右ドラッグ用）。 */
  private cellOf(e: MouseEvent, clamp = false): { x: number; y: number } | null {
    const canvas = this.canvas;
    if (!canvas) return null;
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) * REGION_IMAGE_WIDTH) / r.width;
    const sy = ((e.clientY - r.top) * REGION_IMAGE_HEIGHT) / r.height;
    const x = Math.floor((sx - REGION_MAP_ORIGIN_X) / REGION_MAP_CELL_PIXELS);
    const y = Math.floor((sy - REGION_MAP_ORIGIN_Y) / REGION_MAP_CELL_PIXELS);
    if (clamp) return { x: Math.min(REGION_MAP_WIDTH - 1, Math.max(0, x)), y: Math.min(REGION_MAP_HEIGHT - 1, Math.max(0, y)) };
    return x >= 0 && y >= 0 && x < REGION_MAP_WIDTH && y < REGION_MAP_HEIGHT ? { x, y } : null;
  }

  private hover(cell: { x: number; y: number } | null): void {
    this.hovered = cell ? this.regionAt(cell.x, cell.y) : null;
    if (this.canvas) this.canvas.style.cursor = this.hovered !== null ? "pointer" : "";
    this.showLabel();
  }

  /** 下の欄: マウスの下の地名か、今のマップの地名と枠をどこから出したか（どこにも無ければ紐づけの案内）。 */
  private showLabel(): void {
    const label = this.label;
    if (!label) return;
    if (!this.document()) {
      if (!label.textContent) label.textContent = t.loading;
      return;
    }
    const region = this.linkRegion;
    const name = region !== null ? this.host.regionName(region) : null;
    let source: TownFrameSource | null = null;
    let text: string;
    if (this.hovered !== null) text = t.hover(this.hovered, this.host.regionName(this.hovered));
    else if (!this.state.map) text = t.none;
    else {
      const f = this.currentFrame();
      source = f?.source ?? null;
      text = !f ? t.noLink(region, name) : t.current(region, name, f.source === "map" ? t.sourceMap : f.source === "section" ? t.sourceSection : t.sourceRom);
    }
    // 先頭の印は枠と同じ色（ROM のデータは赤、自分で紐づけたものは水色）
    const swatch = document.createElement("span");
    swatch.className = "town-mini-swatch";
    if (source) swatch.dataset["source"] = source;
    else swatch.hidden = true;
    label.replaceChildren(swatch, text);
    label.dataset["source"] = source ?? "";
  }
}

/** 2 つのマスを角にした範囲。 */
function areaOf(a: { x: number; y: number }, b: { x: number; y: number }): TownArea {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x) + 1, height: Math.abs(b.y - a.y) + 1 };
}

/** マスの範囲（タウンマップの座標）の、絵の上の画素。 */
function cellPixels(r: TownArea): { x: number; y: number; w: number; h: number } {
  return {
    x: REGION_MAP_ORIGIN_X + r.x * REGION_MAP_CELL_PIXELS,
    y: REGION_MAP_ORIGIN_Y + r.y * REGION_MAP_CELL_PIXELS,
    w: r.width * REGION_MAP_CELL_PIXELS,
    h: r.height * REGION_MAP_CELL_PIXELS,
  };
}

/** 枠を描く。`linked`（自分で紐づけた）なら黒い縁取りと、左上の外側に小さな三角の印も付ける。 */
function strokeCells(c: CanvasRenderingContext2D, r: TownArea, color: string, linked: boolean): void {
  const p = cellPixels(r);
  if (linked) {
    c.strokeStyle = "#000";
    c.lineWidth = 4;
    c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
  }
  c.strokeStyle = color;
  c.lineWidth = 2;
  c.strokeRect(p.x + 1, p.y + 1, p.w - 2, p.h - 2);
  if (!linked) return;
  c.beginPath();
  c.moveTo(p.x - 4, p.y - 4);
  c.lineTo(p.x + 5, p.y - 4);
  c.lineTo(p.x - 4, p.y + 5);
  c.closePath();
  c.fillStyle = color;
  c.fill();
  c.strokeStyle = "#000";
  c.lineWidth = 1;
  c.stroke();
}
