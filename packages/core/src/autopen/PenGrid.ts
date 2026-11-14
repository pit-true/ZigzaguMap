/**
 * 自動ペンが読むマス（#310）。座標は描いている画面のマス（主マップの左上が原点。隣のマップの帯の上は負や大きさを超える値）。
 * マップの外（どのマップでもないマス）は null。自動ペンは「マップの外は同じ」とみなす。
 */
export interface PenSource {
  /** マスの値（u16。下位 10 ビットがブロック、上位 6 ビットが移動許可）。マップの外なら null。 */
  get(x: number, y: number): number | null;
}

/** 書くマス 1 つ。`movement` はパーツのマスに決まった値があるときだけ（無ければ描く側が決める）。 */
export interface PenWrite {
  readonly x: number;
  readonly y: number;
  readonly block: number;
  readonly movement?: number;
}

/** 座標の鍵。 */
export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** 書く予定を重ねたマス（解く間に、決めたマスを次の判定で見えるようにする）。 */
export class PenOverlay implements PenSource {
  private readonly planned = new Map<string, PenWrite>();

  constructor(private readonly source: PenSource) {}

  get(x: number, y: number): number | null {
    const base = this.source.get(x, y);
    if (base === null) return null;
    const w = this.planned.get(cellKey(x, y));
    return w ? (w.block & 0x3ff) | (base & 0xfc00) : base;
  }

  /** そのマスのブロック（マップの外なら null）。 */
  block(x: number, y: number): number | null {
    const v = this.get(x, y);
    return v === null ? null : v & 0x3ff;
  }

  /** 書く予定にする（マップの外なら何もしない）。 */
  set(write: PenWrite): void {
    if (this.source.get(write.x, write.y) === null) return;
    this.planned.set(cellKey(write.x, write.y), write);
  }

  /** 書く予定のマス（元と同じブロック・同じ移動許可のものは除く）。 */
  writes(): PenWrite[] {
    const out: PenWrite[] = [];
    for (const w of this.planned.values()) {
      const base = this.source.get(w.x, w.y);
      if (base === null) continue;
      if ((base & 0x3ff) === w.block && (w.movement === undefined || base >> 10 === w.movement)) continue;
      out.push(w);
    }
    return out;
  }
}

/** マスの集まりを `r` マス広げる（8 方向）。 */
export function dilate(cells: Iterable<readonly [number, number]>, r: number): [number, number][] {
  const seen = new Set<string>();
  const out: [number, number][] = [];
  for (const [x, y] of cells) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const k = cellKey(x + dx, y + dy);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push([x + dx, y + dy]);
      }
    }
  }
  return out;
}

/** 正の余り（くり返しの枠をマップの座標でそろえるのに使う）。 */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
