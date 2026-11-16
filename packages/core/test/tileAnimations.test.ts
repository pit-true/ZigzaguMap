import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AnimatedTiles,
  BlockRenderer,
  BPRJ_OFFSETS,
  BPRJ_TILE_ANIMATIONS,
  MapLoader,
  readTileAnimation,
  renderGameScene,
  Rom,
  TilesetReader,
  TilesetTable,
  tileAnimationBytes,
  tileAnimationFrame,
  type KnownTileAnimation,
  type Tileset,
} from "../src/index.js";

/** 定義どおりに MapBGanimeMain を回して、最後に差し替えたコマを数える（式の検算用）。 */
function simulate(max: number, period: number, phase: number, count: number, elapsed: number): number | null {
  let counter = 0;
  let shown: number | null = null;
  for (let i = 0; i < elapsed; i++) {
    counter++;
    if (counter >= max) counter = 0;
    if (counter % period === phase) shown = Math.floor(counter / period) % count;
  }
  return shown;
}

it("差し替えるフレームとコマは、カウンタを 1 ずつ進めて 0 に戻す元の処理と同じ", () => {
  const cases = [
    [640, 8, 0, 8], [640, 16, 1, 8], [640, 16, 2, 5], [120, 12, 0, 5], [160, 10, 0, 4], [256, 16, 0, 4], [240, 2, 0, 2],
    // 割り切れない最大値と、余りが周期より後ろの組も確かめる。
    [100, 7, 3, 3], [10, 4, 9, 2],
  ] as const;
  for (const [max, period, phase, count] of cases) {
    const track = { period, phase, frames: { length: count } };
    for (let elapsed = 0; elapsed <= max * 3 + 5; elapsed++) {
      expect(tileAnimationFrame(max, track, elapsed), `${max}/${period}/${phase} @${elapsed}`).toBe(simulate(max, period, phase, count, elapsed));
    }
  }
});

it("素の BPRJ の海・荒海・花は 16・8・16 フレームごとで、最初の差し替えまでは元の絵", () => {
  const [field] = BPRJ_TILE_ANIMATIONS;
  const byName = new Map(field!.tracks.map((t) => [t.name, { ...t, frames: { length: t.frameCount } }]));
  const sea = byName.get("bg_sea_anime")!, sea2 = byName.get("bg_sea2_anime")!, hana = byName.get("bg_hana_anime")!;
  // 海はカウンタ 1・17・33… で 0・1・2 番、荒海は 8・16… で 1・2 番（0 番は 0 に戻った後）、花は 2・18… で 0・1 番。
  expect(tileAnimationFrame(640, sea, 0)).toBeNull();
  expect(tileAnimationFrame(640, sea, 1)).toBe(0);
  expect(tileAnimationFrame(640, sea, 16)).toBe(0);
  expect(tileAnimationFrame(640, sea, 17)).toBe(1);
  expect(tileAnimationFrame(640, sea, 33)).toBe(2);
  expect(tileAnimationFrame(640, sea2, 7)).toBeNull();
  expect(tileAnimationFrame(640, sea2, 8)).toBe(1);
  expect(tileAnimationFrame(640, hana, 1)).toBeNull();
  expect(tileAnimationFrame(640, hana, 2)).toBe(0);
  expect(tileAnimationFrame(640, hana, 18)).toBe(1);
  expect(tileAnimationFrame(640, hana, 98)).toBe(1);
  // 640 で 0 に戻った直後は、カウンタ 0 の荒海が 0 番を出す。
  expect(tileAnimationFrame(640, sea2, 640)).toBe(0);
  expect(tileAnimationFrame(640, sea, 640)).toBe(7);
});

/** 表と絵を置いた小さな ROM。 */
function syntheticRom() {
  const bytes = new Uint8Array(0x1000);
  const view = new DataView(bytes.buffer);
  // 表 0x100: 3 コマ、それぞれ 2 タイル（64 バイト）の絵を 0x200 から。
  for (let i = 0; i < 3; i++) {
    view.setUint32(0x100 + i * 4, 0x08000200 + i * 64, true);
    bytes.fill(0x11 * (i + 1), 0x200 + i * 64, 0x200 + i * 64 + 64);
  }
  const known: KnownTileAnimation[] = [
    { callback: 0x08000081, counterMax: 30, code: [], tracks: [{ name: "test", tileStart: 2, tileCount: 2, period: 5, phase: 1, frameCount: 3, frameTable: 0x100 }] },
    { callback: 0x08000091, counterMax: 30, code: [{ start: 0, end: 16, sha1: "00" }], tracks: [] },
    { callback: 0x080000a1, counterMax: 30, code: [], tracks: [{ name: "bad", tileStart: 2, tileCount: 2, period: 5, phase: 1, frameCount: 4, frameTable: 0x100 }] },
  ];
  return { rom: new Rom(bytes), known };
}

it("関数が無い・知らない・コードが違う・表が壊れているときは動かさず理由を返す", () => {
  const { rom, known } = syntheticRom();
  expect(readTileAnimation(rom, 0, known).reason).toBe("none");
  expect(readTileAnimation(rom, 0x08001235, known).reason).toBe("unknown");
  expect(readTileAnimation(rom, 0x08000091, known).reason).toBe("code");
  expect(readTileAnimation(rom, 0x080000a1, known).reason).toBe("data");
  const ok = readTileAnimation(rom, 0x08000081, known);
  expect(ok.reason).toBeNull();
  expect(ok.set!.tracks[0]!.frames.map((f) => f[0])).toEqual([0x11, 0x22, 0x33]);
  expect(tileAnimationBytes(ok.set)).toBe(3 * 64);
});

function tileset(tileCount: number, fill: number): Tileset {
  const palettes = new Uint16Array(256);
  for (let p = 0; p < 16; p++) for (let c = 0; c < 16; c++) palettes[p * 16 + c] = c * 2;
  return {
    header: { offset: 0, isCompressed: false, isSecondary: false, tilesOffset: 0, palettesOffset: 0, blocksOffset: 0, callback: 0, attributesOffset: 0 },
    // タイル 0 は透明（上のレイヤーが指す）。
    tiles: new Uint8Array(tileCount * 32).fill(fill).fill(0, 0, 32),
    palettes,
    blocks: new Uint16Array([2, 2, 3, 3, 0, 0, 0, 0]),
    attributes: new Uint32Array([0]),
  };
}

it("表示用の写しだけを差し替え、元のタイルセットと止めた後の絵は変えない", () => {
  const { rom, known } = syntheticRom();
  const set = readTileAnimation(rom, 0x08000081, known).set!;
  const primary = tileset(4, 0x77), secondary = tileset(1, 0x00);
  const original = primary.tiles.slice();
  const tiles = new AnimatedTiles(primary, secondary, set, null);
  expect(tiles.animated).toBe(true);
  const first = tiles.at(0);
  expect(first.primary.tiles[2 * 32]).toBe(0x77);
  const second = tiles.at(1);
  expect(second.key).not.toBe(first.key);
  expect(second.primary.tiles[2 * 32]).toBe(0x11);
  expect(second.primary.tiles[3 * 32 + 31]).toBe(0x11);
  expect(second.primary.tiles[32]).toBe(0x77);
  expect(tiles.at(6).primary.tiles[2 * 32]).toBe(0x22);
  // 同じコマの組なら key は変わらない（描き手を作り直さない）。
  expect(tiles.at(7).key).toBe(tiles.at(6).key);
  expect(primary.tiles).toEqual(original);
  // 描くとアニメの絵が出る。元の描き手は元の絵のまま。
  const view = { x: 0, y: 0, width: 16, height: 16 };
  const a = tiles.at(11);
  const animated = renderGameScene(new BlockRenderer(a.primary, a.secondary), view, () => 0, [], false).image;
  const still = renderGameScene(new BlockRenderer(primary, secondary), view, () => 0, [], false).image;
  expect(animated.data.slice(0, 4)).not.toEqual(still.data.slice(0, 4));
  expect(new BlockRenderer(primary, secondary).render(0)).toEqual(new BlockRenderer(primary, secondary).render(0));
  // 0 に戻すと元の絵の写し。
  expect(tiles.at(0).primary.tiles.slice(64, 128)).toEqual(original.slice(64, 128));
  expect(tiles.copyBytes).toBe(primary.tiles.length);
});

it("ドアの一時タイルは副の 1016 番からに当て、外すと元の絵に戻る（足りないタイルは伸ばす）", () => {
  const primary = tileset(640, 0x55), secondary = tileset(10, 0x66);
  const tiles = new AnimatedTiles(primary, secondary, null, null);
  expect(tiles.animated).toBe(false);
  const door = new Uint8Array(256).fill(0x99);
  tiles.setOverlay(1016, door);
  const opened = tiles.at(0);
  expect(opened.secondary.tiles.length).toBe(384 * 32);
  expect(opened.secondary.tiles[376 * 32]).toBe(0x99);
  expect(opened.secondary.tiles[32]).toBe(0x66);
  const key = opened.key;
  tiles.setOverlay(1016, door);
  expect(tiles.at(0).key).toBe(key);
  tiles.setOverlay(1016, null);
  const closed = tiles.at(0);
  expect(closed.key).not.toBe(key);
  expect(closed.secondary.tiles[376 * 32]).toBe(0);
  expect(secondary.tiles.length).toBe(320);
});

/** 実 ROM のパス。設定されていなければ飛ばす。 */
const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("実 ROM のタイルアニメ", () => {
  it("6 つの関数のコードと表が一致し、全タイルセットの関数はこの 6 つか 0", () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const table = TilesetTable.read(rom, BPRJ_OFFSETS);
    const reader = new TilesetReader(rom);
    const callbacks = new Set<number>();
    let total = 0;
    for (const known of BPRJ_TILE_ANIMATIONS) {
      const result = readTileAnimation(rom, known.callback);
      expect(result.reason, known.callback.toString(16)).toBeNull();
      for (const track of result.set!.tracks) {
        const def = known.tracks.find((t) => t.name === track.name)!;
        expect(track.frames).toHaveLength(def.frameCount);
        for (const frame of track.frames) expect(frame.length).toBe(def.tileCount * 32);
      }
      total += tileAnimationBytes(result.set);
    }
    // 絵の合計（メモリの見積もり）。
    expect(total).toBe(12288 + 4608 + 640 + 5 * 256 + 4 * 256 + 4 * 256 + 2 * 224 + 4 * 128);
    for (let i = 0; i < table.count; i++) {
      const callback = reader.readHeader(table.pointerOf(i)! - 0x08000000).callback;
      if (callback) callbacks.add(callback);
    }
    expect([...callbacks].sort()).toEqual(BPRJ_TILE_ANIMATIONS.map((k) => k.callback).sort());
    // タマムシジムの草は 0,1,2,1 の順に絵を指す。
    const kusa = readTileAnimation(rom, 0x0806fb25).set!.tracks[0]!;
    expect(kusa.frames[1]).toEqual(kusa.frames[3]);
    expect(kusa.frames[0]).not.toEqual(kusa.frames[1]);
  });

  it("マサラタウンの海は、写しを替えると絵が変わり、元のタイルセットは変わらない", () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const map = new MapLoader(rom, BPRJ_OFFSETS).load({ bank: 3, map: 0 });
    const before = map.primary.tiles.slice();
    const set = readTileAnimation(rom, map.primary.header.callback).set;
    const tiles = new AnimatedTiles(map.primary, map.secondary, set, null);
    const sea = set!.tracks.find((t) => t.name === "bg_sea_anime")!;
    // 返す写しは次の at で上書きされるので、その都度比べる。
    expect(tiles.at(17).primary.tiles.slice(0x1a0 * 32, 0x1d0 * 32)).toEqual(sea.frames[1]);
    expect(tiles.at(33).primary.tiles.slice(0x1a0 * 32, 0x1d0 * 32)).toEqual(sea.frames[2]);
    expect(tiles.at(0).primary.tiles).toEqual(before);
    expect(map.primary.tiles).toEqual(before);
  });
});
