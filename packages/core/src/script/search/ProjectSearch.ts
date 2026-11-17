/**
 * スクリプトエディタの全ファイル検索（Phase7 #520）の計算。ファイルの本文の並びから、一致した行をファイルごとにまとめる。
 * ファイルの読み込みは画面の側（開いているタブの未保存の本文を優先するのも画面の側）。置換はしない。
 */

/** 探す条件（ファイルの中の検索と同じ 3 つ）。 */
export interface ProjectSearchQuery {
  readonly text: string;
  /** 大文字と小文字を区別する。 */
  readonly caseSensitive?: boolean;
  /** 正規表現として読む。 */
  readonly regexp?: boolean;
  /** 単語単位（前後が英数字と `_` でない所だけ）。 */
  readonly wholeWord?: boolean;
}

/** 一致した行 1 つ。 */
export interface ProjectSearchLine {
  /** 行（1 から）。 */
  readonly line: number;
  /** 行の文（改行を含まない）。 */
  readonly text: string;
  /** 行の中の一致した所（UTF-16 の桁。`[from, to)`）。 */
  readonly ranges: readonly (readonly [number, number])[];
}

/** ファイル 1 つの結果。 */
export interface ProjectSearchFile {
  readonly path: string;
  readonly lines: readonly ProjectSearchLine[];
}

/** 検索の結果。 */
export interface ProjectSearchResult {
  readonly files: readonly ProjectSearchFile[];
  /** 一致した行の数（上限で止めたときは上限）。 */
  readonly count: number;
  /** 上限で止めた。 */
  readonly truncated: boolean;
  /** 正しくない正規表現（そのときは結果なし）。 */
  readonly error: string | null;
}

/** 一致した行の上限。 */
export const PROJECT_SEARCH_LIMIT = 500;

const WORD = "A-Za-z0-9_";

/** 条件から正規表現を作る。正しくなければ誤りの文。空の文字は null。 */
export function projectSearchPattern(query: ProjectSearchQuery): RegExp | string | null {
  if (query.text === "") return null;
  const source = query.regexp ? query.text : query.text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = query.wholeWord ? `(?<![${WORD}])(?:${source})(?![${WORD}])` : source;
  try {
    return new RegExp(body, query.caseSensitive ? "g" : "gi");
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/**
 * ファイルの本文を探す。files の順にファイルを並べ、行の順に一致した行を出す。一致した行が limit に達したら止める。
 * 幅 0 の一致（`^` など）は位置だけを記録し、同じ行で無限に回らないよう 1 字進める。
 */
export function searchProject(files: Iterable<{ readonly path: string; readonly text: string }>, query: ProjectSearchQuery, limit = PROJECT_SEARCH_LIMIT): ProjectSearchResult {
  const pattern = projectSearchPattern(query);
  if (pattern === null) return { files: [], count: 0, truncated: false, error: null };
  if (typeof pattern === "string") return { files: [], count: 0, truncated: false, error: pattern };
  const out: ProjectSearchFile[] = [];
  let count = 0;
  for (const file of files) {
    const lines: ProjectSearchLine[] = [];
    const rows = file.text.split(/\r?\n/);
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!;
      pattern.lastIndex = 0;
      const ranges: [number, number][] = [];
      for (let m = pattern.exec(row); m; m = pattern.exec(row)) {
        ranges.push([m.index, m.index + m[0].length]);
        if (m[0].length === 0) pattern.lastIndex++;
        if (pattern.lastIndex > row.length) break;
      }
      if (ranges.length === 0) continue;
      if (count >= limit) {
        // 上限を超える行があった
        if (lines.length > 0) out.push({ path: file.path, lines });
        return { files: out, count, truncated: true, error: null };
      }
      lines.push({ line: i + 1, text: row, ranges });
      count++;
    }
    if (lines.length > 0) out.push({ path: file.path, lines });
  }
  return { files: out, count, truncated: false, error: null };
}
