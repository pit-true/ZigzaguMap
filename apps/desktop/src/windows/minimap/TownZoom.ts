import {
  REGION_MAP_CELL_PIXELS,
  REGION_MAP_ORIGIN_X,
  REGION_MAP_ORIGIN_Y,
  RegionMapProject,
  regionZoomArea,
  townMapKey,
  type RegionZoomArea,
  type RegionMapDocument,
  type RegionMapGraphics,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaMinimap as t } from "../../i18n/ja.minimap";
import { jaTownMini } from "../../i18n/ja.townMini";
import { scheduleIdleGc } from "../../util/idleGc";
import { canvasOf } from "../../ui/canvas";
import { TownLinkStore } from "../../ui/view/TownLinkStore";
import { findTownFrame, type TownFrame } from "../../ui/view/townFrame";
import { rgbaOf } from "./rgba";
import type { MinimapTown } from "./protocol";

/** 枠の色（タウンマップのウィンドウと同じ。ROM のデータは赤、自分で紐づけたものは水色）。 */
const ROM_COLOR = "#ff0000";
const LINK_COLOR = "#00e0ff";
/** ウィンドウから大きさが届くまでの、拡大を出せる大きさ（画素）。 */
export const TOWN_DEFAULT_AREA = { width: 232, height: 170 } as const;

/** 自動操作の `minimap.state` の `town`。 */
export interface TownZoomState {
  readonly loaded: boolean;
  readonly frame: TownFrame | null;
  readonly area: RegionZoomArea | null;
  readonly text: string;
}

/**
 * ミニマップの、タウンマップの現在地のまわりの拡大（Phase7 #511 の追加の要望。#542 から別ウィンドウへ送る絵をメインで作る）。
 * タウンマップの絵と位置は、タウンマップのウィンドウ（#306・#386）と同じ読み方（core の RegionMapProject と、紐づけの TownLinkStore・findTownFrame）。
 * 出している間だけ絵を持ち、隠したら捨てる。
 */
export class TownZoom {
  private readonly ownStore: TownLinkStore;
  private data: { document: RegionMapDocument; graphics: RegionMapGraphics } | null = null;
  private loading: Promise<void> | null = null;
  /** 描いた面の絵（面の番号と Canvas）。 */
  private pageImage: { page: number; canvas: HTMLCanvasElement } | null = null;
  private last: TownZoomState = { loaded: false, frame: null, area: null, text: "" };
  private error: string | null = null;
  /** 拡大を出せる大きさ（画素。ウィンドウから届く）。 */
  private avail: { width: number; height: number } = { ...TOWN_DEFAULT_AREA };

  constructor(
    private readonly state: EditorState,
    private readonly regionName: (region: number) => string | null,
    /** タウンマップのウィンドウの紐づけ（作っていれば。そのウィンドウで紐づけを変えたらすぐ同じものを使う）。 */
    private readonly sharedStore: () => TownLinkStore | null = () => null,
  ) {
    this.ownStore = new TownLinkStore(state);
  }

  private get store(): TownLinkStore {
    return this.sharedStore() ?? this.ownStore;
  }

  /** 自動操作用。 */
  snapshot(): TownZoomState {
    return this.last;
  }

  /** 読み込み（まだなら）と紐づけの読み込みを待ってから描く。 */
  async refresh(): Promise<MinimapTown> {
    await Promise.all([this.load(), this.store.load()]);
    return this.draw();
  }

  /** ROM を開き直した（読んだものを捨てる）。 */
  reset(): void {
    this.data = null;
    this.error = null;
    this.dropPage();
  }

  /** 捨てる（隠したとき・ミニマップを閉じたとき）。 */
  dispose(): void {
    this.reset();
    scheduleIdleGc(true);
  }

  private dropPage(): void {
    if (this.pageImage) this.pageImage.canvas.width = this.pageImage.canvas.height = 0;
    this.pageImage = null;
  }

  private document(): RegionMapDocument | null {
    return this.state.session?.regionMap?.document ?? this.data?.document ?? null;
  }

  private graphics(): RegionMapGraphics | null {
    return this.state.session?.regionMap?.graphics ?? this.data?.graphics ?? null;
  }

  private async load(): Promise<void> {
    const session = this.state.session;
    if (!session || this.data || session.regionMap) return;
    this.loading ??= (async () => {
      try {
        const p = await RegionMapProject.open(session.project.rom, session.project.game.code, session.projectDir ? session.files : null, null);
        if (this.state.session === session) this.data = { document: p.document, graphics: p.graphics };
      } catch (e) {
        this.error = e instanceof Error ? e.message : String(e);
      } finally {
        this.loading = null;
      }
    })();
    await this.loading;
  }

  /** 拡大を出せる大きさ（画素）を変える。変わったら true。 */
  setAvailable(width: number, height: number): boolean {
    const w = Math.max(16, Math.floor(width));
    const h = Math.max(16, Math.floor(height));
    if (w === this.avail.width && h === this.avail.height) return false;
    this.avail = { width: w, height: h };
    return true;
  }

  /** 今のマップの位置のまわりを描く（絵は送るための RGBA。場所が無ければ null）。 */
  draw(): MinimapTown {
    this.update();
    return this.image();
  }

  /**
   * 今の場所と出す範囲を求め直す（絵は描かない）。返す文字列は、場所・範囲・文字が同じなら同じ（変わったときだけ描いて送るため）。
   * ワールドマップエディターで編集中の内容（`session.regionMap`）があればそれを使う。
   */
  update(): string {
    const map = this.state.map;
    const doc = this.document();
    const graphics = this.graphics();
    const region = map?.doc.header.regionMapSectionId ?? null;
    const frame = map && doc ? findTownFrame(this.store.links, townMapKey(map.id.bank, map.id.map), region, doc) : null;
    let text: string;
    let area: RegionZoomArea | null = null;
    if (this.error !== null) text = jaTownMini.failed(this.error);
    else if (!doc || !graphics) text = jaTownMini.loading;
    else if (!map) text = jaTownMini.none;
    else if (!frame) text = t.townNone;
    else {
      area = regionZoomArea(frame.rect, this.avail.width, this.avail.height);
      text = t.townPlace(region, region !== null ? this.regionName(region) : null, frame.source !== "rom");
    }
    this.last = { loaded: doc !== null, frame, area, text };
    return JSON.stringify([area, frame, text, graphics !== null]);
  }

  /** `update` で求めた範囲を描く。 */
  image(): MinimapTown {
    const { area, frame, text } = this.last;
    const graphics = this.graphics();
    if (!area || !frame || !graphics) return { image: null, text };
    if (this.pageImage?.page !== area.page) {
      this.dropPage();
      this.pageImage = { page: area.page, canvas: canvasOf(graphics.render(area.page)) };
    }
    const cell = REGION_MAP_CELL_PIXELS;
    const k = area.scale;
    const canvas = document.createElement("canvas");
    canvas.width = area.width * cell * k;
    canvas.height = area.height * cell * k;
    const c = canvas.getContext("2d")!;
    c.imageSmoothingEnabled = false;
    c.drawImage(
      this.pageImage.canvas,
      REGION_MAP_ORIGIN_X + area.x * cell,
      REGION_MAP_ORIGIN_Y + area.y * cell,
      area.width * cell,
      area.height * cell,
      0,
      0,
      canvas.width,
      canvas.height,
    );
    const r = frame.rect;
    const px = (r.x - area.x) * cell * k;
    const py = (r.y - area.y) * cell * k;
    const pw = r.width * cell * k;
    const ph = r.height * cell * k;
    const linked = frame.source !== "rom";
    if (linked) {
      c.strokeStyle = "#000";
      c.lineWidth = 5;
      c.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
    }
    c.strokeStyle = linked ? LINK_COLOR : ROM_COLOR;
    c.lineWidth = 3;
    c.strokeRect(px + 1.5, py + 1.5, pw - 3, ph - 3);
    const image = rgbaOf(c.getImageData(0, 0, canvas.width, canvas.height));
    canvas.width = canvas.height = 0;
    return { image, text };
  }
}
