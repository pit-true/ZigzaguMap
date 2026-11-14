import type { MapId } from "@zigzagumap/core";

/** 探すときの比べ方にそろえる（全角の英数字を半角に、カタカナをひらがなに、空白を外し、小文字に）。 */
export function normalizeForFind(text: string): string {
  return text
    .normalize("NFKC")
    .replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60))
    .replace(/\s+/g, "")
    .toLowerCase();
}

/** 探す相手（マップ一覧の情報）。 */
export interface FindableMap {
  readonly id: MapId;
  readonly name: string | null;
}

/** 候補 1 件。 */
export interface FindCandidate {
  readonly id: MapId;
  readonly name: string | null;
  /** 一覧に出す文（「3.0 マサラタウン」）。 */
  readonly text: string;
}

/**
 * マップ名（日本語）と「バンク.マップ」の部分一致で候補を出す（#237）。空白で区切ると、どの語も合うものだけ（「ときわ ぽけせん」）。
 * 番号が前から合うもの・名前が前から合うものを先に、あとは番号の順。空の問い合わせなら空。
 */
export function findMaps(maps: readonly FindableMap[], query: string, limit = 50): FindCandidate[] {
  const terms = query
    .normalize("NFKC")
    .split(/\s+/)
    .map(normalizeForFind)
    .filter((t) => t !== "");
  if (terms.length === 0) return [];
  const first = terms[0]!;
  const scored: { m: FindableMap; score: number }[] = [];
  for (const m of maps) {
    const number = `${m.id.bank}.${m.id.map}`;
    const name = m.name ? normalizeForFind(m.name) : "";
    if (!terms.every((t) => name.includes(t) || number.includes(t))) continue;
    let score = 4;
    if (number === first) score = 0;
    else if (number.startsWith(first)) score = 1;
    else if (name.startsWith(first)) score = 2;
    else if (name.includes(first)) score = 3;
    scored.push({ m, score });
  }
  scored.sort((a, b) => a.score - b.score || a.m.id.bank - b.m.id.bank || a.m.id.map - b.m.id.map);
  return scored.slice(0, limit).map(({ m }) => ({ id: m.id, name: m.name, text: `${m.id.bank}.${m.id.map}${m.name ? ` ${m.name}` : ""}` }));
}

/** 一覧の項目の文が問い合わせに合うか（マップ一覧の絞り込み）。 */
export function labelMatches(label: string, query: string): boolean {
  const text = normalizeForFind(label);
  return query
    .normalize("NFKC")
    .split(/\s+/)
    .map(normalizeForFind)
    .every((t) => t === "" || text.includes(t));
}
