import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NodeProjectFs } from "../src/node/index.js";
import {
  blendChannel,
  createImage,
  drawWeatherLayer,
  requireSupportedGame,
  readProjectWhiteSandstorm,
  Rom,
  softFadeColors,
  SpriteAnimation,
  weatherBackgroundPalettes,
  weatherFadeColors,
  weatherFadeTables,
  weatherFromHeader,
  WeatherGraphics,
  WeatherSimulation,
  weatherSpriteColors,
  WEATHER,
  type WeatherObjectGraphics,
  type WeatherObjectKind,
} from "../src/index.js";

/** ROM を使わない絵（どれも 1 色で塗った絵）。 */
function fakeGraphics(options: { ashIsSandstorm?: boolean } = {}): WeatherGraphics {
  const sine = new Int16Array(320);
  for (let i = 0; i < 320; i++) sine[i] = Math.trunc(256 * Math.sin((i * Math.PI * 2) / 256));
  const sizes: Record<WeatherObjectKind, [number, number, number, boolean, number[][]]> = {
    cloud: [64, 64, 3, true, [[0, 16, -1]]],
    rain: [16, 32, 1, false, [[0, 16, -2], [8, 3, 32, 2, 40, 2, -1], [8, 3, 16, 3, 24, 4, -1]]],
    snow: [8, 8, 1, false, [[0, 16, -1], [1, 16, -1]]],
    fog: [64, 64, 2, true, [[0, 16, -1]]],
    ash: [64, 64, 1, true, [[0, 60, 64, 60, -2]]],
    fogDiagonal: [64, 64, 2, true, [[0, 16, -1]]],
    sandstorm: [64, 64, 1, true, [[0, 3, -1], [64, 3, -1]]],
    bubble: [8, 8, 1, false, [[0, 16, 1, 16, -1]]],
  };
  const objects = new Map<WeatherObjectKind, WeatherObjectGraphics>();
  for (const [kind, [width, height, priority, semi, anims]] of Object.entries(sizes) as [WeatherObjectKind, (typeof sizes)[WeatherObjectKind]][]) {
    const tileCount = kind === "snow" ? 2 : kind === "sandstorm" ? 80 : kind === "ash" ? 128 : kind === "rain" ? 48 : (width * height) / 64 + 1;
    const tiles = new Uint8Array(tileCount * 64).fill(1);
    objects.set(kind, {
      kind, tiles, tileCount, width, height, priority, semiTransparent: semi, transfer: kind === "snow",
      animation: (anim, command) => {
        const list = anims[anim];
        if (!list) return null;
        let i = 0, c = 0;
        while (i < list.length) {
          if (list[i] === -1) { if (c === command) return { kind: "end" }; i++; c++; continue; }
          if (list[i] === -2) { if (c === command) return { kind: "jump", target: 0 }; i++; c++; continue; }
          if (c === command) return { kind: "frame", frame: { index: list[i]!, hFlip: false, vFlip: false }, duration: list[i + 1]! };
          i += 2; c++;
        }
        return null;
      },
    });
  }
  const fake = Object.create(WeatherGraphics.prototype) as WeatherGraphics;
  Object.assign(fake, { sine, fadeTypes: new Uint8Array(32), commonPalette: new Uint16Array(16), ashIsSandstorm: options.ashIsSandstorm ?? false, whiteSandstormPalette: null });
  (fake as unknown as { object: (kind: WeatherObjectKind) => WeatherObjectGraphics | null }).object = (kind) => objects.get(kind) ?? null;
  return fake;
}

describe("色の段", () => {
  it("曇りの段は BG だけを 1/16 ずつ暗くし、雷の段で 31 へ近づける", () => {
    const { bg, obj } = weatherFadeTables();
    expect([bg[0 * 32 + 31], bg[1 * 32 + 31], bg[2 * 32 + 31]]).toEqual([29, 27, 25]);
    expect([obj[0 * 32 + 31], obj[2 * 32 + 16]]).toEqual([31, 16]);
    expect(bg[18 * 32 + 31]).toBe(31);
    expect(bg[18 * 32 + 20]).toBe(31);
    // 値 12 未満の暗い色は、増えた分の半分だけ明るくする
    expect(bg[18 * 32 + 0]!).toBeLessThan(bg[18 * 32 + 12]!);
    expect(weatherFadeColors([0x7fff], 3, 1)[0]).toBe(25 | (25 << 5) | (25 << 10));
    expect(weatherFadeColors([0x7fff], 3, 2)[0]).toBe(0x7fff);
    expect(weatherFadeColors([0x7fff], 0, 1)[0]).toBe(0x7fff);
  });

  it("霧の人物の色、BG の 13〜15 番、半透明の合成", () => {
    expect(softFadeColors([0], 12, 0x73fc)[0]).toBe(21 | (23 << 5) | (21 << 10));
    const palettes = new Uint16Array(256).fill(0x7fff);
    const effect = { evy: 3, fogTint: false, cfru: true, fadeTypes: new Uint8Array(32) };
    const out = weatherBackgroundPalettes(palettes, effect);
    expect(out[12 * 16]).not.toBe(0x7fff);
    expect(out[13 * 16]).toBe(0x7fff);
    expect(weatherSpriteColors([0x7fff], 0, effect)[0]).toBe(0x7fff);
    const vanilla = { ...effect, cfru: false, fadeTypes: Uint8Array.from([...Array(16).fill(1), 2, 1, ...Array(14).fill(2)]) };
    expect(weatherSpriteColors([0x7fff], 1, vanilla)[0]).not.toBe(0x7fff);
    expect(weatherSpriteColors([0x7fff], 0, vanilla)[0]).toBe(0x7fff);
    expect(blendChannel(31, 31, 12, 8)).toBe(31);
    expect(blendChannel(16, 8, 12, 8)).toBe(16);
    expect(blendChannel(10, 20, 4, 16)).toBe(22);
  });

  it("ヘッダーの値の変換（20・21 は周期、範囲外はなし）", () => {
    expect([0, 3, 14, 15, 20, 21].map(v => weatherFromHeader(v))).toEqual([0, 3, 14, 0, 2, 2]);
    expect([0, 1, 2, 3].map(c => weatherFromHeader(20, c))).toEqual([2, 3, 5, 3]);
  });
});

describe("動き", () => {
  it("雨はマップに入った時点で 10 粒、1 フレームで (-0x68, 0xD0)/16 だけ動き、段 3 になる", () => {
    const sim = new WeatherSimulation(fakeGraphics());
    sim.startDirect(WEATHER.RAIN);
    expect(sim.screen.evy).toBe(3);
    expect(sim.actors.filter(a => a.kind === "rain")).toHaveLength(24);
    let shown = 0;
    for (let f = 0; f < 200; f++) { sim.step(); shown = Math.max(shown, sim.draws().length); }
    expect(shown).toBeGreaterThan(3);
    expect(shown).toBeLessThanOrEqual(10);
    const drop = sim.actors.find(a => a.work[4] === 0 && a.work[0]! > 2)!;
    const [x, y] = [drop.work[2]!, drop.work[3]!];
    sim.step();
    expect([drop.work[2]! - x, drop.work[3]! - y]).toEqual([-0x68, 0xd0]);
  });

  it("雨粒の並びは粒ごとの式で決まり、乱数の種によらない", () => {
    const a = new WeatherSimulation(fakeGraphics(), 1), b = new WeatherSimulation(fakeGraphics(), 99);
    a.startDirect(WEATHER.HEAVY_RAIN); b.startDirect(WEATHER.HEAVY_RAIN);
    for (let f = 0; f < 120; f++) { a.step(); b.step(); }
    expect(a.draws()).toEqual(b.draws());
    expect(a.draws().length).toBeGreaterThan(10);
  });

  it("雷は段 19 まで光って段 3 へ戻る。同じ種なら同じ時に光る", () => {
    const run = (seed: number) => {
      const sim = new WeatherSimulation(fakeGraphics(), seed);
      sim.startDirect(WEATHER.THUNDER);
      const levels: number[] = [];
      for (let f = 0; f < 2400; f++) { sim.step(); levels.push(sim.screen.evy); }
      return levels;
    };
    const levels = run(7);
    expect(Math.max(...levels)).toBe(19);
    expect(levels[levels.length - 1]! >= 3).toBe(true);
    expect(levels.filter(v => v > 3 && v < 19).length).toBeGreaterThan(0);
    expect(run(7)).toEqual(levels);
  });

  it("霧は 20 枚・合成 12/8 で、4 フレームに 1px 左へ流れる", () => {
    const sim = new WeatherSimulation(fakeGraphics());
    sim.startDirect(WEATHER.FOG);
    expect([sim.eva, sim.evb]).toEqual([12, 8]);
    sim.step();
    const before = sim.draws()[0]!.x;
    for (let f = 0; f < 8; f++) sim.step();
    expect(sim.draws()).toHaveLength(20);
    expect(sim.draws()[0]!.x).toBe(before - 2);
    sim.camera(16, 0);
    sim.step();
    expect(sim.draws()[0]!.x).toBeLessThan(before - 10);
  });

  it("薄い霧と水中は 4/16、水中は泡が上がって 120 フレームで消える", () => {
    const sim = new WeatherSimulation(fakeGraphics());
    sim.startDirect(WEATHER.BUBBLES);
    expect([sim.eva, sim.evb]).toEqual([4, 16]);
    for (let f = 0; f < 60; f++) sim.step();
    const bubble = sim.actors.find(a => a.kind === "bubble")!;
    const y = bubble.y;
    sim.step();
    expect(bubble.y).toBe(y - 3);
    for (let f = 0; f < 130; f++) sim.step();
    expect(bubble.removed).toBe(true);
  });

  it("砂嵐は 20 枚と渦 5 個、合成 16/0。7 番は置き換えがあれば砂嵐になる", () => {
    const sim = new WeatherSimulation(fakeGraphics());
    sim.startDirect(WEATHER.SANDSTORM);
    expect([sim.eva, sim.evb]).toEqual([16, 0]);
    expect(sim.actors.filter(a => a.width === 32)).toHaveLength(5);
    const ash = new WeatherSimulation(fakeGraphics());
    ash.startDirect(WEATHER.ASH);
    expect(ash.actors).toHaveLength(20);
    expect(ash.actors.every(a => a.kind === "ash")).toBe(true);
    const white = new WeatherSimulation(fakeGraphics({ ashIsSandstorm: true }));
    white.startDirect(WEATHER.ASH);
    expect(white.actors.filter(a => a.kind === "sandstorm")).toHaveLength(25);
  });

  it("雪は 36 フレームごとに増え、寿命で隠れる（ROM どおり戻らない）", () => {
    const sim = new WeatherSimulation(fakeGraphics(), 3);
    sim.changeSmooth(WEATHER.SNOW);
    for (let f = 0; f < 40; f++) sim.step();
    expect(sim.actors.filter(a => a.kind === "snow")).toHaveLength(1);
    expect(sim.screen.evy).toBeLessThan(3);
    for (let f = 0; f < 100; f++) sim.step();
    expect(sim.screen.evy).toBe(3);
  });

  it("雨から晴れへの切り替えは粒を減らしてから消し、段を 20 フレームに 1 つ戻す", () => {
    const sim = new WeatherSimulation(fakeGraphics());
    sim.startDirect(WEATHER.RAIN);
    sim.changeSmooth(WEATHER.SUNNY);
    let frames = 0;
    while (sim.status !== WEATHER.SUNNY && frames < 1000) { sim.step(); frames++; }
    expect(frames).toBeGreaterThan(50);
    expect(sim.actors).toHaveLength(0);
    for (let f = 0; f < 70; f++) sim.step();
    expect(sim.screen.evy).toBe(0);
  });
});

describe("重ね方", () => {
  it("先の絵が手前に残り、半透明は下の画素と混ぜる。OAM は 9bit で折り返す", () => {
    const graphics = fakeGraphics();
    const fog = graphics.object("fog")!, rain = graphics.object("rain")!;
    const image = createImage(240, 160);
    for (let i = 0; i < image.data.length; i += 4) image.data.set([16 << 3, 0, 0, 255], i);
    const colors = new Uint16Array(16); colors[1] = 31;
    drawWeatherLayer(image, [
      { draw: { kind: "rain", x: 0, y: 0, width: 16, height: 32, frame: 0, priority: 1 }, graphics: rain, colors: Uint16Array.from([0, 5]) },
      { draw: { kind: "fog", x: 0, y: 0, width: 64, height: 64, frame: 0, priority: 2 }, graphics: fog, colors },
      { draw: { kind: "fog", x: 500, y: 100, width: 64, height: 64, frame: 0, priority: 2 }, graphics: fog, colors },
    ], 12, 8);
    const px = (x: number, y: number) => [...image.data.slice((y * 240 + x) * 4, (y * 240 + x) * 4 + 3)];
    expect(px(0, 0)).toEqual([(5 << 3) | 1, 0, 0]);
    const blended = blendChannel(31, 16, 12, 8);
    expect(px(20, 10)).toEqual([(blended << 3) | (blended >> 2), 0, 0]);
    expect(px(30, 120)[0]).toBe((blended << 3) | (blended >> 2));
    expect(px(60, 120)[0]).toBe(16 << 3);
  });
});

it("SpriteAnimation の END を finished で返す", () => {
  const anim = new SpriteAnimation((_, c) => (c === 0 ? { kind: "frame", frame: { index: 1, hFlip: false, vFlip: false }, duration: 2 } : { kind: "end" }));
  anim.tick();
  expect(anim.finished).toBe(false);
  anim.tick(); anim.tick();
  expect(anim.finished).toBe(true);
});

it.skipIf(!process.env.ZIGZAGU_TEST_ROM)("実ROMの天候の絵と表を読む", () => {
  const rom = new Rom(new Uint8Array(readFileSync(process.env.ZIGZAGU_TEST_ROM!)));
  const o = requireSupportedGame(rom).offsets;
  const g = WeatherGraphics.read(rom, o.weather);
  expect(g.ashIsSandstorm).toBe(false);
  expect([...g.fadeTypes.slice(13, 18)]).toEqual([0, 0, 0, 2, 1]);
  expect([g.sine[0], g.sine[3], g.sine[64]]).toEqual([0, 18, 256]);
  const expectations: Record<WeatherObjectKind, [number, number, number, boolean, number]> = {
    cloud: [64, 64, 3, true, 64], rain: [16, 32, 1, false, 48], snow: [8, 8, 1, false, 2], fog: [64, 64, 2, true, 64],
    ash: [64, 64, 1, true, 128], fogDiagonal: [64, 64, 2, true, 64], sandstorm: [64, 64, 1, true, 80], bubble: [8, 8, 2, false, 2],
  };
  for (const [kind, [w, h, priority, semi, tiles]] of Object.entries(expectations) as [WeatherObjectKind, (typeof expectations)[WeatherObjectKind]][]) {
    const obj = g.object(kind)!;
    expect([obj.width, obj.height, obj.priority, obj.semiTransparent, obj.tileCount], kind).toEqual([w, h, priority, semi, tiles]);
    expect(obj.tiles.some(v => v > 0), kind).toBe(true);
  }
  expect(g.palette("cloud", 1)).not.toEqual(g.palette("rain", 3));
  expect(g.palette("sandstorm", 8)![1]).toBe(18335);
  for (const weather of [1, 3, 4, 5, 6, 7, 8, 9, 10, 13, 14]) {
    const sim = new WeatherSimulation(g, 1);
    sim.startDirect(weather);
    for (let f = 0; f < 300; f++) sim.step();
    if (weather !== 4) expect(sim.draws().length, String(weather)).toBeGreaterThan(0);
  }
});

it.skipIf(!process.env.ZIGZAGU_CFRU_ROM)("CFRU の ROM では 7 番が白い砂嵐になる", async () => {
  const rom = new Rom(new Uint8Array(readFileSync(process.env.ZIGZAGU_CFRU_ROM!)));
  const g = WeatherGraphics.read(rom, requireSupportedGame(rom).offsets.weather);
  expect(g.ashIsSandstorm).toBe(true);
  expect(g.whiteSandstormPalette).not.toBeNull();
  expect(g.palette("sandstorm", 7)).not.toEqual(g.palette("sandstorm", 8));
  for (const kind of ["cloud", "rain", "snow", "fog", "ash", "fogDiagonal", "sandstorm", "bubble"] as const) expect(g.object(kind), kind).not.toBeNull();
  if (process.env.ZIGZAGU_CFRU_PROJECT) {
    // ROM のフックから引いた色と、プロジェクトの PNG の色が同じ。
    const project = await readProjectWhiteSandstorm(new NodeProjectFs(process.env.ZIGZAGU_CFRU_PROJECT));
    expect(project.enabled).toBe(true);
    expect([...project.palette!]).toEqual([...g.whiteSandstormPalette!]);
  }
});
