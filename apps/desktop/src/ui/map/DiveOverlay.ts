import { BLOCK_ID_MASK, ConnectionDirection, type MapId } from "@zigzagumap/core";
import type { EditorState, TabId } from "../../app/EditorState";
import { renderBand } from "../../app/neighbors/NeighborService";
import { TilesetView } from "../../app/TilesetView";
import { jaNeighbors } from "../../i18n/ja.neighbors";
import type { Cell, MapView } from "./MapView";

/** 透かして見せる丸の半径（マス）。 */
export const DIVE_RADIUS = 4;

/** 重ねて見せている相手（自動操作の `neighbors.state` の `dive`）。 */
export interface DiveTarget {
  readonly id: MapId;
  readonly direction: number;
}

/** 読み込んだダイブ先・浮上先の画像（1 枚だけ持つ）。 */
interface DiveImage {
  readonly key: string;
  readonly bitmap: ImageBitmap;
}

/** Space を押しているか（画面全体で 1 つ）。 */
let spaceHeld = false;
const holders = new Set<DiveOverlay>();
let installed = false;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button"].includes(el.type);
  return el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable || el.tagName === "BUTTON";
}

function installKeys(): void {
  if (installed) return;
  installed = true;
  const set = (held: boolean): void => {
    if (spaceHeld === held) return;
    spaceHeld = held;
    for (const h of holders) void h.update();
  };
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    if (![...holders].some((h) => h.active)) return;
    // 押している間のスクロールを止める
    e.preventDefault();
    set(true);
  });
  document.addEventListener("keyup", (e) => {
    if (e.key === " ") set(false);
  });
  window.addEventListener("blur", () => set(false));
}

/** グリッドの要約（変わったら描き直すため）。 */
function gridHash(cells: Uint16Array): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < cells.length; i++) {
    h ^= cells[i]! & BLOCK_ID_MASK;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Space を押している間、ダイブ・浮上の接続先のマップを主マップに重ね、カーソルのまわりを丸く透かして見せる（#232。マップタブと
 * イベントタブ）。その状態でダブルクリックすると相手のマップを開く。接続先が無ければステータスバーで知らせる。
 * 相手は主マップと同じ大きさなので全体を読む（読み取り専用。DocumentStore に入れない）。画像は Space を離したあとも 1 枚だけ持つ。
 */
export class DiveOverlay {
  private canvas: HTMLCanvasElement | null = null;
  private cursor: Cell | null = null;
  private image: DiveImage | null = null;
  private targetValue: DiveTarget | null = null;
  private loading: Promise<void> | null = null;

  constructor(
    private readonly view: MapView,
    private readonly state: EditorState,
    private readonly tab: TabId,
    private readonly openMap: (id: MapId) => unknown,
  ) {
    installKeys();
    holders.add(this);
    view.stage.addEventListener("pointermove", (e) => {
      this.cursor = view.rawCellAt(e);
      if (this.target) this.draw();
    });
    // 重ねているときのダブルクリックは相手のマップを開く（ほかのダブルクリックの処理より先に受ける）
    view.stage.addEventListener(
      "dblclick",
      (e) => {
        const t = this.target;
        if (!t) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        spaceHeld = false;
        this.hide();
        void this.openMap(t.id);
      },
      true,
    );
    state.on("map", () => {
      this.hide();
      if (spaceHeld) void this.update();
    });
    state.on("tab", () => void this.update());
  }

  /** このタブが表示中か。 */
  get active(): boolean {
    return this.state.tab === this.tab && this.state.map !== null;
  }

  /** 重ねて見せている相手（見せていなければ null）。 */
  get target(): DiveTarget | null {
    return this.targetValue;
  }

  /** Space の状態に合わせて、重ねる・消す。 */
  async update(): Promise<void> {
    if (!spaceHeld || !this.active) return this.hide();
    if (this.targetValue) return;
    const main = this.state.map!;
    const c = (main.doc.connections ?? []).find((x) => x.direction === ConnectionDirection.Dive) ?? (main.doc.connections ?? []).find((x) => x.direction === ConnectionDirection.Emerge);
    if (!c) {
      this.state.setStatus(jaNeighbors.noDive);
      return;
    }
    const id = { bank: c.bank, map: c.map };
    this.loading = this.load(id);
    await this.loading;
    if (!spaceHeld || !this.active || this.state.map !== main || !this.image) return;
    this.targetValue = { id, direction: c.direction };
    this.state.setStatus(jaNeighbors.diveShown(id.bank, id.map, c.direction === ConnectionDirection.Dive));
    this.draw();
  }

  /** 読み込みが終わるのを待つ（自動操作用）。 */
  async settle(): Promise<void> {
    await this.loading;
  }

  /** 相手のマップの全体を画像にする（同じマップで中身が同じなら前の画像を使う）。 */
  private async load(id: MapId): Promise<void> {
    const session = this.state.session;
    if (!session) return;
    const doc = await session.project.peek(id);
    if (!doc) {
      this.state.setStatus(jaNeighbors.noDive);
      return;
    }
    const tilesKey = `${doc.primaryTileset >>> 0}:${doc.secondaryTileset >>> 0}`;
    const key = `${id.bank}.${id.map}|${tilesKey}|${doc.width}x${doc.height}|${gridHash(doc.grid.cells)}`;
    if (this.image?.key === key) return;
    let tiles = this.state.map?.tiles.key === tilesKey ? this.state.map.tiles : session.cachedTiles(tilesKey);
    if (!tiles) {
      const t = await session.project.peekTilesets(doc);
      tiles = new TilesetView(tilesKey, t.primary, t.secondary);
    }
    const bitmap = await renderBand(doc.grid, { x: 0, y: 0, width: doc.width, height: doc.height }, tiles);
    this.image?.bitmap.close();
    this.image = { key, bitmap };
  }

  private hide(): void {
    this.targetValue = null;
    this.canvas?.remove();
    this.canvas = null;
  }

  /** カーソルのまわりの丸の中に、相手のマップを描く。 */
  private draw(): void {
    const image = this.image;
    if (!image || !this.targetValue) return;
    const size = this.view.cellSize;
    const layer = this.view.layer;
    let canvas = this.canvas;
    if (!canvas) {
      canvas = document.createElement("canvas");
      canvas.className = "map-dive";
      canvas.style.pointerEvents = "none";
      this.view.stage.append(canvas);
      this.canvas = canvas;
    }
    canvas.width = layer.width;
    canvas.height = layer.height;
    Object.assign(canvas.style, { left: layer.style.left, top: layer.style.top, width: layer.style.width, height: layer.style.height });
    const c = canvas.getContext("2d")!;
    c.clearRect(0, 0, canvas.width, canvas.height);
    const cur = this.cursor ?? { x: Math.floor(image.bitmap.width / 32), y: Math.floor(image.bitmap.height / 32) };
    c.save();
    c.beginPath();
    c.arc((cur.x + 0.5) * size, (cur.y + 0.5) * size, (DIVE_RADIUS + 0.5) * size, 0, Math.PI * 2);
    c.clip();
    c.imageSmoothingEnabled = false;
    c.drawImage(image.bitmap, 0, 0, image.bitmap.width * (size / 16), image.bitmap.height * (size / 16));
    c.restore();
    c.strokeStyle = "#1060d0";
    c.lineWidth = 2;
    c.beginPath();
    c.arc((cur.x + 0.5) * size, (cur.y + 0.5) * size, (DIVE_RADIUS + 0.5) * size, 0, Math.PI * 2);
    c.stroke();
  }
}
