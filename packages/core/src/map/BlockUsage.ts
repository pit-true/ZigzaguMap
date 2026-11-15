import type { CfruProject } from "../project/CfruProject.js";
import type { Rom } from "../rom/Rom.js";
import { BLOCK_ID_MASK, MOVEMENT_MAX, MOVEMENT_SHIFT, PRIMARY_BLOCK_COUNT } from "./constants.js";
import type { MapId } from "./types.js";

/** 数える 1 枚（マップの配置）。 */
export interface UsageLayout {
  readonly id: MapId;
  /** 主・副タイルセットのポインタ。 */
  readonly primary: number;
  readonly secondary: number;
  /** 配置（u16。ブロック番号と移動許可）。 */
  readonly cells: Uint16Array;
  /** ボーダー（u16。使用回数にだけ数え、移動許可には数えない。#395）。 */
  readonly border?: Uint16Array;
  /**
   * 配置の見分け（同じ値のマップは 1 回だけ数える）。ベース ROM のまま共有している配置は `rom:<フッターの位置>`、
   * ZigzaguMap で持っている配置（JSON・編集したもの・新しいマップ）は `map:<バンク>.<マップ>`。
   */
  readonly layoutKey: string;
}

/** 1 つの数え先（主タイルセットのブロックなら主の値、副のブロックなら主と副の組）。 */
type Counts = Map<number, number>;

/** 数えた配置（`BlockUsage.layouts`）。 */
interface LayoutEntry {
  readonly primary: number;
  readonly secondary: number;
  /** 配置の中身（ベース ROM のままなら null で、`read` で読み直す）。 */
  readonly cells: Uint16Array | null;
  readonly read: (() => Uint16Array) | null;
  /** ボーダー（使用回数を外すときに引く）。 */
  readonly border: Uint16Array;
  refs: number;
}

const EMPTY_CELLS = new Uint16Array(0);

function mapKey(id: MapId): string {
  return `${id.bank}.${id.map}`;
}

/** 数えるときの鍵（ブロック番号と移動許可）。 */
function cellKey(value: number): number {
  return value & 0xffff;
}

/**
 * ブロックの使用回数と、ブロックごとのいちばん多い移動許可（#235）。
 *
 * - 主タイルセットのブロック（0x000〜0x27F）は、主タイルセットが同じマップ全部で数える。副のブロックは、主と副の組が同じマップで数える。
 * - 同じ配置を複数のマップで共有しているもの（ベース ROM のポケモンセンターの中など）は 1 回だけ数える（配置は 1 つなので）。
 * - マップを編集したら、そのマップの分だけ差し替える（`set`）。全部を数え直さない。
 */
export class BlockUsage {
  /** マップ → 配置の見分け。 */
  private readonly maps = new Map<string, string>();
  /**
   * 配置の見分け → 数えた配置と、それを使うマップの数。共有している配置は 1 つだけ持つ。
   * 配置の中身は、外すときに数を引くためだけに持つ。ベース ROM のままの配置は持たず、外すときに ROM から読み直す（`read`）。
   */
  private readonly layouts = new Map<string, LayoutEntry>();
  private readonly primary = new Map<number, Counts>();
  private readonly secondary = new Map<string, Counts>();
  /** ボーダーのブロック番号ごとの数（主・副の分け方は配置と同じ）。 */
  private readonly borderPrimary = new Map<number, Counts>();
  private readonly borderSecondary = new Map<string, Counts>();

  /** そのマップの配置を入れる・差し替える。 */
  set(layout: UsageLayout): void {
    this.put(layout, null);
  }

  /** `read` を渡すと配置の中身を持たず、外すときに `read` で読み直す（ベース ROM のままの配置）。 */
  private put(layout: UsageLayout, read: (() => Uint16Array) | null): void {
    this.remove(layout.id);
    this.maps.set(mapKey(layout.id), layout.layoutKey);
    const entry = this.layouts.get(layout.layoutKey);
    if (entry) {
      entry.refs++;
      return;
    }
    const border = layout.border ? layout.border.slice() : EMPTY_CELLS;
    this.apply(layout.primary, layout.secondary, layout.cells, 1);
    this.applyBorder(layout.primary, layout.secondary, border, 1);
    this.layouts.set(layout.layoutKey, { primary: layout.primary, secondary: layout.secondary, cells: read ? null : layout.cells.slice(), read, border, refs: 1 });
  }

  /** そのマップを外す（消したマップ）。 */
  remove(id: MapId): void {
    const key = this.maps.get(mapKey(id));
    if (key === undefined) return;
    this.maps.delete(mapKey(id));
    const entry = this.layouts.get(key);
    if (!entry) return;
    entry.refs--;
    if (entry.refs <= 0) {
      this.layouts.delete(key);
      this.apply(entry.primary, entry.secondary, entry.cells ?? entry.read!(), -1);
      this.applyBorder(entry.primary, entry.secondary, entry.border, -1);
    }
  }

  /** 入っているか。 */
  has(id: MapId): boolean {
    return this.maps.has(mapKey(id));
  }

  /** 入れたマップの数。 */
  get size(): number {
    return this.maps.size;
  }

  private apply(primary: number, secondary: number, cells: Uint16Array, sign: 1 | -1): void {
    const p = primary >>> 0;
    const pair = `${p}:${secondary >>> 0}`;
    let pc = this.primary.get(p);
    if (!pc) this.primary.set(p, (pc = new Map()));
    let sc = this.secondary.get(pair);
    if (!sc) this.secondary.set(pair, (sc = new Map()));
    for (const v of cells) {
      const target = (v & BLOCK_ID_MASK) < PRIMARY_BLOCK_COUNT ? pc : sc;
      const k = cellKey(v);
      const n = (target.get(k) ?? 0) + sign;
      if (n <= 0) target.delete(k);
      else target.set(k, n);
    }
  }

  private applyBorder(primary: number, secondary: number, cells: Uint16Array, sign: 1 | -1): void {
    if (cells.length === 0) return;
    const p = primary >>> 0;
    const pair = `${p}:${secondary >>> 0}`;
    let pc = this.borderPrimary.get(p);
    if (!pc) this.borderPrimary.set(p, (pc = new Map()));
    let sc = this.borderSecondary.get(pair);
    if (!sc) this.borderSecondary.set(pair, (sc = new Map()));
    for (const v of cells) {
      const id = v & BLOCK_ID_MASK;
      const target = id < PRIMARY_BLOCK_COUNT ? pc : sc;
      const n = (target.get(id) ?? 0) + sign;
      if (n <= 0) target.delete(id);
      else target.set(id, n);
    }
  }

  /** ボーダーでの使用回数（その組の全マップ。共有している配置は 1 回）。 */
  borderCount(block: number, primary: number, secondary: number): number {
    const id = block & BLOCK_ID_MASK;
    const counts = id < PRIMARY_BLOCK_COUNT ? this.borderPrimary.get(primary >>> 0) : this.borderSecondary.get(`${primary >>> 0}:${secondary >>> 0}`);
    return counts?.get(id) ?? 0;
  }

  private countsFor(block: number, primary: number, secondary: number): Counts | undefined {
    return (block & BLOCK_ID_MASK) < PRIMARY_BLOCK_COUNT ? this.primary.get(primary >>> 0) : this.secondary.get(`${primary >>> 0}:${secondary >>> 0}`);
  }

  /** ブロックの移動許可ごとの数（移動許可 → 数）。 */
  movements(block: number, primary: number, secondary: number): Map<number, number> {
    const out = new Map<number, number>();
    const counts = this.countsFor(block, primary, secondary);
    if (!counts) return out;
    const id = block & BLOCK_ID_MASK;
    for (let m = 0; m <= MOVEMENT_MAX; m++) {
      const n = counts.get(id | (m << MOVEMENT_SHIFT));
      if (n) out.set(m, n);
    }
    return out;
  }

  /** ブロックの使用回数（その組の全マップの配置とボーダー。共有している配置は 1 回）。 */
  count(block: number, primary: number, secondary: number): number {
    let n = this.borderCount(block, primary, secondary);
    for (const c of this.movements(block, primary, secondary).values()) n += c;
    return n;
  }

  /** ブロックにいちばん多い移動許可（同じ数なら小さい値）。使われていなければ null。 */
  mostMovement(block: number, primary: number, secondary: number): number | null {
    let best: number | null = null;
    let bestCount = 0;
    for (const [m, n] of this.movements(block, primary, secondary)) {
      if (n > bestCount) {
        best = m;
        bestCount = n;
      }
    }
    return best;
  }

  /**
   * プロジェクトの全マップから作る。ベース ROM のまま（JSON が無く、読み込んでいないか変えていない）のマップは
   * ROM のフッターと配置だけを読み、それ以外は読み込んだもの（無ければ読み取り専用で読む）を使う。
   */
  static async build(project: CfruProject): Promise<BlockUsage> {
    const usage = new BlockUsage();
    const rom = project.base.rom;
    for (const id of project.mapIds()) {
      try {
        const loaded = project.loaded(id);
        if (project.inBase(id) && !project.hasJson(id) && (!loaded || !project.isModified(id))) {
          const footer = rom.pointer(project.base.bankTable.headerOffset(id));
          const layoutKey = `rom:${footer}`;
          const border = readRomBorder(rom, footer);
          const read = (): Uint16Array => {
            const width = rom.u32(footer);
            const height = rom.u32(footer + 4);
            const bytes = rom.slice(rom.pointer(footer + 12), width * height * 2);
            const cells = new Uint16Array(width * height);
            for (let i = 0; i < cells.length; i++) cells[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
            return cells;
          };
          // 共有している配置は 2 枚目から読まない
          const cells = usage.layouts.has(layoutKey) ? EMPTY_CELLS : read();
          usage.put({ id, primary: rom.u32(footer + 16), secondary: rom.u32(footer + 20), cells, border, layoutKey }, read);
        } else {
          const doc = loaded ?? (await project.peek(id));
          if (doc) usage.set(layoutOf(doc));
        }
      } catch {
        // 読めないマップは数えない
      }
    }
    return usage;
  }
}

/** 読み込んだマップの配置（ZigzaguMap で持っている配置として数える）。 */
export function layoutOf(doc: { id: MapId; primaryTileset: number; secondaryTileset: number; grid: { cells: Uint16Array }; border?: { cells: Uint16Array } }): UsageLayout {
  return {
    id: doc.id,
    primary: doc.primaryTileset >>> 0,
    secondary: doc.secondaryTileset >>> 0,
    cells: doc.grid.cells,
    ...(doc.border ? { border: doc.border.cells } : {}),
    layoutKey: `map:${doc.id.bank}.${doc.id.map}`,
  };
}

/** ベース ROM のフッターのボーダー（FR は幅・高さが 0x18・0x19。読めなければ空）。 */
function readRomBorder(rom: Rom, footer: number): Uint16Array {
  try {
    const w = rom.u8(footer + 0x18);
    const h = rom.u8(footer + 0x19);
    if (w === 0 || h === 0 || w * h > 64) return EMPTY_CELLS;
    return rom.u16Array(rom.pointer(footer + 8), w * h);
  } catch {
    return EMPTY_CELLS;
  }
}
