import { PERSON_KIND_CLONE, type MapEvents, type PersonEvent } from "@zigzagumap/core";

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
 * 種別ごとの文字の箱。色は AdvanceMap のマップ&イベント画像から求めた、AdvanceMap の箱の画像そのものの色
 * （AdvanceMap は箱の画像を 50% でマップに重ねるので、画像の色 = 2 × 重ねた色 − マップの色）。
 * P=黄緑、W=紫、S=橙（看板）、S=緑（スクリプト）、F=赤（フライトポジション）。文字はどれも黄色。
 */
const STYLE: Readonly<Record<EventKind, BoxStyle>> = {
  person: { letter: "P", from: "#bdec0e", to: "#14d6a3", light: "#b3f358", dark: "#0b4f28", ink: "#f4e81c", inkEdge: "#7a6a08" },
  warp: { letter: "W", from: "#cf5e8e", to: "#3613c0", light: "#bc5fcc", dark: "#170742", ink: "#f4e616", inkEdge: "#7a6a08" },
  trap: { letter: "S", from: "#127919", to: "#35c610", light: "#5eaa62", dark: "#114308", ink: "#f6e823", inkEdge: "#7a6a08" },
  sign: { letter: "S", from: "#f4360a", to: "#dc9b09", light: "#f78155", dark: "#523303", ink: "#f6e822", inkEdge: "#7a6a08" },
  fly: { letter: "F", from: "#ee084c", to: "#dc5709", light: "#f75472", dark: "#521603", ink: "#f4e60e", inkEdge: "#7a6a08" },
};

/** 箱の不透明度（AdvanceMap と同じく、文字も含めて 50% でマップに重ねる）。 */
const BOX_ALPHA = 0.5;

/** マップ&イベント画像に重ねるもの（イベントタブと同じ印と、カーソルの表示がオンなら選択中の枠）。 */
export interface EventOverlay {
  readonly events: readonly PlacedEvent[];
  readonly selected: PlacedEvent | null;
}

/** マップ上の 1 件。 */
export interface PlacedEvent {
  readonly kind: EventKind;
  readonly index: number;
  readonly x: number;
  readonly y: number;
  /** 人の画像番号（人以外は無し。クローンなら元の人の画像番号。#298）。 */
  readonly graphicsId?: number;
  /** クローン（種類 1 の人）なら true（画面では角に小さな印を付ける。#298）。 */
  readonly clone?: boolean;
}

/** 人を描く画像番号を引く関数（クローンを元の人の見た目で描くため。#298）。 */
export type PersonGraphics = (p: PersonEvent) => number;

/** 人を印の 1 件にする（クローンなら `clone` を付け、画像番号は `graphics` で引く）。 */
export function placedPerson(p: PersonEvent, index: number, graphics: PersonGraphics | null = null, x = p.x, y = p.y): PlacedEvent {
  const clone = p.kind === PERSON_KIND_CLONE;
  return { kind: "person", index, x, y, graphicsId: clone && graphics ? graphics(p) : p.graphicsId, ...(clone ? { clone } : {}) };
}

/** 画像番号から OW の画像（Canvas）を返す。無ければ null。 */
export type SpriteSource = (graphicsId: number) => (CanvasImageSource & { width: number; height: number }) | null;

/** フライトポジション（表の番号と位置）。 */
export interface PlacedFly {
  readonly index: number;
  readonly x: number;
  readonly y: number;
}

/**
 * イベントの一覧を、描く順（下から 人、ワープ、スクリプト、看板、フライトポジション）で平らにする。
 * AdvanceMap と同じく、後ろのものほど上に描かれ、クリックでも優先される。クローンの見た目は `graphics` で引く（#298）。
 */
export function placedEvents(events: MapEvents | null, fly: PlacedFly | null = null, graphics: PersonGraphics | null = null): PlacedEvent[] {
  const out: PlacedEvent[] = [];
  if (events) {
    events.persons.forEach((e, index) => out.push(placedPerson(e, index, graphics)));
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

/**
 * イベントを種別ごとの文字の箱で描く。`selected` があれば赤い 1px の枠で囲む（カーソルの表示）。
 * `sprites` を渡すと（オブジェクトの表示）、AdvanceMap と同じく人を OW 画像で描き、人以外の箱は描かない。
 * OW 画像はマスの下端にそろえ、横はマスの中央に置く。画像が無い人は箱で描く。
 * クローンもほかの人と同じ箱・OW 画像で描き、画面ではマスの右上に小さな印を付ける（#298）。
 */
export function drawEvents(
  canvas: HTMLCanvasElement,
  events: readonly PlacedEvent[],
  cellSize: number,
  selected: PlacedEvent | null,
  sprites: SpriteSource | null = null,
  opacity = 1,
): void {
  const c = canvas.getContext("2d")!;
  c.clearRect(0, 0, canvas.width, canvas.height);
  drawEventsOn(c, events, cellSize, selected, sprites, true, opacity);
}

/**
 * `drawEvents` の中身（画像の書き出しでも使えるよう、描く先を受け取る）。`cloneMarks` が true ならクローンに印を付ける
 * （画面だけ。書き出す画像は AdvanceMap と同じく印を付けない）。
 * `opacity` はイベントの濃さ（#304。0.1〜1）。箱は AdvanceMap と同じ 50% にさらに掛け、OW 画像はそのまま掛ける。選択の枠には掛けない。
 */
export function drawEventsOn(
  c: CanvasRenderingContext2D,
  events: readonly PlacedEvent[],
  cellSize: number,
  selected: PlacedEvent | null,
  sprites: SpriteSource | null = null,
  cloneMarks = false,
  opacity = 1,
): void {
  const scale = cellSize / 16;
  const alpha = clampOpacity(opacity);
  c.imageSmoothingEnabled = false;
  for (const e of events) {
    const x = e.x * cellSize;
    const y = e.y * cellSize;
    if (x + cellSize <= 0 || y + cellSize <= 0 || x >= c.canvas.width || y >= c.canvas.height) continue;
    if (sprites) {
      if (e.kind !== "person") continue;
      const image = e.graphicsId !== undefined ? sprites(e.graphicsId) : null;
      if (image) {
        const w = image.width * scale;
        const h = image.height * scale;
        c.globalAlpha = alpha;
        c.drawImage(image, x + (cellSize - w) / 2, y + cellSize - h, w, h);
        c.globalAlpha = 1;
        if (cloneMarks && e.clone) drawCloneMark(c, x, y, cellSize);
        continue;
      }
    }
    drawBox(c, e.kind, x, y, cellSize, alpha);
    if (cloneMarks && e.clone) drawCloneMark(c, x, y, cellSize);
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

/** クローンの印の色（白い縁の水色の三角）。 */
const CLONE_MARK = "#3cc8ff";
const CLONE_MARK_EDGE = "#ffffff";

/** クローンの印（マスの右上の小さな三角。#298）。 */
function drawCloneMark(c: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const s = Math.max(4, Math.round(size * 0.375));
  const right = x + size;
  c.save();
  c.globalAlpha = 1;
  c.beginPath();
  c.moveTo(right - s, y);
  c.lineTo(right, y);
  c.lineTo(right, y + s);
  c.closePath();
  c.fillStyle = CLONE_MARK;
  c.fill();
  c.lineWidth = Math.max(1, size / 16);
  c.strokeStyle = CLONE_MARK_EDGE;
  c.stroke();
  c.restore();
}

/** 種別・大きさごとの箱の画像（不透明で描いておき、重ねるときに 50% にする）。 */
const boxCache = new Map<string, HTMLCanvasElement>();

/** イベントの濃さを 0.1〜1 に収める（数でなければ 1）。 */
export function clampOpacity(opacity: number): number {
  return Number.isFinite(opacity) ? Math.min(1, Math.max(0.1, opacity)) : 1;
}

function drawBox(c: CanvasRenderingContext2D, kind: EventKind, x: number, y: number, size: number, alpha = 1): void {
  const key = `${kind}:${size}`;
  let image = boxCache.get(key);
  if (!image) {
    image = renderBox(STYLE[kind], size);
    boxCache.set(key, image);
  }
  c.globalAlpha = BOX_ALPHA * alpha;
  c.drawImage(image, x, y);
  c.globalAlpha = 1;
}

/** 箱を 1 つ不透明で描く（AdvanceMap の箱の画像に当たるもの）。 */
function renderBox(s: BoxStyle, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const c = canvas.getContext("2d")!;
  const scale = size / 16;
  const g = c.createLinearGradient(0, 0, size, size);
  g.addColorStop(0, s.from);
  g.addColorStop(1, s.to);
  c.fillStyle = g;
  c.fillRect(0, 0, size, size);
  c.fillStyle = s.light;
  c.fillRect(0, 0, size, scale);
  c.fillRect(0, 0, scale, size);
  c.fillStyle = s.dark;
  c.fillRect(0, size - scale, size, scale);
  c.fillRect(size - scale, 0, scale, size);
  c.font = `bold ${Math.round(14 * scale)}px Arial, sans-serif`;
  c.textAlign = "center";
  c.textBaseline = "middle";
  c.lineJoin = "round";
  c.lineWidth = 1.6 * scale;
  c.strokeStyle = s.inkEdge;
  c.strokeText(s.letter, size / 2, size / 2 + scale * 0.5);
  c.fillStyle = s.ink;
  c.fillText(s.letter, size / 2, size / 2 + scale * 0.5);
  return canvas;
}
