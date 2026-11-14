/**
 * マップ一覧の絞り込みの書式（#305。Bochi のマップ検索と同じ書き方）。
 * - `場所:58,7E` … 地名（タウンマップの区画）の番号。16 進で、`,` で区切って複数。
 * - `地形:9` … 配置（レイアウト）の番号。16 進で、複数可。
 * - ほかの語は今までどおり、マップ名と「(バンク.マップ)」の部分一致。並べて書くと、どれにも合うマップだけを出す。
 * `0x` は付けても付けなくてもよく、全角の `：` と `、` も使える。値が読めない語は、ふつうの語として扱う。
 */
export interface MapTreeQuery {
  /** 名前の部分一致に使う残りの語（空なら名前では絞らない）。 */
  readonly text: string;
  /** 地名の番号（無ければ null）。 */
  readonly regions: readonly number[] | null;
  /** 配置の番号（無ければ null）。 */
  readonly layouts: readonly number[] | null;
}

/** 絞り込みに使うマップの情報。 */
export interface QueryableMap {
  readonly region: number;
  readonly layoutId: number;
}

const SPECIAL = /^(場所|地形)[:：](.+)$/;

/** 入力を読む。 */
export function parseMapTreeQuery(input: string): MapTreeQuery {
  const rest: string[] = [];
  let regions: number[] | null = null;
  let layouts: number[] | null = null;
  for (const token of input.trim().split(/\s+/)) {
    if (token === "") continue;
    const m = SPECIAL.exec(token.normalize("NFKC").replace(/、/g, ","));
    const values = m ? m[2]!.split(",").filter((v) => v !== "").map(parseHex) : [];
    if (!m || values.length === 0 || values.some((v) => v === null)) {
      rest.push(token);
      continue;
    }
    const list = values as number[];
    if (m[1] === "場所") regions = [...(regions ?? []), ...list];
    else layouts = [...(layouts ?? []), ...list];
  }
  return { text: rest.join(" "), regions, layouts };
}

/** 特別な語（場所・地形）を含むか。 */
export function hasSpecialTerms(q: MapTreeQuery): boolean {
  return q.regions !== null || q.layouts !== null;
}

/** 特別な語に合うか（名前の語は見ない）。 */
export function matchesSpecialTerms(map: QueryableMap, q: MapTreeQuery): boolean {
  if (q.regions && !q.regions.includes(map.region)) return false;
  if (q.layouts && !q.layouts.includes(map.layoutId)) return false;
  return true;
}

/** 地名の番号で絞る語（タウンマップの小窓から一覧を絞るとき。#306）。 */
export function regionQuery(region: number): string {
  return `場所:${region.toString(16).toUpperCase().padStart(2, "0")}`;
}

function parseHex(text: string): number | null {
  const t = text.replace(/^0x/i, "");
  return /^[0-9a-f]{1,4}$/i.test(t) ? parseInt(t, 16) : null;
}
