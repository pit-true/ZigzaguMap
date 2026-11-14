/** 名前に使える字（GNU as のシンボル）。 */
const NAME_CHAR = /[A-Za-z0-9_.$]/;

/** `.s` の中で、名前が出てくる位置（コメントと `"..."` の中は除く）。 */
export interface LabelOccurrence {
  /** 文字の位置（0 から）。 */
  readonly from: number;
  readonly to: number;
  /** 定義（行頭の `名前:`）か。 */
  readonly definition: boolean;
}

/**
 * `.s` のテキストから、名前がそのまま 1 語として出てくる位置を探す。`@` から行末、行頭の `#`、`/* *\/`、`"..."` の中は数えない。
 * 大文字と小文字は区別する。
 */
export function findLabelOccurrences(text: string, name: string): LabelOccurrence[] {
  const out: LabelOccurrence[] = [];
  let i = 0;
  let lineStart = true;
  let block = false;
  while (i < text.length) {
    const c = text[i]!;
    if (block) {
      if (c === "*" && text[i + 1] === "/") {
        block = false;
        i += 2;
      } else {
        if (c === "\n") lineStart = true;
        i++;
      }
      continue;
    }
    if (c === "\n") {
      lineStart = true;
      i++;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      block = true;
      i += 2;
      continue;
    }
    if (c === "@" || (c === "#" && lineStart)) {
      while (i < text.length && text[i] !== "\n") i++;
      continue;
    }
    if (c === '"') {
      i++;
      while (i < text.length && text[i] !== '"' && text[i] !== "\n") i += text[i] === "\\" ? 2 : 1;
      i++;
      lineStart = false;
      continue;
    }
    if (NAME_CHAR.test(c)) {
      const start = i;
      while (i < text.length && NAME_CHAR.test(text[i]!)) i++;
      if (text.slice(start, i) === name) {
        let j = i;
        while (text[j] === " " || text[j] === "\t") j++;
        out.push({ from: start, to: i, definition: lineStart && text[j] === ":" });
      }
      lineStart = false;
      continue;
    }
    if (c !== " " && c !== "\t" && c !== "\r") lineStart = false;
    i++;
  }
  return out;
}

/** テキストの中の名前をすべて置き換える。置き換えた数も返す。 */
export function renameLabelInText(text: string, from: string, to: string): { readonly text: string; readonly count: number } {
  const hits = findLabelOccurrences(text, from);
  let out = "";
  let last = 0;
  for (const h of hits) {
    out += text.slice(last, h.from) + to;
    last = h.to;
  }
  return { text: out + text.slice(last), count: hits.length };
}

/**
 * 保存の前後のラベルの一覧から、名前の変更を見つける。消えたラベルと増えたラベルが 1 つずつなら、その組を返す。
 * それ以外（消えただけ、増えただけ、複数）は null。
 */
export function detectLabelRename(before: readonly string[], after: readonly string[]): { readonly from: string; readonly to: string } | null {
  const a = new Set(before);
  const b = new Set(after);
  const removed = [...a].filter((n) => !b.has(n));
  const added = [...b].filter((n) => !a.has(n));
  return removed.length === 1 && added.length === 1 ? { from: removed[0]!, to: added[0]! } : null;
}
