import { describe, expect, it } from "vitest";
import { NameSuggest, matchReading, normalizeReading, readingTokens, romajiReading, toHiragana, toKatakana } from "../src/index.js";

const hit = (name: string, input: string) => matchReading(normalizeReading(input), readingTokens(name));

describe("名前の読み（#447）", () => {
  it("ひらがなとカタカナを行き来する", () => {
    expect(toHiragana("フシギダネ")).toBe("ふしぎだね");
    expect(toKatakana("ぴかちゅう")).toBe("ピカチュウ");
    expect(toHiragana("リザードン")).toBe("りざーどん");
  });

  it("ヘボン式のローマ字を作る（長音・促音・拗音・撥音）", () => {
    expect(romajiReading("フシギダネ")).toBe("fushigidane");
    expect(romajiReading("ピカチュウ")).toBe("pikachuu");
    expect(romajiReading("リザードン")).toBe("rizaadon");
    expect(romajiReading("コラッタ")).toBe("koratta");
    expect(romajiReading("キャタピー")).toBe("kyatapii");
    expect(romajiReading("ジュペッタ")).toBe("jupetta");
    expect(romajiReading("マッスグマ")).toBe("massuguma");
  });

  it("カタカナ・ひらがな・ローマ字のどれでも前方に当たる", () => {
    for (const q of ["フシ", "ふし", "fushi", "husi", "FUSHI", "ﾌｼ", "ｆｕｓｈｉ", "fus", "ふsh"]) expect(hit("フシギダネ", q)).toBeGreaterThan(0);
    expect(hit("フシギダネ", "fushigidane")).toBe(2);
    expect(hit("フシギダネ", "husigidane")).toBe(2);
    expect(hit("フシギダネ", "ふしぎだね")).toBe(2);
    expect(hit("フシギダネ", "ふしぎだねx")).toBe(0);
    expect(hit("フシギダネ", "ゼニ")).toBe(0);
    expect(hit("フシギダネ", "shi")).toBe(0);
  });

  it("ヘボン式と訓令式の両方（shi/si・chi/ti・tsu/tu・fu/hu・ji/zi）", () => {
    expect(hit("ピカチュウ", "pikachuu")).toBe(2);
    expect(hit("ピカチュウ", "pikatyuu")).toBe(2);
    expect(hit("ピカチュウ", "pikachu")).toBe(1);
    expect(hit("ツチニン", "tsuchinin")).toBe(2);
    expect(hit("ツチニン", "tutinin")).toBe(2);
    expect(hit("ツチニン", "tutininn")).toBe(2);
    expect(hit("ジグザグマ", "jiguzaguma")).toBe(2);
    expect(hit("ジグザグマ", "ziguzaguma")).toBe(2);
    expect(hit("ジュペッタ", "jupetta")).toBe(2);
    expect(hit("ジュペッタ", "zyupetta")).toBe(2);
    expect(hit("ジュペッタ", "jyupetta")).toBe(2);
    expect(hit("シャワーズ", "shawaazu")).toBe(2);
    expect(hit("シャワーズ", "syawa-zu")).toBe(2);
  });

  it("長音は母音を重ねても、「-」でも、打たなくても当たる", () => {
    for (const q of ["rizaadon", "riza-don", "rizadon", "りざーどん", "りざどん"]) expect(hit("リザードン", q)).toBe(2);
    expect(hit("ドードー", "doodoo")).toBe(2);
    expect(hit("ドードー", "doudou")).toBe(2);
    expect(hit("ドードー", "dodo")).toBe(2);
    expect(hit("ゲンガー", "gengaa")).toBe(2);
  });

  it("促音（ッ）は子音を重ねる。ッチは tch・cch。xtu でも当たる", () => {
    expect(hit("コラッタ", "koratta")).toBe(2);
    expect(hit("コラッタ", "koraxtuta")).toBe(2);
    expect(hit("コラッタ", "koratt")).toBe(1);
    expect(hit("コラッタ", "kora")).toBe(1);
    expect(hit("マッチ", "matchi")).toBe(2);
    expect(hit("マッチ", "macchi")).toBe(2);
    expect(hit("マッチ", "matti")).toBe(2);
  });

  it("撥音（ン）は n・nn・n'。b・m・p の前は m でもよい", () => {
    expect(hit("ニドラン♀", "nidoran")).toBe(1);
    expect(hit("ニドラン♀", "nidoran♀")).toBe(2);
    expect(hit("ニドラン♀", "nidoranf")).toBe(2);
    expect(hit("ニドラン♂", "にどらんおす")).toBe(2);
    expect(hit("ニドラン♂", "nidoranf")).toBe(0);
    expect(hit("サンド", "sando")).toBe(2);
    expect(hit("サンド", "sanndo")).toBe(2);
    expect(hit("ナンバ", "namba")).toBe(2);
    expect(hit("ナンバ", "nanba")).toBe(2);
    expect(hit("ナンヨ", "nan'yo")).toBe(2);
  });

  it("小さい字の組み合わせ（ファ・ウィ・ティ・ヴァ・シェ）", () => {
    expect(hit("ファイヤー", "faiyaa")).toBe(2);
    expect(hit("ファイヤー", "fuxaiyaa")).toBe(2);
    expect(hit("ウィ", "wi")).toBe(2);
    expect(hit("ティ", "ti")).toBe(2);
    expect(hit("ティ", "thi")).toBe(2);
    expect(hit("ヴァ", "va")).toBe(2);
    expect(hit("シェ", "she")).toBe(2);
    expect(hit("シェ", "sye")).toBe(2);
    expect(hit("ケーシィ", "keeshii")).toBe(2);
    expect(hit("ケーシィ", "ke-si")).toBe(2);
  });
});

describe("名前の候補の絞り込み（#447）", () => {
  const list = new NameSuggest([
    { value: 1, name: "フシギダネ" },
    { value: 2, name: "フシギソウ" },
    { value: 4, name: "ヒトカゲ" },
    { value: 16, name: "ポッポ" },
    { value: 17, name: "ピジョン" },
    { value: 160, name: "オーダイル" },
    { value: 300, name: null },
  ]);
  const values = (q: string) => list.filter(q).map((h) => h.value);

  it("空なら全部、打った文字で前方一致に絞る（並びは番号の順）", () => {
    expect(values("")).toEqual([1, 2, 4, 16, 17, 160, 300]);
    expect(values("ふし")).toEqual([1, 2]);
    expect(values("fushigis")).toEqual([2]);
    expect(values("hu")).toEqual([1, 2]);
    expect(values("ぽ")).toEqual([16]);
    expect(values("zzz")).toEqual([]);
  });

  it("番号の 10 進と 16 進でも当たる", () => {
    expect(values("16")).toEqual([16, 160]);
    expect(values("No.16")).toEqual([16, 160]);
    expect(values("#016")).toEqual([16, 160]);
    expect(values("0x10")).toEqual([16]);
    expect(values("$a0")).toEqual([160]);
    expect(values("300")).toEqual([300]);
  });

  it("ちょうど同じものが 1 つなら決まる", () => {
    expect(list.exact("ポッポ")?.value).toBe(16);
    expect(list.exact("poppo")?.value).toBe(16);
    expect(list.exact("ぴじょん")?.value).toBe(17);
    expect(list.exact("pizyon")?.value).toBe(17);
    expect(list.exact("16")?.value).toBe(16);
    expect(list.exact("0x10")?.value).toBe(16);
    expect(list.exact("ふし")).toBeNull();
    expect(list.exact("odairu")?.value).toBe(160);
  });

  it("同じ名前が 2 つあれば決まらない", () => {
    const dup = new NameSuggest([
      { value: 252, name: "?" },
      { value: 253, name: "?" },
    ]);
    expect(dup.filter("?").length).toBe(2);
    expect(dup.exact("?")).toBeNull();
    expect(dup.exact("253")?.value).toBe(253);
  });
});
