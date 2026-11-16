/**
 * カタカナの名前から、ひらがなとローマ字の読みを計算で作る（#447）。読みのデータは持たない。
 *
 * 名前を「拍」（キャ・ッシ・ー など）に区切り、拍ごとに打ち方の候補（カタカナそのもの、ヘボン式、訓令式など）を並べる。
 * 打った文字がこの候補の並びの前方に当たるかを {@link matchReading} で調べる。
 */

/** 1 拍の打ち方の候補（小文字のローマ字か、カタカナ）。 */
export type ReadingToken = readonly string[];

/** 清音・濁音・半濁音の 1 字の読み（先頭がヘボン式）。 */
const BASE: Record<string, readonly string[]> = {
  ア: ["a"], イ: ["i"], ウ: ["u"], エ: ["e"], オ: ["o"],
  カ: ["ka"], キ: ["ki"], ク: ["ku"], ケ: ["ke"], コ: ["ko"],
  ガ: ["ga"], ギ: ["gi"], グ: ["gu"], ゲ: ["ge"], ゴ: ["go"],
  サ: ["sa"], シ: ["shi", "si"], ス: ["su"], セ: ["se"], ソ: ["so"],
  ザ: ["za"], ジ: ["ji", "zi"], ズ: ["zu"], ゼ: ["ze"], ゾ: ["zo"],
  タ: ["ta"], チ: ["chi", "ti"], ツ: ["tsu", "tu"], テ: ["te"], ト: ["to"],
  ダ: ["da"], ヂ: ["ji", "di", "zi"], ヅ: ["zu", "du", "dzu"], デ: ["de"], ド: ["do"],
  ナ: ["na"], ニ: ["ni"], ヌ: ["nu"], ネ: ["ne"], ノ: ["no"],
  ハ: ["ha"], ヒ: ["hi"], フ: ["fu", "hu"], ヘ: ["he"], ホ: ["ho"],
  バ: ["ba"], ビ: ["bi"], ブ: ["bu"], ベ: ["be"], ボ: ["bo"],
  パ: ["pa"], ピ: ["pi"], プ: ["pu"], ペ: ["pe"], ポ: ["po"],
  マ: ["ma"], ミ: ["mi"], ム: ["mu"], メ: ["me"], モ: ["mo"],
  ヤ: ["ya"], ユ: ["yu"], ヨ: ["yo"],
  ラ: ["ra"], リ: ["ri"], ル: ["ru"], レ: ["re"], ロ: ["ro"],
  ワ: ["wa"], ヰ: ["wi", "i"], ヱ: ["we", "e"], ヲ: ["wo", "o"],
  ヴ: ["vu"],
};

/** 小さい字（前の字とくっつく）の母音。 */
const SMALL_VOWEL: Record<string, string> = { ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o" };
const SMALL_Y: Record<string, string> = { ャ: "a", ュ: "u", ョ: "o" };
/** 小さい字を単独で打つときの読み（xa・la など）。 */
const SMALL_ALONE: Record<string, string> = { ァ: "a", ィ: "i", ゥ: "u", ェ: "e", ォ: "o", ャ: "ya", ュ: "yu", ョ: "yo", ヮ: "wa" };

const VOWELS = "aiueo";

/** 英字で打てない記号の打ち方（ニドラン♀ nidoranf / nidoranmesu）。 */
const SYMBOL: Record<string, readonly string[]> = { "♀": ["f", "mesu", "メス"], "♂": ["m", "osu", "オス"] };

/** ひらがなをカタカナにする（ゔ も含む）。 */
export function toKatakana(text: string): string {
  return text.replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

/** カタカナをひらがなにする（ー・ヴ以外の記号はそのまま）。 */
export function toHiragana(text: string): string {
  return text.replace(/[ァ-ヶ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

/** 打った文字と名前を比べる形にそろえる（全角・半角をそろえ、小文字にし、ひらがなをカタカナにする）。 */
export function normalizeReading(text: string): string {
  return toKatakana(text.normalize("NFKC").toLowerCase()).replace(/\s+/g, "");
}

/** ローマ字の子音の部分（母音を除いたもの）。 */
function consonant(romaji: string): string {
  return VOWELS.includes(romaji.at(-1) ?? "") ? romaji.slice(0, -1) : romaji;
}

/** 前の字＋小さい ャュョ の読み（キャ kya、シャ sha / sya、ジャ ja / jya / zya、フュ fyu）。 */
function withSmallY(base: readonly string[], vowel: string): string[] {
  const out: string[] = [];
  for (const b of base) {
    const c = b.endsWith("i") ? b.slice(0, -1) : consonant(b);
    if (c === "sh" || c === "ch" || c === "j") out.push(c + vowel);
    out.push(c + "y" + vowel);
  }
  return out;
}

/** 前の字＋小さい ァィゥェォ の読み（ファ fa、ウィ wi、ティ ti / thi、シェ she / sye、ヴァ va）。 */
function withSmallVowel(kana: string, base: readonly string[], vowel: string): string[] {
  if (kana === "ウ") return ["w" + vowel, "wh" + vowel];
  if (kana === "イ" && vowel === "e") return ["ye"];
  const out: string[] = [];
  for (const b of base) {
    if (b.endsWith("i")) {
      const c = b.slice(0, -1);
      if (c === "sh" || c === "ch" || c === "j") out.push(c + vowel);
      out.push(c + "y" + vowel);
    } else {
      out.push(consonant(b) + vowel);
    }
  }
  if ((kana === "テ" || kana === "デ") && vowel === "i") out.push(kana === "テ" ? "thi" : "dhi");
  if ((kana === "テ" || kana === "デ") && vowel === "u") out.push(kana === "テ" ? "thu" : "dhu");
  if (kana === "ツ") out.push("ts" + vowel);
  // 同じ母音の小さい字は、前の字だけの読みでも、伸ばした読みでもよい（ケーシィ keeshi / keesi / keeshii）
  for (const b of base) if (b.endsWith(vowel)) out.push(b, b + vowel);
  return out;
}

/** 小さい字の単独の打ち方（xa・la）を、前の字の読みの後ろに付けたもの。 */
function withSmallTyped(base: readonly string[], small: string): string[] {
  const s = SMALL_ALONE[small];
  return s ? base.flatMap((b) => [b + "x" + s, b + "l" + s]) : [];
}

/** 名前を拍に区切った、拍ごとの打ち方の候補。 */
export function readingTokens(name: string): ReadingToken[] {
  const chars = [...toKatakana(name.normalize("NFKC").toLowerCase())];
  /** 拍（カタカナと、ローマ字の候補）。ッ・ー・ンは後で前後を見て決める。 */
  const morae: { kana: string; romaji: string[] }[] = [];
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]!;
    const next = chars[i + 1] ?? "";
    const base = BASE[ch];
    if (base && SMALL_Y[next] !== undefined) {
      morae.push({ kana: ch + next, romaji: [...withSmallY(base, SMALL_Y[next]), ...withSmallTyped(base, next)] });
      i++;
    } else if (base && SMALL_VOWEL[next] !== undefined) {
      morae.push({ kana: ch + next, romaji: [...withSmallVowel(ch, base, SMALL_VOWEL[next]), ...withSmallTyped(base, next)] });
      i++;
    } else if (base) {
      morae.push({ kana: ch, romaji: [...base] });
    } else if (SMALL_ALONE[ch] !== undefined) {
      morae.push({ kana: ch, romaji: ["x" + SMALL_ALONE[ch], "l" + SMALL_ALONE[ch]] });
    } else {
      // ッ・ー・ン・記号・数字・英字は後で
      morae.push({ kana: ch, romaji: [] });
    }
  }
  const tokens: ReadingToken[] = [];
  for (let i = 0; i < morae.length; i++) {
    const m = morae[i]!;
    const after = morae[i + 1];
    if (m.kana === "ッ") {
      if (after && after.romaji.length > 0 && after.kana !== "ッ") {
        // 促音: 次の拍の子音を重ねる（ッシ sshi / ssi、ッチ cchi / tchi / tti）。xtu・ltu でも打てる。
        const doubled = new Set<string>();
        for (const r of after.romaji) {
          if (!VOWELS.includes(r[0]!)) doubled.add(r[0] + r);
          if (r.startsWith("ch")) doubled.add("t" + r);
          for (const x of ["xtu", "ltu", "xtsu", "ltsu"]) doubled.add(x + r);
        }
        tokens.push([m.kana + after.kana, ...doubled]);
        i++;
        continue;
      }
      tokens.push([m.kana, "xtu", "ltu", "xtsu", "ltsu"]);
      continue;
    }
    if (m.kana === "ー") {
      // 長音: 前の母音を重ねる、「-」、打たない。オ段は u、エ段は i でもよい（ドードー doodoo / doudou / dodo）。
      const prev = tokens.at(-1)?.find((r) => /^[a-z]/.test(r));
      const v = prev && VOWELS.includes(prev.at(-1)!) ? prev.at(-1)! : "";
      const alts = new Set<string>(["ー", "-", ""]);
      if (v) alts.add(v);
      if (v === "o") alts.add("u");
      if (v === "e") alts.add("i");
      tokens.push([...alts]);
      continue;
    }
    if (m.kana === "ン") {
      // 撥音: n・nn・n'。b・m・p の前は m でもよい（ヘボン式の古い書き方）。
      const alts = ["ン", "n", "nn", "n'"];
      const n0 = after?.romaji[0]?.[0];
      if (n0 === "b" || n0 === "m" || n0 === "p") alts.push("m");
      tokens.push(alts);
      continue;
    }
    tokens.push(m.romaji.length > 0 ? [m.kana, ...m.romaji] : [m.kana, ...(SYMBOL[m.kana] ?? [])]);
  }
  return tokens;
}

/** 前方に当たらない・前方に当たる・ちょうど全部に当たる。 */
export type ReadingMatch = 0 | 1 | 2;

/**
 * そろえた入力（{@link normalizeReading}）が、拍の並びの前方に当たるか。
 * 2: 名前の全部の読みとちょうど同じ、1: 読みの途中まで、0: 当たらない。
 */
export function matchReading(input: string, tokens: readonly ReadingToken[]): ReadingMatch {
  const memo = new Map<number, ReadingMatch>();
  const len = input.length;
  const walk = (i: number, pos: number): ReadingMatch => {
    const key = i * (len + 1) + pos;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    let best: ReadingMatch = 0;
    if (pos === len) {
      best = i === tokens.length ? 2 : 1;
      if (best === 1 && tokens[i]!.includes("")) best = Math.max(best, walk(i + 1, pos)) as ReadingMatch;
    } else if (i < tokens.length) {
      const rest = input.slice(pos);
      for (const alt of tokens[i]!) {
        let r: ReadingMatch = 0;
        if (alt.length > rest.length) r = alt.startsWith(rest) ? 1 : 0;
        else if (rest.startsWith(alt)) r = walk(i + 1, pos + alt.length);
        if (r > best) best = r;
        if (best === 2) break;
      }
    }
    memo.set(key, best);
    return best;
  };
  return walk(0, 0);
}

/** 名前のヘボン式のローマ字（表示と確かめ用。長音は前の母音を重ねる）。 */
export function romajiReading(name: string): string {
  return readingTokens(name)
    .map((t) => (t[0] === "ー" ? (t.find((r) => /^[aiueo]$/.test(r)) ?? "-") : (t.find((r) => /^[a-z]/.test(r)) ?? t[0]!)))
    .join("");
}
