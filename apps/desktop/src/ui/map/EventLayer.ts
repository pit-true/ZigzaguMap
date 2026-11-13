import type { MapEvents } from "@zigzagumap/core";

/** マップ上に描くイベントの種別（フライトポジションを含む）。 */
export type EventKind = "person" | "warp" | "trap" | "sign" | "fly";

/** 文字の箱の見た目。 */
interface BoxStyle {
  readonly letter: string;
  /** 箱の左上と右下の色（斜めのグラデーション）。 */
  readonly from: string;
  readonly to: string;
  /** 上・左の縁と、右・下の縁。 */
  readonly light: string;
  readonly dark: string;
  /** 文字と文字の縁取り。 */
  readonly ink: string;
  readonly inkEdge: string;
}

/**
 * 種別ごとの文字の箱（AdvanceMap の埋め込み画像を 16px に縮めたものに色を寄せる）。
 * P=黄緑、W=紫に金の文字、S=橙（看板）、S=緑（スクリプト）、F=赤橙（フライトポジション）。
 */
const STYLE: Readonly<Record<EventKind, BoxStyle>> = {
  person: { letter: "P", from: "#c5ea6f", to: "#64d4b9", light: "#c9ef7c", dark: "#62c7b3", ink: "#d8ec9c", inkEdge: "#88b86c" },
  warp: { letter: "W", from: "#9f459f", to: "#5245c8", light: "#b478b3", dark: "#2c2860", ink: "#f3c44b", inkEdge: "#9c6a26" },
  trap: { letter: "S", from: "#55ae6d", to: "#79e072", light: "#86c79d", dark: "#3f8256", ink: "#d7e97b", inkEdge: "#8fae6b" },
  sign: { letter: "S", from: "#d89070", to: "#a88a5c", light: "#d0a49d", dark: "#533d36", ink: "#d8d488", inkEdge: "#b0582c" },
  fly: { letter: "F", from: "#e07890", to: "#d88c70", light: "#d8acb6", dark: "#7b7669", ink: "#d7e97b", inkEdge: "#a6776f" },
};

/** 箱の不透明度（下のブロックが少し透ける）。 */
const BOX_ALPHA = 0.82;

/** マップ上の 1 件。 */
export interface PlacedEvent {
  readonly kind: EventKind;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** 人の画像番号（人以外は無し）。 */
  readonly graphicsId?: number;
}

/** フライトポジション（表の番号と位置）。 */
export interface PlacedFly {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

/**
 * イベントの一覧を、描く順（下から 人、ワープ、スクリプト、看板、フライトポジション）で平らにする。
 * AdvanceMap と同じく、後ろのものほど上に描かれ、クリックでも優先される。
 */
export function placedEvents(events: MapEvents | null, fly: PlacedFly | null = null): PlacedEvent[] {
  const out: PlacedEvent[] = [];
  if (events) {
    events.persons.forEach((e, index) => out.push({ kind: "person", index, x: e.x, y: e.y, graphicsId: e.graphicsId }));
    events.warps.forEach((e, index) => out.push({ kind: "warp", index, x: e.x, y: e.y }));
    events.traps.forEach((e, index) => out.push({ kind: "trap", index, x: e.x, y: e.y }));
    events.signs.forEach((e, index) => out.push({ kind: "sign", index, x: e.x, y: e.y }));
  }
  if (fly) out.push({ kind: "fly", index: fly.index, x: fly.x, y: fly.y });
  return out;
}

/** そのマスのいちばん上のイベント（クリックの優先順: フライトポジション > 看板 > スクリプト > ワープ > 人）。 */
export function eventAt(events: readonly PlacedEvent[], x: number, y: number): PlacedEvent | null {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.x === x && e.y === y) return e;
  }
  return null;
}

/** イベントを種別ごとの文字の箱で描く。`selected` があれば赤い 1px の枠で囲む（カーソルの表示）。 */
export function drawEvents(canvas: HTMLCanvasElement, events: readonly PlacedEvent[], cellSize: number, selected: PlacedEvent | null): void {
  const c = canvas.getContext("2d")!;
  c.clearRect(0, 0, canvas.width, canvas.height);
  drawEventsOn(c, events, cellSize, selected);
}

/** `drawEvents` の中身（画像の書き出しでも使えるよう、描く先を受け取る）。 */
export function drawEventsOn(c: CanvasRenderingContext2D, events: readonly PlacedEvent[], cellSize: number, selected: PlacedEvent | null): void {
  const scale = cellSize / 16;
  c.font = `${Math.round(14 * scale)}px Arial, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  for (const e of events) {
    const x = e.x * cellSize;
    const y = e.y * cellSize;
    if (x + cellSize <= 0 || y + cellSize <= 0 || x >= c.canvas.width || y >= c.canvas.height) continue;
    drawBox(c, STYLE[e.kind], x, y, cellSize, scale);
  }
  if (selected) {
    c.globalAlpha = 1;
    c.fillStyle = "#ff0000";
    const x = selected.x * cellSize;
    const y = selected.y * cellSize;
    c.fillRect(x, y, cellSize, scale);
    c.fillRect(x, y + cellSize - scale, cellSize, scale);
    c.fillRect(x, y, scale, cellSize);
    c.fillRect(x + cellSize - scale, y, scale, cellSize);
  }
}

function drawBox(c: CanvasRenderingContext2D, s: BoxStyle, x: number, y: number, size: number, scale: number): void {
  c.globalAlpha = BOX_ALPHA;
  const g = c.createLinearGradient(x, y, x + size, y + size);
  g.addColorStop(0, s.from);
  g.addColorStop(1, s.to);
  c.fillStyle = g;
  c.fillRect(x, y, size, size);
  c.fillStyle = s.light;
  c.fillRect(x, y, size, scale);
  c.fillRect(x, y, scale, size);
  c.fillStyle = s.dark;
  c.fillRect(x, y + size - scale, size, scale);
  c.fillRect(x + size - scale, y, scale, size);
  c.globalAlpha = 1;
  const cx = x + size / 2;
  const cy = y + size / 2 + scale * 0.5;
  c.lineWidth = 1.6 * scale;
  c.strokeStyle = s.inkEdge;
  c.strokeText(s.letter, cx, cy);
  c.fillStyle = s.ink;
  c.fillText(s.letter, cx, cy);
}
