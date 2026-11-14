import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import type { MapEvents } from "./types.js";

/** 落とし物の人の見た目（OW の番号と動き方。FR では向きも動き方の番号で決まる）。 */
export interface ItemBallStyle {
  readonly graphicsId: number;
  readonly movementType: number;
}

/** 数えた落とし物が 1 つも無いときの既定（素の FR のいちばん多いもの: ボールの OW 92、下向き固定 8）。 */
export const DEFAULT_ITEM_BALL_STYLE: ItemBallStyle = { graphicsId: 92, movementType: 8 };

/**
 * ROM の落とし物のスクリプトか（FR の `finditem` マクロ: `setorcopyvar 0x8000, 道具` `setorcopyvar 0x8001, 数` `callstd 1`）。
 * 先頭の 12 バイトが `1A 00 80 ?? ?? 1A 01 80 ?? ?? 09 01` なら落とし物とみなす。
 */
export function isRomItemBallScript(rom: Rom, pointer: number): boolean {
  const offset = (pointer >>> 0) - ROM_BASE;
  if (offset < 0 || offset + 12 > rom.size) return false;
  const b = rom.bytes;
  return (
    b[offset] === 0x1a &&
    b[offset + 1] === 0x00 &&
    b[offset + 2] === 0x80 &&
    b[offset + 5] === 0x1a &&
    b[offset + 6] === 0x01 &&
    b[offset + 7] === 0x80 &&
    b[offset + 10] === 0x09 &&
    b[offset + 11] === 0x01
  );
}

/**
 * 落とし物の見た目を数え、いちばん多いものを答える（#304。Bochi の ItemBall と同じ考え方）。
 * マップ 1 枚ずつ `addMap` に渡す。落とし物の人は、`maps\` の落とし物（`itemBallPersons`）と、ROM の落とし物のスクリプトを指す人。
 * 同じ数なら先に数えたもの。1 つも無ければ `DEFAULT_ITEM_BALL_STYLE`。
 */
export class ItemBallStyleCounter {
  private readonly counts = new Map<string, { style: ItemBallStyle; count: number; order: number }>();

  constructor(private readonly rom: Rom | null) {}

  /** マップ 1 枚の落とし物を数える。 */
  addMap(events: MapEvents | null, itemBallPersons: ReadonlySet<number> = new Set()): void {
    if (!events) return;
    events.persons.forEach((p, i) => {
      if (p.kind === 1) return; // クローンは数えない
      if (!itemBallPersons.has(i) && !(this.rom && isRomItemBallScript(this.rom, p.script))) return;
      this.add({ graphicsId: p.graphicsId, movementType: p.movementType });
    });
  }

  /** 1 つ数える。 */
  add(style: ItemBallStyle): void {
    const key = `${style.graphicsId}:${style.movementType}`;
    const entry = this.counts.get(key);
    if (entry) entry.count++;
    else this.counts.set(key, { style: { ...style }, count: 1, order: this.counts.size });
  }

  /** 数えた落とし物の数。 */
  get total(): number {
    let n = 0;
    for (const e of this.counts.values()) n += e.count;
    return n;
  }

  /** いちばん多い見た目。 */
  mostCommon(): ItemBallStyle {
    let best: { style: ItemBallStyle; count: number; order: number } | null = null;
    for (const e of this.counts.values()) {
      if (!best || e.count > best.count || (e.count === best.count && e.order < best.order)) best = e;
    }
    return best ? best.style : DEFAULT_ITEM_BALL_STYLE;
  }
}
