import type { CfruProject } from "../project/CfruProject.js";
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
  /**
   * 配置の見分け（同じ値のマップは 1 回だけ数える）。ベース ROM のまま共有している配置は `rom:<フッターの位置>`、
   * ZigzaguMap で持っている配置（JSON・編集したもの・新しいマップ）は `map:<バンク>.<マップ>`。
   */
  readonly layoutKey: string;
}

/** 1 つの数え先（主タイルセットのブロックなら主の値、副のブロックなら主と副の組）。 */
type Counts = Map<number, number>;

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
  private readonly maps = new Map<string, UsageLayout>();
  private readonly layoutRefs = new Map<string, number>();
  private readonly primary = new Map<number, Counts>();
  private readonly secondary = new Map<string, Counts>();

  /** そのマップの配置を入れる・差し替える。 */
  set(layout: UsageLayout): void {
    this.remove(layout.id);
    const copy: UsageLayout = { ...layout, cells: layout.cells.slice() };
    this.maps.set(mapKey(layout.id), copy);
    const refs = this.layoutRefs.get(copy.layoutKey) ?? 0;
    this.layoutRefs.set(copy.layoutKey, refs + 1);
    if (refs === 0) this.apply(copy, 1);
  }

  /** そのマップを外す（消したマップ）。 */
  remove(id: MapId): void {
    const old = this.maps.get(mapKey(id));
    if (!old) return;
    this.maps.delete(mapKey(id));
    const refs = (this.layoutRefs.get(old.layoutKey) ?? 1) - 1;
    if (refs <= 0) {
      this.layoutRefs.delete(old.layoutKey);
      this.apply(old, -1);
    } else {
      this.layoutRefs.set(old.layoutKey, refs);
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

  private apply(layout: UsageLayout, sign: 1 | -1): void {
    const p = layout.primary >>> 0;
    const pair = `${p}:${layout.secondary >>> 0}`;
    let pc = this.primary.get(p);
    if (!pc) this.primary.set(p, (pc = new Map()));
    let sc = this.secondary.get(pair);
    if (!sc) this.secondary.set(pair, (sc = new Map()));
    for (const v of layout.cells) {
      const target = (v & BLOCK_ID_MASK) < PRIMARY_BLOCK_COUNT ? pc : sc;
      const k = cellKey(v);
      const n = (target.get(k) ?? 0) + sign;
      if (n <= 0) target.delete(k);
      else target.set(k, n);
    }
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

  /** ブロックの使用回数（その組の全マップ。共有している配置は 1 回）。 */
  count(block: number, primary: number, secondary: number): number {
    let n = 0;
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
          const width = rom.u32(footer);
          const height = rom.u32(footer + 4);
          const blocks = rom.pointer(footer + 12);
          const bytes = rom.slice(blocks, width * height * 2);
          const cells = new Uint16Array(width * height);
          for (let i = 0; i < cells.length; i++) cells[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
          usage.set({ id, primary: rom.u32(footer + 16), secondary: rom.u32(footer + 20), cells, layoutKey: `rom:${footer}` });
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
export function layoutOf(doc: { id: MapId; primaryTileset: number; secondaryTileset: number; grid: { cells: Uint16Array } }): UsageLayout {
  return { id: doc.id, primary: doc.primaryTileset >>> 0, secondary: doc.secondaryTileset >>> 0, cells: doc.grid.cells, layoutKey: `map:${doc.id.bank}.${doc.id.map}` };
}
