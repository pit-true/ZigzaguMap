import { describe, expect, it } from "vitest";
import { addUsedTiles, tileAnimationKeyFrames, tileAnimationLoop, tileAnimationPeriod, tileAnimationSignature, visibleTileAnimation, type TileAnimationSet } from "../src/index.js";

const track = (name: string, period: number, phase: number, frames: number) => ({
  name,
  tileStart: 0,
  tileCount: 1,
  period,
  phase,
  frames: Array.from({ length: frames }, () => new Uint8Array(32)),
});

/** 素の FR の外のタイルセット（海 2 種と花。カウンタは 640 で戻る）。 */
const field: TileAnimationSet = { callback: 1, counterMax: 640, tracks: [track("sea2", 8, 0, 8), track("sea", 16, 1, 8), track("hana", 16, 2, 5)] };
/** 噴水（120 で戻る）。 */
const fountain: TileAnimationSet = { callback: 2, counterMax: 120, tracks: [track("funsui", 12, 0, 5)] };

describe("タイルアニメの GIF の長さ（#514）", () => {
  it("トラックの 1 周がカウンタの上限で割り切れる組は、1 周の最小公倍数", () => {
    expect(tileAnimationPeriod([field])).toBe(640);
    expect(tileAnimationPeriod([fountain])).toBe(60);
    expect(tileAnimationPeriod([field, fountain])).toBe(1920);
  });

  it("割り切れない組はカウンタの上限で繰り返す。動くものが無ければ 0", () => {
    const odd: TileAnimationSet = { callback: 3, counterMax: 100, tracks: [track("x", 7, 0, 3)] };
    expect(tileAnimationPeriod([odd])).toBe(100);
    expect(tileAnimationPeriod([null, { callback: 4, counterMax: 10, tracks: [] }])).toBe(0);
    expect(tileAnimationLoop([null], 600)).toBeNull();
  });

  it("上限より長い周期は切る。始まりはカウンタが一度戻った後", () => {
    expect(tileAnimationLoop([field], 720)).toEqual({ start: 1280, length: 640, period: 640, complete: true });
    expect(tileAnimationLoop([field], 600)).toMatchObject({ length: 600, complete: false });
    expect(tileAnimationLoop([fountain], 720)).toEqual({ start: 180, length: 60, period: 60, complete: true });
  });

  it("周期だけ進めると同じ絵（つなぎ目が切れない）", () => {
    const loop = tileAnimationLoop([field], 720)!;
    for (let i = 0; i < loop.length; i += 7) expect(tileAnimationSignature([field], loop.start + i)).toBe(tileAnimationSignature([field], loop.start + i + loop.period));
  });
});

describe("変わったフレームだけをコマにする（#514）", () => {
  it("噴水は 12 フレームごとに 5 コマ、1 コマ 20/100 秒", () => {
    const frames = tileAnimationKeyFrames([fountain], tileAnimationLoop([fountain], 720)!);
    expect(frames.map((f) => f.delayCs)).toEqual([20, 20, 20, 20, 20]);
    expect(frames[0]!.frame).toBe(180);
  });

  it("長さの合計は周期の秒数。2/100 秒より短いコマは作らない", () => {
    const loop = tileAnimationLoop([field], 720)!;
    const frames = tileAnimationKeyFrames([field], loop);
    expect(frames.reduce((a, f) => a + f.delayCs, 0)).toBe(Math.round((640 * 100) / 60));
    expect(frames.every((f) => f.delayCs >= 2)).toBe(true);
    // 海（8 フレームごと）が変わる回数ぶんは少なくともある
    expect(frames.length).toBeGreaterThanOrEqual(80);
    const set = new Set(frames.map((f) => f.frame));
    expect(set.size).toBe(frames.length);
  });
});

describe("見えるアニメだけで長さを決める（#514）", () => {
  it("使うタイルに当たるトラックだけを残す", () => {
    const set: TileAnimationSet = { callback: 1, counterMax: 640, tracks: [{ ...track("a", 8, 0, 8), tileStart: 0x1d0, tileCount: 18 }, { ...track("b", 16, 2, 5), tileStart: 0x1fc, tileCount: 4 }] };
    expect(visibleTileAnimation(set, new Set([0x1fd]))?.tracks.map((t) => t.name)).toEqual(["b"]);
    expect(visibleTileAnimation(set, new Set([5]))).toBeNull();
  });

  it("ブロックの下・上と、トリプルレイヤーの 3 枚目のタイルを数える", () => {
    const blocks = new Uint16Array(3 * 8);
    blocks.set([1, 2, 3, 4, 5, 6, 7, 8], 0);
    blocks.set([9, 9, 9, 9, 10, 10, 10, 10], 8);
    blocks.set([11, 12, 13, 14, 15, 15, 15, 15], 16);
    const attributes = new Uint32Array([0, 3 << 28, 0]);
    const header = { offset: 0, isCompressed: false, isSecondary: false, tilesOffset: 0, palettesOffset: 0, blocksOffset: 0, callback: 0, attributesOffset: 0 };
    const primary = { header, tiles: new Uint8Array(0), palettes: new Uint16Array(256), blocks, attributes };
    const used = addUsedTiles(primary, primary, [1, 1], new Set());
    expect([...used].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14]);
  });
});
