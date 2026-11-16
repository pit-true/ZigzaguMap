import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { layoutMessage, MessageFont, messageAreaImage, placeholderInfo, ScriptTextCodec, type MessageItem } from "../src/index.js";

/** 字 n の絵: 左上の 1 行目の左端を文字（1）、2 画素目を影（2）にする。ほかは背景（3）。 */
function syntheticFont(kanji = false): MessageFont {
  const glyphs = new Uint8Array(0x8000).fill(0xff), widths = new Uint8Array(0x200);
  for (let code = 1; code < 0x200; code++) {
    const at = 0x200 * (code >> 3) + 0x20 * (code & 7);
    glyphs[at + 1] = 0b01_10_11_11; // 1 行目の左 4 画素（上位バイト）
    widths[code] = code < 0x60 ? 10 : 6;
  }
  widths[0x50] = 0; // 幅 0 の字（絵が無い）
  if (!kanji) return MessageFont.fromData(glyphs, widths);
  const data = new Uint8Array(0x4000).fill(0xff);
  const start = 0x1000, base = 0x10000;
  const trail = 0x9f, at = base + 0x200 * (trail >> 3) + 0x20 * (trail & 7) - (base + start);
  data[at + 0x101] = 0b01_01_01_01; // 9 行目
  return MessageFont.fromData(glyphs, widths, { data, start: base + start, bases: new Map([[0x88, base]]) });
}

const codec = ScriptTextCodec.fromCharmap("01=あ\n02=い\n50=ゐ\nA2=1\nFE=\\n\nFA=\\l\nFB=\\p\nFC 88 9F=亜\nFC 88 A0=唖\n");
const layout = (text: string, font = syntheticFont()) => layoutMessage(codec.encodeParts(text), font);
const xs = (items: readonly MessageItem[]) => items.map((item) => [item.x, item.y]);

describe("MessageFont", () => {
  it("2 ビットの絵を上位ビットから左へ読み、0 番は幅 10 の空白", () => {
    const glyph = syntheticFont().glyph(1)!;
    expect([...glyph.pixels.subarray(0, 4)]).toEqual([1, 2, 3, 3]);
    expect(glyph.width).toBe(10);
    expect(syntheticFont().glyph(0)).toMatchObject({ width: 10, blank: false });
    expect(syntheticFont().glyph(0x50)!.blank).toBe(true);
    expect(syntheticFont().glyph(0xa2, 3)!.width).toBe(10);
  });

  it("漢字は上位バイトの表から絵を読み、幅 10", () => {
    const glyph = syntheticFont(true).kanji(0x88, 0x9f)!;
    expect(glyph.width).toBe(10);
    expect([...glyph.pixels.subarray(8 * 16, 8 * 16 + 4)]).toEqual([1, 1, 1, 1]);
    expect(syntheticFont(true).kanji(0x88, 0xa0)!.blank).toBe(true);
    expect(syntheticFont(true).kanji(0x89, 0x40)).toBeNull();
    expect(syntheticFont().kanji(0x88, 0x9f)).toBeNull();
  });
});

describe("layoutMessage", () => {
  it("x 6・y 2 から字の幅 + 字間 1、改行で 15 下へ", () => {
    const [page] = layout("あい1\\nあ");
    expect(xs(page!.items)).toEqual([[6, 2], [17, 2], [28, 2], [6, 17]]);
    expect(page!.items[2]!.width).toBe(6);
  });

  it("\\p で窓を消し、\\l で 1 行上へ送り、[PAUSE_UNTIL_PRESS] で止まる", () => {
    const stops = layout("あ\\nい\\lあ\\pい[PAUSE_UNTIL_PRESS]あ");
    expect(stops.map((stop) => stop.reason)).toEqual(["scroll", "page", "wait", "end"]);
    expect(xs(stops[1]!.items)).toEqual([[6, 2], [6, 17]]);
    expect(stops[1]!.items.map((item) => item.kind === "glyph" && item.text)).toEqual(["い", "あ"]);
    expect(xs(stops[3]!.items)).toEqual([[6, 2], [17, 2]]);
  });

  it("窓の右と 3 行目にはみ出した字を知らせる", () => {
    const [page] = layout("あ".repeat(19) + "\\nあ\\nあ");
    expect(page!.overflowRight).toBe(true);
    expect(page!.overflowBelow).toBe(true);
    expect(layout("あ".repeat(18))[0]!.overflowRight).toBe(false);
  });

  it("色の切り替えは次の字から", () => {
    const [page] = layout("あ[RED]い[FC][04][01][02][03]あ");
    expect(page!.items.map((item) => item.colors)).toEqual([{ fg: 2, bg: 1, shadow: 3 }, { fg: 4, bg: 1, shadow: 3 }, { fg: 1, bg: 2, shadow: 3 }]);
  });

  it("漢字は漢字の絵、絵の無い字と charmap に無い字は補う", () => {
    const [page] = layout("亜唖ゐ★", syntheticFont(true));
    expect(page!.items.map((item) => [item.kind, item.kind === "fallback" ? item.reason : item.kind === "glyph" ? item.source : ""])).toEqual([
      ["glyph", "kanji"], ["fallback", "missing"], ["fallback", "missing"], ["fallback", "charmap"],
    ]);
    expect(page!.items.map((item) => item.kind !== "placeholder" && item.text)).toEqual(["亜", "唖", "ゐ", "★"]);
    // 漢字の絵が無い ROM では補う
    expect(layout("亜")[0]!.items[0]).toMatchObject({ kind: "fallback", reason: "missing", width: 10 });
  });

  it("プレースホルダは入りうる一番長い名前の幅の箱", () => {
    const [page] = layout("[PLAYER]あ[BUFFER1]");
    expect(page!.items.map((item) => item.kind === "placeholder" ? [item.name, item.width] : item.x)).toEqual([["PLAYER", 54], 61, ["BUFFER1", 87]]);
    expect(placeholderInfo(0x99).name).toBe("FD 99");
  });

  it("ボタンの絵と、描けないフォントへの切り替えは補う", () => {
    const [page] = layout("[A_BUTTON][SHRINK]あ[FC][06][02]あ");
    expect(page!.items.map((item) => item.kind === "fallback" ? item.reason : item.kind)).toEqual(["icon", "font", "glyph"]);
  });

  it("窓の中の画像に、文字・影・背景の色で描く", () => {
    const [page] = layout("あ");
    const palette = Array.from({ length: 16 }, (_, i) => i);
    const image = messageAreaImage(page!.items, palette);
    const blue = (x: number, y: number) => image.data[(y * 208 + x) * 4 + 2];
    // BGR555 の値 i は赤 i/31。ここでは赤だけを見る
    const red = (x: number, y: number) => image.data[(y * 208 + x) * 4];
    expect([red(6, 2), red(7, 2), red(8, 2), red(0, 0)]).toEqual([16, 24, 8, 8]);
    expect(blue(6, 2)).toBe(0);
  });
});

it.skipIf(!process.env.ZIGZAGU_TEST_ROM)("素の ROM のフォント 2 を読む（あ・空白・小さい字の幅）", async () => {
  const bytes = new Uint8Array(readFileSync(process.env.ZIGZAGU_TEST_ROM!)), before = bytes.slice();
  const font = (await MessageFont.read(async (o, n) => bytes.subarray(o, o + n), { kanji: true }))!;
  expect(font.hasKanji).toBe(false);
  expect([font.glyph(1)!.width, font.glyph(0x2f)!.width, font.glyph(0)!.width]).toEqual([10, 9, 10]);
  expect(font.glyph(1)!.blank).toBe(false);
  expect(bytes).toEqual(before);
});

describe("人物の台詞のフォント", () => {
  it("見た目の性別の表で男 4・女 5、ほかと表の外は 2", () => {
    const glyphs = new Uint8Array(0x8000).fill(0xff), widths = new Uint8Array(0x200).fill(10);
    for (const code of [1, 2]) glyphs[0x200 * (code >> 3) + 0x20 * (code & 7) + 1] = 0x7f;
    const face = { glyphs, widths: new Uint8Array(0x200).fill(7), space: 6 };
    const sexTable = Uint8Array.of(0x10, 0x33);
    const font = MessageFont.fromData(glyphs, widths, null, { kana: null }, { faces: new Map([[4, face], [5, face]]), sexTable, space: 6 });
    expect([0, 1, 2, 3, 4, 0xf0, null].map((id) => font.speakerFont(id))).toEqual([4, 5, 2, 2, 2, 2, 2]);
    expect([font.glyph(1, 4)!.width, font.glyph(0, 4)!.width, font.glyph(0, 2)!.width, font.glyph(0, 3)!.width]).toEqual([7, 6, 6, 10]);
    expect(font.glyph(1, 0)).toBeNull();
    const [page] = layoutMessage(codec.encodeParts("あい"), font, undefined, 4);
    expect(page!.items.map((item) => item.kind === "glyph" && [item.font, item.x])).toEqual([[4, 6], [4, 14]]);
  });
});

it.skipIf(!process.env.ZIGZAGU_TEST_ROM)("素の ROM のフォント 4・5 と性別の表", async () => {
  const bytes = new Uint8Array(readFileSync(process.env.ZIGZAGU_TEST_ROM!));
  const font = (await MessageFont.read(async (o, n) => bytes.subarray(o, o + n)))!;
  expect([2, 3, 4, 5].map((id) => font.hasFace(id))).toEqual([true, true, true, true]);
  expect(font.glyph(1, 4)!.pixels).not.toEqual(font.glyph(1, 2)!.pixels);
  // 0 番（主人公の男の子）は男。女の人の見た目もある
  expect(font.speakerFont(0)).toBe(4);
  expect(Array.from({ length: 152 }, (_, id) => font.speakerFont(id))).toContain(5);
});

it.skipIf(!process.env.ZIGZAGU_TEST_KANJI_ROM)("漢字対応パッチの ROM の漢字を読む", async () => {
  const bytes = new Uint8Array(readFileSync(process.env.ZIGZAGU_TEST_KANJI_ROM!));
  const font = (await MessageFont.read(async (o, n) => bytes.subarray(o, o + n), { kanji: true }))!;
  expect(font.hasKanji).toBe(true);
  for (const [lead, trail] of [[0x88, 0x9f], [0x93, 0xfa], [0x96, 0x7b], [0x81, 0x58]] as const) expect(font.kanji(lead, trail)!.blank).toBe(false);
  expect(font.kanji(0x82, 0xa0)!.blank).toBe(true);
});
