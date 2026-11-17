import {
  REGION_MAP_CELL_PIXELS,
  REGION_MAP_HEIGHT,
  REGION_MAP_ORIGIN_X,
  REGION_MAP_ORIGIN_Y,
  REGION_MAP_WIDTH,
  RegionMapProject,
  townMapKey,
  type RegionMapDocument,
  type RegionMapGraphics,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaMinimap as t } from "../../i18n/ja.minimap";
import { jaTownMini } from "../../i18n/ja.townMini";
import { scheduleIdleGc } from "../../util/idleGc";
import { canvasOf } from "../canvas";
import { TownLinkStore } from "../view/TownLinkStore";
import { findTownFrame, type TownFrame } from "../view/townFrame";

/** 現在地のまわりに出す範囲の最小（タウンマップのマス）。 */
export const TOWN_ZOOM_CELLS = { width: 7, height: 5 } as const;
/** 拡大の最大の倍率。 */
export const TOWN_ZOOM_SCALE = 4;
/** 拡大した絵の大きさの上限（画素。7×5 マスを 4 倍で 224×160）。 */
const MAX_WIDTH = TOWN_ZOOM_CELLS.width * REGION_MAP_CELL_PIXELS * TOWN_ZOOM_SCALE;
const MAX_HEIGHT = TOWN_ZOOM_CELLS.height * REGION_MAP_CELL_PIXELS * TOWN_ZOOM_SCALE;
/** 枠の色（タウンマップの小窓と同じ。ROM のデータは赤、自分で紐づけたものは水色）。 */
const ROM_COLOR = "#ff0000";
const LINK_COLOR = "#00e0ff";

/** 出す範囲（タウンマップのマス）と倍率。 */
export interface TownZoomArea {
  readonly page: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly scale: number;
}

/**
 * 現在地の枠のまわりの範囲。枠より上下左右に 1 マス以上広く、最小 7×5 マス。枠を真ん中に置き、タウンマップの外へ出ないようにずらす。
 * 倍率は 224×160 画素に収まる範囲で最大 4 倍（最小 1 倍）。
 */
export function townZoomArea(frame: TownFrame): TownZoomArea {
  const r = frame.rect;
  const width = Math.min(REGION_MAP_WIDTH, Math.max(TOWN_ZOOM_CELLS.width, r.width + 2));
  const height = Math.min(REGION_MAP_HEIGHT, Math.max(TOWN_ZOOM_CELLS.height, r.height + 2));
  const x = Math.min(REGION_MAP_WIDTH - width, Math.max(0, Math.round(r.x + r.width / 2 - width / 2)));
  const y = Math.min(REGION_MAP_HEIGHT - height, Math.max(0, Math.round(r.y + r.height / 2 - height / 2)));
  const cell = REGION_MAP_CELL_PIXELS;
  const scale = Math.max(1, Math.min(TOWN_ZOOM_SCALE, Math.floor(MAX_WIDTH / (width * cell)), Math.floor(MAX_HEIGHT / (height * cell))));
  return { page: r.page, x, y, width, height, scale };
}

/** 自動操作の `minimap.state` の `town`。 */
export interface TownZoomState {
  readonly loaded: boolean;
  readonly frame: TownFrame | null;
  readonly area: TownZoomArea | null;
  readonly text: string;
}

/**
 * ミニマップの小窓の、タウンマップの現在地のまわりの拡大（Phase7 #511 の追加の要望）。タウンマップの絵と位置は、
 * タウンマップの小窓（#306・#386）と同じ読み方（core の RegionMapProject と、紐づけの TownLinkStore・findTownFrame）。
 * 出している間だけ絵を持ち、隠したら捨てる。
 */
export class TownZoom {
  readonly element: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly label: HTMLElement;
  private readonly ownStore: TownLinkStore;
  private data: { document: RegionMapDocument; graphics: RegionMapGraphics } | null = null;
  private loading: Promise<void> | null = null;
  /** 描いた面の絵（面の番号と Canvas）。 */
  private pageImage: { page: number; canvas: HTMLCanvasElement } | null = null;
  private last: TownZoomState = { loaded: false, frame: null, area: null, text: "" };
  private error: string | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly regionName: (region: number) => string | null,
    /** タウンマップの小窓の紐づけ（作っていれば。小窓で紐づけを変えたらすぐ同じものを使う）。 */
    private readonly sharedStore: () => TownLinkStore | null = () => null,
  ) {
    this.ownStore = new TownLinkStore(state);
    this.element = document.createElement("div");
    this.element.className = "minimap-town";
    this.element.dataset["autoId"] = "minimap.townView";
    this.canvas = document.createElement("canvas");
    this.canvas.className = "minimap-town-canvas";
    this.canvas.dataset["autoId"] = "minimap.townCanvas";
    this.canvas.width = 0;
    this.canvas.height = 0;
    this.label = document.createElement("div");
    this.label.className = "minimap-note";
    this.label.dataset["autoId"] = "minimap.townLabel";
    this.element.append(this.canvas, this.label);
  }

  private get store(): TownLinkStore {
    return this.sharedStore() ?? this.ownStore;
  }

  /** 自動操作用。 */
  snapshot(): TownZoomState {
    return this.last;
  }

  /** 読み込み（まだなら）と紐づけの読み込みを待ってから描く。 */
  async refresh(): Promise<void> {
    await Promise.all([this.load(), this.store.load()]);
    this.draw();
  }

  /** ROM を開き直した（読んだものを捨てる）。 */
  reset(): void {
    this.data = null;
    this.error = null;
    this.dropPage();
  }

  /** 捨てる（隠したとき・小窓を閉じたとき）。 */
  dispose(): void {
    this.reset();
    this.canvas.width = this.canvas.height = 0;
    this.element.remove();
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

  /** 今のマップの位置のまわりを描く。 */
  draw(): void {
    const map = this.state.map;
    const doc = this.document();
    const graphics = this.graphics();
    const region = map?.doc.header.regionMapSectionId ?? null;
    const frame = map && doc ? findTownFrame(this.store.links, townMapKey(map.id.bank, map.id.map), region, doc) : null;
    let text: string;
    let area: TownZoomArea | null = null;
    if (this.error !== null) text = jaTownMini.failed(this.error);
    else if (!doc || !graphics) text = jaTownMini.loading;
    else if (!map) text = jaTownMini.none;
    else if (!frame) text = t.townNone;
    else {
      area = townZoomArea(frame);
      text = t.townPlace(region, region !== null ? this.regionName(region) : null, frame.source !== "rom");
    }
    this.last = { loaded: doc !== null, frame, area, text };
    this.label.textContent = text;
    const canvas = this.canvas;
    if (!area || !frame || !graphics) {
      canvas.width = canvas.height = 0;
      canvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    if (this.pageImage?.page !== area.page) {
      this.dropPage();
      this.pageImage = { page: area.page, canvas: canvasOf(graphics.render(area.page)) };
    }
    const cell = REGION_MAP_CELL_PIXELS;
    const k = area.scale;
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
  }
}
