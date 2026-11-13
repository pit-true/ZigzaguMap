import type { MapEvents } from "@zigzagumap/core";

/** イベントの種別。 */
export type EventKind = "person" | "warp" | "trap" | "sign";

/** 種別ごとの箱の色と文字（AdvanceMap の文字の箱: P=黄緑、W=紫、S=緑（スクリプト）、S=橙（看板））。 */
const STYLE: Readonly<Record<EventKind, { fill: string; edge: string; letter: string }>> = {
  person: { fill: "#8fd82a", edge: "#3d7a10", letter: "P" },
  warp: { fill: "#7a2fd0", edge: "#2050e0", letter: "W" },
  trap: { fill: "#2f8a2a", edge: "#0f4a10", letter: "S" },
  sign: { fill: "#f07a1a", edge: "#8a3a00", letter: "S" },
};

/** マップ上の 1 件。 */
export interface PlacedEvent {
  readonly kind: EventKind;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** 人の画像番号（人以外は無し）。 */
  readonly graphicsId?: number;
}

/** 画像番号から OW の画像（Canvas）を返す。無ければ null。 */
export type SpriteSource = (graphicsId: number) => CanvasImageSource & { width: number; height: number } | null;

/** イベントの一覧を、描く順（看板、スクリプト、ワープ、人）で平らにする。 */
export function placedEvents(events: MapEvents | null): PlacedEvent[] {
  if (!events) return [];
  const out: PlacedEvent[] = [];
  events.signs.forEach((e, index) => out.push({ kind: "sign", index, x: e.x, y: e.y }));
  events.traps.forEach((e, index) => out.push({ kind: "trap", index, x: e.x, y: e.y }));
  events.warps.forEach((e, index) => out.push({ kind: "warp", index, x: e.x, y: e.y }));
  events.persons.forEach((e, index) => out.push({ kind: "person", index, x: e.x, y: e.y, graphicsId: e.graphicsId }));
  return out;
}

/**
 * イベントを種別ごとの色の箱で描く。選択中のものは赤い枠で囲む。
 * `sprites` を渡すと（オブジェクトの表示）、AdvanceMap と同じく人を OW 画像で描き、人以外の箱は描かない。
 * OW 画像はマスの下端にそろえ、横はマスの中央に置く。画像が無い人は箱で描く。
 */
export function drawEvents(
  canvas: HTMLCanvasElement,
  events: readonly PlacedEvent[],
  cellSize: number,
  selected: PlacedEvent | null,
  sprites: SpriteSource | null = null,
): void {
  const c = canvas.getContext("2d")!;
  c.clearRect(0, 0, canvas.width, canvas.height);
  drawEventsOn(c, events, cellSize, selected, sprites);
}

/** `drawEvents` の中身（画像の書き出しでも使う）。 */
export function drawEventsOn(
  c: CanvasRenderingContext2D,
  events: readonly PlacedEvent[],
  cellSize: number,
  selected: PlacedEvent | null,
  sprites: SpriteSource | null = null,
): void {
  c.imageSmoothingEnabled = false;
  c.font = `bold ${Math.round(cellSize * 0.7)}px Arial, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  for (const e of events) {
    if (sprites) {
      if (e.kind !== "person") continue;
      const image = e.graphicsId !== undefined ? sprites(e.graphicsId) : null;
      if (image) {
        const scale = cellSize / 16;
        const w = image.width * scale;
        const h = image.height * scale;
        c.drawImage(image, e.x * cellSize + (cellSize - w) / 2, (e.y + 1) * cellSize - h, w, h);
        continue;
      }
    }
    const s = STYLE[e.kind];
    const x = e.x * cellSize;
    const y = e.y * cellSize;
    // 箱は半透明（下のブロックが少し透ける）。
    c.globalAlpha = 0.8;
    c.fillStyle = s.fill;
    c.fillRect(x + 1, y + 1, cellSize - 2, cellSize - 2);
    c.globalAlpha = 1;
    c.strokeStyle = s.edge;
    c.lineWidth = 1;
    c.strokeRect(x + 1.5, y + 1.5, cellSize - 3, cellSize - 3);
    c.lineWidth = 2;
    c.strokeStyle = "#5a3a00";
    c.strokeText(s.letter, x + cellSize / 2, y + cellSize / 2 + 1);
    c.fillStyle = "#f8e048";
    c.fillText(s.letter, x + cellSize / 2, y + cellSize / 2 + 1);
  }
  if (selected) {
    c.strokeStyle = "#ff0000";
    c.lineWidth = 1;
    c.strokeRect(selected.x * cellSize + 0.5, selected.y * cellSize + 0.5, cellSize - 1, cellSize - 1);
  }
}
