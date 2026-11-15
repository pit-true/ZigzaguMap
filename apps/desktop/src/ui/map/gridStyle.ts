/**
 * グリッドの形（Phase5 #391。表示 > グリッドの設定…）。マス単位の幅・高さ・ずらし、色、線の形。
 * 既定は今までの見た目（1 マスごと、ずらしなし、黒、実線）。表示の切り替え（Ctrl+G）は今までどおり `grid` の設定。
 */
export interface GridStyle {
  /** 線の間（マス。1〜64）。 */
  readonly width: number;
  readonly height: number;
  /** ずらし（マス。0〜幅-1・高さ-1 に丸める）。 */
  readonly offsetX: number;
  readonly offsetY: number;
  /** 色（#rrggbb）。 */
  readonly color: string;
  /** 線の形。 */
  readonly line: GridLine;
}

/** 線の形（実線・破線・点）。 */
export type GridLine = "solid" | "dashed" | "dotted";

export const GRID_LINES: readonly GridLine[] = ["solid", "dashed", "dotted"];

/** 既定（AdvanceMap と同じ見た目）。 */
export const DEFAULT_GRID_STYLE: GridStyle = { width: 1, height: 1, offsetX: 0, offsetY: 0, color: "#000000", line: "solid" };

/** 線の間の上限（マス）。 */
export const MAX_GRID_STEP = 64;

function clampInt(v: unknown, lo: number, hi: number, fallback: number): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : fallback;
  return Math.min(hi, Math.max(lo, n));
}

/** 個人設定の値を確かめて直す（壊れていれば既定の値）。 */
export function normalizeGridStyle(value: unknown): GridStyle {
  const v = (typeof value === "object" && value !== null ? value : {}) as Partial<Record<keyof GridStyle, unknown>>;
  const width = clampInt(v.width, 1, MAX_GRID_STEP, 1);
  const height = clampInt(v.height, 1, MAX_GRID_STEP, 1);
  const color = typeof v.color === "string" && /^#[0-9a-fA-F]{6}$/.test(v.color) ? v.color.toLowerCase() : DEFAULT_GRID_STYLE.color;
  const line = GRID_LINES.includes(v.line as GridLine) ? (v.line as GridLine) : "solid";
  const mod = (a: number, n: number): number => ((a % n) + n) % n;
  return { width, height, offsetX: mod(clampInt(v.offsetX, -9999, 9999, 0), width), offsetY: mod(clampInt(v.offsetY, -9999, 9999, 0), height), color, line };
}

/** 既定と同じ見た目か。 */
export function isDefaultGridStyle(s: GridStyle): boolean {
  const d = DEFAULT_GRID_STYLE;
  return s.width === d.width && s.height === d.height && s.offsetX === d.offsetX && s.offsetY === d.offsetY && s.color === d.color && s.line === d.line;
}

/** 同じ形か。 */
export function sameGridStyle(a: GridStyle, b: GridStyle): boolean {
  return a.width === b.width && a.height === b.height && a.offsetX === b.offsetX && a.offsetY === b.offsetY && a.color === b.color && a.line === b.line;
}

/**
 * 線を引く位置（画素）の並び。`step` は 1 マスの画素、`cells` は線の間（マス）、`offset` はずらし（マス）。
 * 先頭は 0 以上で最初の線（ずらしが 0 なら 0）。
 */
export function gridLinePositions(length: number, step: number, cells: number, offset: number): number[] {
  const out: number[] = [];
  const every = step * cells;
  for (let p = offset * step; p < length; p += every) out.push(p);
  return out;
}

/** 線の形ごとの、描く長さと空ける長さ（画素。実線は空けない）。`unit` は線の太さ。 */
export function dashPattern(line: GridLine, unit: number): { on: number; off: number } {
  if (line === "dashed") return { on: 4 * unit, off: 3 * unit };
  if (line === "dotted") return { on: unit, off: unit };
  return { on: Number.POSITIVE_INFINITY, off: 0 };
}
