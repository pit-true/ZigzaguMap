import { describe, expect, it } from "vitest";
import {
  BlockRenderer,
  MemoryProjectFs,
  fadeAt,
  isNightSection,
  isTintedMapType,
  litTilesFor,
  parseDnsConfig,
  preprocessC,
  readCArray,
  readDnsConfig,
  spritePaletteTint,
  tilesetPairPalettes,
  tintColor,
  tintOf,
  tintTilesetPalettes,
  type DnsConfig,
  type Tileset,
} from "../src/index.js";

// 本物の dns_data.h などは入れない。形だけを短く手で書いた見本。
const CONFIG_H = `
#define TIME_MORNING_START 4\t\t//4:00 AM / 4:00
#define TIME_DAY_START 8
#define TIME_EVENING_START 17
#define TIME_NIGHT_START 20
#define TIME_ENABLED //Comment this line to disable time based features.
`;

const DNS_H_CHRONOS = `#pragma once
#define DNS_COEFF_HALVE_CHANNELS 0x1F //amount: not a blend
`;

const pals = (prefix: string, on: (n: number) => boolean) =>
  Array.from({ length: 16 }, (_, n) => `#define ${prefix}${n} ${on(n) ? "TRUE" : "FALSE"}`).join("\n");

const row = (hour: number, cells: string[]) => `\t[${hour}]  = {\n${cells.map((c) => `\t\t\t{${c}},\t\t//`).join("\n")}\n\t\t   },\n`;
const same = (c: string) => Array.from({ length: 6 }, () => c);

const LIT = `
#define TILESET_PAL_FADE_END {0xFF, 0x0}

#ifndef UNBOUND //Change This

const struct SpecificTilesetFade gSpecificTilesetFades[] =
{
\t{ //Palette Town - Player's Door
\t\t.tilesetPointer = 0x8298B5C, //Tileset 1
\t\t.paletteNumToFade = 8,
\t\t.paletteIndicesToFade =
\t\t{
\t\t\t{8,  RGB(31, 31, 20)},
\t\t\t{9,  RGB(31, 31, 11)},
\t\t\tTILESET_PAL_FADE_END
\t\t},
\t},
};

#else //For Pokemon Unbound

const struct SpecificTilesetFade gSpecificTilesetFades[] =
{
\t{
\t\t.tilesetPointer = 0x8298B44,
\t\t.paletteNumToFade = 6,
\t\t.paletteIndicesToFade = { {2, RGB(31, 31, 20)}, TILESET_PAL_FADE_END },
\t},
};

#endif
`;

function dnsData(morning: string[][]): string {
  return `#pragma once
${pals("OW_BG_PAL_", (n) => n <= 12)}
${pals("OW_SPRITE_PAL_", () => true)}
#define DNS_MORNING_KEPT RGB(31, 31, 0) //the channels the morning keeps

const struct DNSPalFade gDNSNightFadingByTime[24][6] =
{
${row(0, same("RGB(1, 0, 17), 6"))}${row(3, same("RGB(1, 0, 17), 5"))}${morning.map((m, i) => row(4 + i, m)).join("")}
//Day has no fade

${row(18, ["RGB(18, 0, 11), 2", "RGB(17, 0, 12), 2", "RGB(16, 0, 13), 2", "RGB(15, 0, 14), 2", "RGB(14, 0, 15), 2", "RGB(13, 0, 16), 2"])}${row(
    21,
    ["RGB(5, 0, 21), 4", "RGB(5, 0, 21), 4", "RGB(5, 0, 21), 4", "RGB(4, 0, 20), 4", "RGB(4, 0, 20), 4", "RGB(4, 0, 20), 4"],
  )}};
${LIT}`;
}

const ND_MORNING = [4, 5, 6, 7].map((h) => Array.from({ length: 6 }, (_, n) => `RGB(0, ${Math.min(24, 6 + (h - 4) * 6 + n)}, 16), ${8 - h}`));
const CH_MORNING = [4, 5, 6, 7].map(() => same("DNS_MORNING_KEPT, DNS_COEFF_HALVE_CHANNELS"));

const CHRONOS_C = `
static const u8 sTimeOfDayHours[NUM_TIMES_OF_DAY] =
{
\t[TIME_DAY] = 12,
\t[TIME_MORNING] = 6,
\t[TIME_EVENING] = 18,
\t[TIME_NIGHT] = 21,
\t[TIME_MIDNIGHT] = 0,
};
`;
const CHRONOS_H = `
enum ChronosTimeOfDay
{
\tTIME_DAY,\t\t//default
\tTIME_MORNING,
\tTIME_EVENING,
\tTIME_NIGHT,
\tTIME_MIDNIGHT,
\tNUM_TIMES_OF_DAY,
};
`;

function config(files: Parameters<typeof parseDnsConfig>[0]): DnsConfig {
  const r = parseDnsConfig(files);
  if ("error" in r) throw new Error(`${r.error.file}:${r.error.line} ${r.error.message}`);
  return r.config;
}

const nd = () => config({ configH: CONFIG_H, dnsDataH: dnsData(ND_MORNING), dnsH: "#pragma once\n" });
const chronos = () => config({ configH: CONFIG_H, dnsDataH: dnsData(CH_MORNING), dnsH: DNS_H_CHRONOS, chronosTimeC: CHRONOS_C, chronosTimeH: CHRONOS_H });

describe("cTable（C の表の読み手）", () => {
  it("#ifndef・#else・#endif とコメントで使われない行を外し、行の番号を保つ", () => {
    const src = preprocessC("#define A 1\n#ifndef A\n#define B 2\n#else\n#define C 3 // c\n#endif\n/* x\ny */ int z;\n");
    expect([...src.defines]).toEqual([
      ["A", "1"],
      ["C", "3"],
    ]);
    expect(src.text.split("\n")).toHaveLength(9);
    expect(src.text.split("\n")[7]).toMatch(/^\s+int z;$/);
  });

  it("#if 0 と外から渡した名前の #ifdef", () => {
    const src = preprocessC("#if 0\n#define A 1\n#endif\n#ifdef OUT\n#define B 2\n#endif\n#if defined(OUT) && 1\n#define C 3\n#elif 1\n#define D 4\n#endif\n", new Map([["OUT", ""]]));
    expect([...src.defines.keys()]).toEqual(["B", "C"]);
  });

  it("指示子つきの初期化子を木にし、壊れた表は理由と行を返す", () => {
    const src = preprocessC("int t[2][2] =\n{\n  [1] = { {RGB(1, 2, 3), 4}, {.a = 5, .b = 6} },\n};\n");
    const r = readCArray(src, "t");
    expect(r && "init" in r).toBe(true);
    if (!r || !("init" in r)) return;
    const first = r.init.items[0]!;
    expect(first.index).toBe("1");
    expect(first.line).toBe(3);
    expect(typeof first.value !== "string" && first.value.items[1]!.value).toMatchObject({ items: [{ field: "a", value: "5" }, { field: "b", value: "6" }] });
    const broken = readCArray(preprocessC("int t[] =\n{\n  {1, 2}\n  {3, 4},\n};\n"), "t");
    expect(broken).toEqual({ error: "「,」か「}」が要る", line: 4 });
  });
});

describe("DnsConfig（設定の読み込み）", () => {
  it("ND 形: 4 区分（代表の時刻は 6・12・18・21 時）、表、対象のパレット、光るタイル（#ifndef UNBOUND の側）", () => {
    const c = nd();
    expect(c.clock).toBe("rtc");
    expect(c.sections).toEqual([
      { id: "morning", hour: 6, minute: 0 },
      { id: "day", hour: 12, minute: 0 },
      { id: "evening", hour: 18, minute: 0 },
      { id: "night", hour: 21, minute: 0 },
    ]);
    expect(c.starts).toEqual({ morning: 4, day: 8, evening: 17, night: 20 });
    expect(c.fades).toHaveLength(144);
    expect(fadeAt(c, 0, 0)).toEqual({ color: 1 | (17 << 10), amount: 6 });
    expect(fadeAt(c, 4, 10)).toEqual({ color: (7 << 5) | (16 << 10), amount: 4 });
    expect(fadeAt(c, 6, 0)).toEqual({ color: (18 << 5) | (16 << 10), amount: 2 });
    expect(fadeAt(c, 21, 35)).toEqual({ color: 4 | (20 << 10), amount: 4 });
    // 書かれていない行（1・2 時、8〜16 時など）は 0
    expect(fadeAt(c, 12, 0)).toEqual({ color: 0, amount: 0 });
    expect(fadeAt(c, 1, 0)).toEqual({ color: 0, amount: 0 });
    expect(c.bgPalettes).toBe(0x1fff);
    expect(c.spritePalettes).toBe(0xffff);
    expect(c.halveCoefficient).toBeNull();
    expect(c.litTiles).toEqual([
      {
        tilesetPointer: 0x08298b5c,
        palette: 8,
        colors: [
          { index: 8, color: 31 | (31 << 5) | (20 << 10) },
          { index: 9, color: 31 | (31 << 5) | (11 << 10) },
        ],
      },
    ]);
    expect(c.chronosValues).toEqual([]);
  });

  it("Chronos 形: sTimeOfDayHours の時刻で 4 区分、深夜は夜と同じ（区分を出さない）、半分の計算の係数", () => {
    const c = chronos();
    expect(c.clock).toBe("chronos");
    expect(c.sections.map((s) => [s.id, s.hour])).toEqual([
      ["morning", 6],
      ["day", 12],
      ["evening", 18],
      ["night", 21],
    ]);
    expect(c.chronosValues).toEqual(["day", "morning", "evening", "night", "night"]);
    expect(c.halveCoefficient).toBe(0x1f);
    expect(fadeAt(c, 6, 0)).toEqual({ color: 31 | (31 << 5), amount: 0x1f });
  });

  it("TIME_ENABLED が無い・ファイルが無い・表が壊れているときは理由を返す", () => {
    expect(parseDnsConfig({ configH: "#define TIME_MORNING_START 4\n", dnsDataH: "" })).toEqual({
      error: { file: "src/config.h", message: "TIME_ENABLED が定義されていない（時間帯の機能が無い）" },
    });
    expect(parseDnsConfig({ configH: null, dnsDataH: "" })).toMatchObject({ error: { file: "src/config.h" } });
    expect(parseDnsConfig({ configH: CONFIG_H, dnsDataH: null })).toMatchObject({ error: { file: "include/new/dns_data.h" } });
    const broken = parseDnsConfig({ configH: CONFIG_H, dnsDataH: "const struct DNSPalFade gDNSNightFadingByTime[24][6] =\n{\n\t[0] = {\n\t\t{RGB(1, 0), 6},\n\t},\n};\n" });
    expect(broken).toMatchObject({ error: { file: "include/new/dns_data.h", line: 4 } });
    expect(parseDnsConfig({ configH: CONFIG_H, dnsDataH: "" })).toMatchObject({ error: { message: "gDNSNightFadingByTime が無い" } });
  });

  it("プロジェクトフォルダから読む", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText("src/config.h", CONFIG_H);
    await fs.writeText("include/new/dns_data.h", dnsData(ND_MORNING));
    const r = await readDnsConfig(fs);
    expect("config" in r && r.config.sections).toHaveLength(4);
    expect(await readDnsConfig(new MemoryProjectFs())).toMatchObject({ error: { file: "src/config.h" } });
  });
});

const rgb = (r: number, g: number, b: number) => r | (g << 5) | (b << 10);

describe("DnsTint（色の計算）", () => {
  const night = { fade: { color: rgb(5, 0, 21), amount: 4 }, halveCoefficient: null };

  it("普通の計算と負の差の丸め（31 を RGB(5,0,21) へ係数 4 で混ぜると 24・23・28）", () => {
    expect(tintColor(rgb(31, 31, 31), night)).toBe(rgb(24, 23, 28));
    // 0 は黒なので変えない。成分の 0 は混ぜる色へ寄る
    expect(tintColor(rgb(0, 0, 1), night)).toBe(rgb(1, 0, 6));
    // 負の差: (0 - 3) * 4 >> 4 = -1（小さい方へ丸める）
    expect(tintColor(rgb(3, 3, 3), { fade: { color: 0, amount: 4 }, halveCoefficient: null })).toBe(rgb(2, 2, 2));
    expect(tintColor(0, night)).toBe(0);
    // 0x8000 のビットは落ちる
    expect(tintColor(0x8000 | rgb(31, 31, 31), night)).toBe(rgb(24, 23, 28));
    // 係数 0 は変えない
    expect(tintColor(rgb(7, 8, 9), { fade: { color: 0, amount: 0 }, halveCoefficient: 0x1f })).toBe(rgb(7, 8, 9));
  });

  it("半分の計算（Chronos の朝）: 混ぜる色の成分が 0 でなければそのまま、0 なら半分", () => {
    const morning = { fade: { color: rgb(31, 31, 0), amount: 0x1f }, halveCoefficient: 0x1f };
    expect(tintColor(rgb(31, 30, 31), morning)).toBe(rgb(31, 30, 15));
    expect(tintColor(rgb(1, 1, 1), morning)).toBe(rgb(1, 1, 0));
    // 半分の計算の係数が無いプロジェクト（ND）では、係数 16 は混ぜる色そのものになる
    expect(tintColor(rgb(31, 30, 31), { fade: { color: rgb(1, 2, 3), amount: 16 }, halveCoefficient: null })).toBe(rgb(1, 2, 3));
  });

  it("区分の色: 昼は変えない、夜は 21 時の 1 件", () => {
    const c = chronos();
    expect(tintOf(c, "day").fade).toEqual({ color: 0, amount: 0 });
    expect(tintOf(c, "night").fade).toEqual({ color: rgb(5, 0, 21), amount: 4 });
    expect(isNightSection(c, "night")).toBe(true);
    expect(isNightSection(c, "evening")).toBe(false);
  });

  it("マップの種類: 0・4・8・9 は変えない", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 255].map(isTintedMapType)).toEqual([false, true, true, true, false, true, true, true, false, false, true, true]);
  });

  it("パレット: 背景は 0〜12 のうち対象の本だけ。光るタイルは置き換えて計算から外す", () => {
    const base = new Uint16Array(256).fill(rgb(31, 31, 31));
    base[5] = 0;
    const lit = litTilesFor(nd(), 0x08298b44, 0x08298b5c);
    expect(lit).toHaveLength(1);
    expect(litTilesFor(nd(), 0x08298b44, 0x08298b74)).toEqual([]);
    const out = tintTilesetPalettes(base, night, 0x1fff & ~(1 << 2), lit);
    expect(out[1]).toBe(rgb(24, 23, 28));
    expect(out[5]).toBe(0);
    expect(out[2 * 16 + 1]).toBe(rgb(31, 31, 31)); // 対象外の本
    expect(out[13 * 16]).toBe(rgb(31, 31, 31)); // 13〜15 は変えない
    expect(out[8 * 16 + 8]).toBe(rgb(31, 31, 20)); // 光るタイル
    expect(out[8 * 16 + 7]).toBe(rgb(24, 23, 28));
    expect(base[1]).toBe(rgb(31, 31, 31)); // 元は変えない
  });

  it("OBJ のパレット: 対象の本だけ、黒は変えない", () => {
    const f = spritePaletteTint({ spritePalettes: 0xffff & ~(1 << 3) }, night);
    expect([...f([0, rgb(31, 31, 31)], 0)]).toEqual([0, rgb(24, 23, 28)]);
    expect([...f([rgb(31, 31, 31)], 3)]).toEqual([rgb(31, 31, 31)]);
  });

  it("ND の 144 件すべてで、式どおりの色になる", () => {
    const c = nd();
    for (let h = 0; h < 24; h++) {
      for (let m = 0; m < 60; m += 10) {
        const fade = fadeAt(c, h, m);
        const out = tintColor(rgb(20, 10, 3), { fade, halveCoefficient: null });
        const mix = (v: number, b: number) => v + (((b - v) * fade.amount) >> 4);
        expect(out).toBe(rgb(mix(20, fade.color & 31), mix(10, (fade.color >> 5) & 31), mix(3, (fade.color >> 10) & 31)));
      }
    }
  });
});

describe("BlockRenderer の時間帯の色", () => {
  // 主のタイル 0 は全部色 1、タイル 1 は全部色 2。ブロック 0 は下が色 1、上が色 2
  function tileset(colors: number[]): Tileset {
    const tiles = new Uint8Array(32 * 2);
    tiles.fill(0x11, 0, 32);
    tiles.fill(0x22, 32, 64);
    const palettes = new Uint16Array(256);
    colors.forEach((c, i) => (palettes[i] = c));
    const blocks = new Uint16Array([0, 0, 0, 0, 1, 1, 1, 1]);
    return { tiles, palettes, blocks, attributes: new Uint32Array(1), header: { blocksOffset: 0, attributesOffset: 0 } } as unknown as Tileset;
  }

  it("引数なし・昼の色（変えない）では同じ絵。上のレイヤーを透かす判定は変える前の色で比べる", () => {
    // 色 2 は色 0 と違う色だが、半分の計算で色 0 と同じ色になる → 変える前の色で比べるので、透けずに上のタイルが見える
    const p = tileset([rgb(2, 2, 0), rgb(10, 10, 10), rgb(2, 2, 1)]);
    const plain = new BlockRenderer(p, p).render(0);
    const pair = tilesetPairPalettes(p.palettes, p.palettes);
    expect(new BlockRenderer(p, p, pair).render(0)).toEqual(plain);
    const morning = { fade: { color: rgb(31, 31, 0), amount: 0x1f }, halveCoefficient: 0x1f };
    const tinted = tintTilesetPalettes(pair, morning, 0x1fff);
    expect(tinted[2]).toBe(tinted[0]);
    const image = new BlockRenderer(p, p, tinted).render(0);
    // 上のレイヤー（色 2）が描かれている = 変えた後の色 2（RGB(2,2,0)）
    expect([...image.subarray(0, 4)]).toEqual([16, 16, 0, 255]);
    expect(plain[2]).toBe(8); // 昼は青 1（8）
  });
});
