/**
 * 自動ペンとマップ作成補助が使う「パーツ」（#303）。
 *
 * - 種類は 4 つ: 面（置き換えられるブロックの集まり）、縁つき（9 マスの枠。HMA の 9 グリッドに当たる）、
 *   部品（決まった並び）、くり返し（森・地面の模様など）。
 * - 各パーツは「枠」の名前ごとにマスの並び（幅 × 高さ）を持つ。マスはブロック番号（0x280 以上が副タイルセット）と
 *   移動許可（決めていなければ null）。空きのマスは null。
 * - 種類・役割・枠の名前は Bochi の `mapassist\*.txt` と同じ考え方にしてある（読み込みのため）。
 */

/** パーツの種類。 */
export type PartKind = "fill" | "edge" | "piece" | "repeat";

/** パーツの種類（画面の並び）。 */
export const PART_KINDS: readonly PartKind[] = ["fill", "edge", "piece", "repeat"];

/** パーツの役割（自動解析・画面の見出しに使う）。 */
export type PartRole = "ground" | "grass" | "path" | "water" | "tree" | "cliff" | "fence" | "building" | "decoration" | "other";

/** 役割（画面の並び）。 */
export const PART_ROLES: readonly PartRole[] = ["ground", "grass", "path", "water", "tree", "cliff", "fence", "building", "decoration", "other"];

/** 面: 属するブロックを横に並べたもの。 */
export const SLOT_BLOCKS = "Blocks";
/** 部品・くり返し: 本体。 */
export const SLOT_BODY = "Body";
/** くり返し: 上端。 */
export const SLOT_TOP = "Top";
/** くり返し: 下端。 */
export const SLOT_BOTTOM = "Bottom";

/** 縁つきの外側の 9 マス（外がある向きで呼ぶ。C は中）。 */
export const EDGE_OUTER_SLOTS = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE"] as const;
/** 縁つきの内側の角（斜めだけが外のマス。外がある向きで呼ぶ）。 */
export const EDGE_INNER_SLOTS = ["INW", "INE", "ISW", "ISE"] as const;
/** 縁つきの 2 周目（縁が二重のもの。外側の縁の 1 マス内側）。 */
export const EDGE_RING2_SLOTS = ["2NW", "2N", "2NE", "2W", "2E", "2SW", "2S", "2SE", "2INW", "2INE", "2ISW", "2ISE"] as const;
/** くり返しの、重なって並ぶ木の端の絵（#311）。 */
export const REPEAT_EXTRA_SLOTS = ["BodyEdge", "BottomEdge", "BodyTip"] as const;

/** 縁つきの 1 周目の枠の名前。 */
export type EdgeSlot = (typeof EDGE_OUTER_SLOTS)[number] | (typeof EDGE_INNER_SLOTS)[number];

/** 種類ごとの、画面で編集する枠の名前（画面に出す順）。 */
export function slotNamesOf(kind: PartKind): readonly string[] {
  switch (kind) {
    case "fill":
      return [SLOT_BLOCKS];
    case "edge":
      return [...EDGE_OUTER_SLOTS, ...EDGE_INNER_SLOTS];
    case "piece":
      return [SLOT_BODY];
    case "repeat":
      return [SLOT_TOP, SLOT_BODY, SLOT_BOTTOM];
  }
}

/** 種類ごとの、持てる枠の名前の全部（保存・ブロックの表に使う）。 */
export function allSlotNamesOf(kind: PartKind): readonly string[] {
  switch (kind) {
    case "edge":
      return [...slotNamesOf(kind), ...EDGE_RING2_SLOTS];
    case "repeat":
      return [...slotNamesOf(kind), ...REPEAT_EXTRA_SLOTS];
    default:
      return slotNamesOf(kind);
  }
}

/** マス 1 つ。`movement` が null なら決めていない（描くときは使用回数でいちばん多い値）。 */
export interface PartCell {
  /** ブロック番号（0〜0x3FF。0x280 以上が副タイルセット）。 */
  readonly block: number;
  readonly movement: number | null;
}

/** 枠 1 つ（幅 × 高さ。左上から行ごと、null は空き）。 */
export interface PartGrid {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly (PartCell | null)[];
}

/** 主タイルセットの見分け（副タイルセットのファイルに入った、主と副の両方のブロックを使うパーツが持つ）。 */
export interface PrimaryRef {
  readonly fingerprint: string;
  readonly game: string;
  /** ヘッダーの位置（ROM 先頭から）。分からなければ -1。 */
  readonly headerAddress: number;
}

/** パーツ 1 つ。 */
export interface AutoPenPart {
  readonly name: string;
  readonly kind: PartKind;
  readonly role: PartRole;
  /** 並び順（小さいほど先。同じブロックを持つ同じ種類のパーツでは先のものを使う）。 */
  readonly order: number;
  /** 枠の名前 → 並び。 */
  readonly slots: Readonly<Record<string, PartGrid>>;
  /** 主と副の両方のブロックを使うとき、どの主タイルセットと組で使うものか。 */
  readonly primary?: PrimaryRef;
  /** 読んだときの知らない項目（書き戻すときに残す）。 */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** タイルセット 1 つの見分け方。 */
export interface AutoPenTilesetInfo {
  readonly secondary: boolean;
  /** ゲームコード（BPRJ など）。 */
  readonly game: string;
  /** ヘッダーの位置（ROM 先頭から。maps\tilesets の新しいタイルセットはフォルダ名の番号）。 */
  readonly headerAddress: number;
  /** ブロックのデータの SHA-1 の先頭 8 バイト（16 進 16 桁）。 */
  readonly fingerprint: string;
  /** ブロックの数。 */
  readonly blockCount: number;
  /** 表示用の名前。 */
  readonly name: string;
}

/** パーツの定義のファイル 1 つ（タイルセット 1 つ分）。 */
export interface AutoPenFile {
  readonly tileset: AutoPenTilesetInfo;
  readonly parts: readonly AutoPenPart[];
  /** 読んだときの知らない項目。 */
  readonly extra?: Readonly<Record<string, unknown>>;
}

/** 枠の (x, y) のマス（範囲の外なら null）。 */
export function gridCell(grid: PartGrid, x: number, y: number): PartCell | null {
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return null;
  return grid.cells[y * grid.width + x] ?? null;
}

/** 空きでないマスが無いか。 */
export function gridIsBlank(grid: PartGrid): boolean {
  return grid.cells.every((c) => c === null);
}

/** 全部の枠の空きでないマス。 */
export function* partCells(part: AutoPenPart): Generator<PartCell> {
  for (const name of allSlotNamesOf(part.kind)) {
    const grid = part.slots[name];
    if (!grid) continue;
    for (const c of grid.cells) if (c) yield c;
  }
}

/** 副タイルセットのブロック（0x280 以上）を使うか。 */
export function partUsesSecondary(part: AutoPenPart, primaryCount = 0x280): boolean {
  for (const c of partCells(part)) if (c.block >= primaryCount) return true;
  return false;
}

/** 主タイルセットのブロック（0x280 未満）を使うか。 */
export function partUsesPrimary(part: AutoPenPart, primaryCount = 0x280): boolean {
  for (const c of partCells(part)) if (c.block < primaryCount) return true;
  return false;
}

/** 1×1 の枠。 */
export function singleGrid(block: number, movement: number | null = null): PartGrid {
  return { width: 1, height: 1, cells: [{ block, movement }] };
}

/** ブロックの並びから枠を作る（`movements` が無ければ決めない）。 */
export function gridOf(width: number, height: number, blocks: readonly (number | null)[], movements?: readonly (number | null)[]): PartGrid {
  if (blocks.length !== width * height) throw new Error(`マスの数（${blocks.length}）が ${width}×${height} と合いません`);
  return { width, height, cells: blocks.map((b, i) => (b === null ? null : { block: b, movement: movements?.[i] ?? null })) };
}
