import { isExcluded, type UsageConfig, type UsageKind, type UsageRange } from "../config/UsageConfig.js";

/** 使っている場所の種類（素の ROM のスクリプト・`.s`・マップのイベント・C のソース・トレーナーの表の書き出し）。 */
export type UsageSourceKind = "rom" | "asm" | "event" | "c" | "trainers";

/** 番号を使っている場所 1 つ。 */
export interface UsageSite {
  readonly kind: UsageKind;
  readonly value: number;
  readonly source: UsageSourceKind;
  /** 場所の説明（`maps 3.0 人 2`、`assembly/overworld_scripts/a.s:12`、`ROM 0x0816A2B4（マップ 3.0）`、`src/x.c（FLAG_X）`）。 */
  readonly where: string;
  /** 行（`.s` と C。1 から）。 */
  readonly line?: number;
  /** ファイル（`.s` と C）。 */
  readonly path?: string;
  /** マップ（イベントと ROM のスクリプト）。 */
  readonly map?: { readonly bank: number; readonly map: number };
}

/** 隠しアイテムのフラグの始まり（`FLAG_HIDDEN_ITEMS_START`。フラグは 0x3E8 + 隠しアイテムの番号）。 */
export const HIDDEN_ITEM_FLAG_START = 0x3e8;
/** 隠しアイテムの番号の上限（看板の 1 バイト）。 */
export const HIDDEN_ITEM_ID_MAX = 0xff;

/**
 * 使われているフラグ・変数・隠しアイテムの番号・トレーナーの番号の索引（#227）。
 *
 * 場所は「出どころのキー」ごとに持つ（`.s` ならパス、マップのイベントならマップ、素の ROM ならマップ、C なら 1 つ）。
 * キーごとに入れ替えられるので、`.s` を保存したとき・イベントを編集したときに、その分だけ差し替える。
 * 隠しアイテムの番号はフラグ（0x3E8 + 番号）と同じものなので、どちらで使っていても両方を使用中とみなす。
 */
export class UsageIndex {
  private readonly bySource = new Map<string, readonly UsageSite[]>();
  /** 種類ごとの「番号 → 使っている場所の数」。 */
  private readonly counts: Record<UsageKind, Map<number, number>> = { flag: new Map(), var: new Map(), hiddenItem: new Map(), trainer: new Map() };

  /** 出どころの場所を入れ替える（`sites` が空なら消す）。 */
  setSource(key: string, sites: readonly UsageSite[]): void {
    const old = this.bySource.get(key);
    if (old) for (const s of old) this.bump(s, -1);
    if (sites.length === 0) this.bySource.delete(key);
    else {
      this.bySource.set(key, sites);
      for (const s of sites) this.bump(s, 1);
    }
  }

  /** 出どころを消す。 */
  removeSource(key: string): void {
    this.setSource(key, []);
  }

  /** 出どころのキー（`asm:` などの頭で絞れる）。 */
  sourceKeys(prefix = ""): string[] {
    return [...this.bySource.keys()].filter((k) => k.startsWith(prefix));
  }

  /** その番号が使われているか（隠しアイテムの番号とフラグは互いに見る）。 */
  isUsed(kind: UsageKind, value: number): boolean {
    if ((this.counts[kind].get(value) ?? 0) > 0) return true;
    if (kind === "hiddenItem") return (this.counts.flag.get(HIDDEN_ITEM_FLAG_START + value) ?? 0) > 0;
    if (kind === "flag" && value >= HIDDEN_ITEM_FLAG_START && value <= HIDDEN_ITEM_FLAG_START + HIDDEN_ITEM_ID_MAX) {
      return (this.counts.hiddenItem.get(value - HIDDEN_ITEM_FLAG_START) ?? 0) > 0;
    }
    return false;
  }

  /** その番号を使っている場所（出どころの順。隠しアイテムの番号はフラグの場所も）。 */
  find(kind: UsageKind, value: number): UsageSite[] {
    const out: UsageSite[] = [];
    const also =
      kind === "hiddenItem"
        ? { kind: "flag" as const, value: HIDDEN_ITEM_FLAG_START + value }
        : kind === "flag" && value >= HIDDEN_ITEM_FLAG_START && value <= HIDDEN_ITEM_FLAG_START + HIDDEN_ITEM_ID_MAX
          ? { kind: "hiddenItem" as const, value: value - HIDDEN_ITEM_FLAG_START }
          : null;
    for (const sites of this.bySource.values()) {
      for (const s of sites) {
        if ((s.kind === kind && s.value === value) || (also && s.kind === also.kind && s.value === also.value)) out.push(s);
      }
    }
    return out;
  }

  /** 範囲の中で使われていない最小の番号（`skip` の番号も飛ばす）。無ければ null。 */
  next(kind: UsageKind, range: UsageRange, skip: ReadonlySet<number> = new Set()): number | null {
    for (let v = range.from; v <= range.to; v++) {
      if (skip.has(v) || isExcluded(range, v) || this.isUsed(kind, v)) continue;
      return v;
    }
    return null;
  }

  /** 範囲の中で使われていない番号（小さい順、`limit` 件まで）。 */
  unused(kind: UsageKind, range: UsageRange, limit = Infinity): number[] {
    const out: number[] = [];
    for (let v = range.from; v <= range.to && out.length < limit; v++) {
      if (!isExcluded(range, v) && !this.isUsed(kind, v)) out.push(v);
    }
    return out;
  }

  /** 種類ごとの使用中の番号の数（異なる番号の数）。 */
  usedCounts(): Record<UsageKind, number> {
    return { flag: this.counts.flag.size, var: this.counts.var.size, hiddenItem: this.counts.hiddenItem.size, trainer: this.counts.trainer.size };
  }

  /** 全部の場所の数。 */
  get siteCount(): number {
    let n = 0;
    for (const s of this.bySource.values()) n += s.length;
    return n;
  }

  /** 全部消す。 */
  clear(): void {
    this.bySource.clear();
    for (const m of Object.values(this.counts)) m.clear();
  }

  private bump(site: UsageSite, delta: number): void {
    const m = this.counts[site.kind];
    const n = (m.get(site.value) ?? 0) + delta;
    if (n <= 0) m.delete(site.value);
    else m.set(site.value, n);
  }
}

/** 設定の範囲で次の未使用の番号を返す（索引と設定を組にした呼び方）。 */
export function nextUnused(index: UsageIndex, config: UsageConfig, kind: UsageKind, skip?: ReadonlySet<number>): number | null {
  return index.next(kind, config[kind], skip);
}
