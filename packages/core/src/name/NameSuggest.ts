import { matchReading, normalizeReading, readingTokens, type ReadingToken } from "./kanaReading.js";

/** 候補の元（番号と名前。名前が読めなければ null）。 */
export interface SuggestEntry {
  readonly value: number;
  readonly name: string | null;
}

/** 絞り込んだ候補。`exact` は打った文字が名前か番号とちょうど同じ。 */
export interface SuggestHit {
  readonly value: number;
  readonly name: string | null;
  readonly exact: boolean;
}

/**
 * 名前を打って候補を絞る表（#447。野生の検索の種族など）。
 * 名前の前方一致で、カタカナ・ひらがな・ローマ字（ヘボン式・訓令式）のどれでも当たる。
 * 番号は 10 進（`16`・`No.16`・`#16`）と 16 進（`0x10`・`$10`）の前方一致。
 * 読みの表は作ったときに 1 回だけ計算する（窓を開いたときに作り、閉じたら捨てる）。
 */
export class NameSuggest {
  private readonly items: { entry: SuggestEntry; tokens: readonly ReadingToken[] }[];

  constructor(entries: Iterable<SuggestEntry>) {
    this.items = [...entries].map((entry) => ({ entry, tokens: entry.name ? readingTokens(entry.name) : [] }));
  }

  /** 候補の数。 */
  get size(): number {
    return this.items.length;
  }

  /** 全部の候補（並びは渡した順）。 */
  all(): SuggestHit[] {
    return this.items.map(({ entry }) => ({ value: entry.value, name: entry.name, exact: false }));
  }

  /** 打った文字で絞る（空なら全部）。並びは渡した順。 */
  filter(query: string): SuggestHit[] {
    const q = normalizeReading(query);
    if (q === "") return this.all();
    const num = parseNumberQuery(q);
    const out: SuggestHit[] = [];
    for (const { entry, tokens } of this.items) {
      let m = tokens.length > 0 ? matchReading(q, tokens) : 0;
      if (m < 2 && num) {
        const text = num.hex ? entry.value.toString(16) : String(entry.value);
        if (text === num.digits) m = 2;
        else if (m === 0 && text.startsWith(num.digits)) m = 1;
      }
      if (m > 0) out.push({ value: entry.value, name: entry.name, exact: m === 2 });
    }
    return out;
  }

  /** 打った文字で 1 つに決まる候補（ちょうど同じものが 1 つだけのとき）。決まらなければ null。 */
  exact(query: string): SuggestHit | null {
    const hits = this.filter(query).filter((h) => h.exact);
    return hits.length === 1 ? hits[0]! : null;
  }
}

/** 番号の形の入力（`16`・`no.16`・`#16`・`0x10`・`$10`）。違えば null。 */
function parseNumberQuery(q: string): { digits: string; hex: boolean } | null {
  const hex = /^(?:0x|\$)([0-9a-f]+)$/.exec(q);
  if (hex) return { digits: stripZeros(hex[1]!), hex: true };
  const dec = /^(?:no\.?|#)?(\d+)$/.exec(q);
  return dec ? { digits: stripZeros(dec[1]!), hex: false } : null;
}

/** 頭の 0 を除く（`016` → `16`。`0` はそのまま）。 */
function stripZeros(digits: string): string {
  return digits.replace(/^0+(?=.)/, "");
}
