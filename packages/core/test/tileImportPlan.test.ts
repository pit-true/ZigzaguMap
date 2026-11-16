import { describe, expect, it } from "vitest";
import { TRANSPARENT, prepareImportLayers, type ImportLayers } from "../src/index.js";
import { buildBlocks, placeBlocks, placementProblem, type PlacementTable } from "../src/tileset/import/BlockBuilder.js";
import { DOOR_TILE_START, planImport, type ImportInput, type ImportTable } from "../src/tileset/import/ImportPlan.js";

/** 色の面を直接作る（`paint(x, y)` が色か TRANSPARENT）。 */
function layersOf(width: number, height: number, ...paints: ((x: number, y: number) => number)[]): ImportLayers {
  return {
    width,
    height,
    sourceWidth: width,
    sourceHeight: height,
    padded: false,
    transparentColor: null,
    layers: paints.map((p) => Uint16Array.from({ length: width * height }, (_, i) => p(i % width, Math.floor(i / width)))),
  };
}

/** 空のタイルセット（タイル `tiles` 枚、ブロック `blocks` 個。0 番のブロックとタイルは空）。 */
function table(tiles: number, blocks: number): ImportTable {
  return { tiles: new Uint8Array(tiles * 32), palettes: new Uint16Array(256), blocks: new Uint16Array(blocks * 8), attributes: new Uint32Array(blocks) };
}

function input(layers: ImportLayers, over: Partial<ImportInput> = {}): ImportInput {
  return { layers, target: { secondary: true, isNew: false }, primary: table(640, 640), secondary: table(384, 384), ...over };
}

/** マスごとに違う色（16×16 のマスで 1 色）。 */
const byCell = (x: number, y: number): number => ((x >> 4) + (y >> 4) * 8 + 1) * 37;
/** マスの番号を 1 行目の画素の 2 色で表す（幅 320 の絵。2 色だけでマスごとに違う絵）。 */
const binCell = (x: number, y: number): number => {
  const cell = (x >> 4) + (y >> 4) * 20;
  return y % 16 === 0 && (cell >> (x % 16)) & 1 ? 1 : 2;
};

describe("ブロックの作成（#442）", () => {
  it("全部が透明のマスはブロックにせず、同じマスは 1 つにまとめる", () => {
    const l = layersOf(64, 16, (x) => (x < 16 ? TRANSPARENT : x < 48 ? 100 : 200));
    const p = planImport(input(l));
    expect(p.ok).toBe(true);
    expect(p.blocks.skipped).toBe(1);
    expect(p.blocks.merged).toBe(1);
    expect(p.built).toHaveLength(2);
    expect([...p.cellBlocks]).toEqual([-1, 0, 0, 1]);
    // 単色のタイルは 1 枚ずつ（4 マスとも同じタイル）
    expect(p.tiles.created).toBe(2);
    const q = planImport(input(l, { options: { skipEmpty: false, mergeSame: false } }));
    expect(q.built).toHaveLength(4);
  });

  it("反転で重なるタイルは 1 枚で、ブロックの指定に反転のビットが付く", () => {
    // 左右対称でない 8×8 を、右のタイルで左右反転して並べる
    const shape = (x: number, y: number): number => (x === 0 || y === 0 ? 300 : 400);
    const l = layersOf(16, 16, (x, y) => (x < 8 ? shape(x, y % 8) : shape(15 - x, y % 8)));
    const p = planImport(input(l));
    expect(p.tiles.created).toBe(1);
    expect(p.tiles.flipped).toBe(2);
    const b = p.built[0]!;
    expect(b.tiles[1]! & 0x400).toBe(0x400);
    expect(b.tiles[0]! & 0x3ff).toBe(b.tiles[1]! & 0x3ff);
  });

  it("2 枚は下と上、プレイヤーの下の指定でレイヤーの種類 1", () => {
    const l = layersOf(16, 16, () => 100, (x) => (x < 8 ? 200 : TRANSPARENT));
    const p = planImport(input(l, { options: { upperBehind: true } }));
    const b = p.built[0]!;
    expect(b.attribute).toBe(1 << 29);
    expect(b.tiles.slice(0, 4).every((v) => v === b.tiles[0])).toBe(true);
    expect(b.tiles[4]).not.toBe(b.tiles[5]);
  });

  it("3 枚はトリプルレイヤーで N と N+1 を使い、3 層の次の番号を避ける", () => {
    const sec = table(384, 384);
    sec.blocks[1 * 8] = 5; // 1 番は中身がある
    sec.attributes[3] = 3 << 28; // 3 番は 3 層なので 4 番は使えない
    sec.blocks[3 * 8] = 5;
    const l = layersOf(16, 16, () => 1, () => 2, () => 3);
    const p = planImport(input(l, { secondary: sec }));
    expect(p.ok).toBe(true);
    expect(p.built[0]!.third).not.toBeNull();
    // 0 番は空いているが 1 番が埋まっている。2 番は 3 番が埋まっている。5・6 番を使う
    expect(p.locals[0]).toBe(5);
    expect(p.result!.attributes[5]).toBe(3 << 28);
    expect(p.result!.attributes[6]).toBe(0);
    expect(p.blocks.needed).toBe(2);
  });

  it("下地の上に重ね、下地の下のレイヤーと属性を写す", () => {
    const pri = table(640, 640);
    pri.blocks.set([7, 7, 7, 7, 9, 9, 9, 9], 5 * 8);
    pri.tiles[9 * 32] = 1; // 上のレイヤーに絵がある
    pri.attributes[5] = 0x0000_0012;
    const l = layersOf(16, 16, () => 100);
    const under = planImport(input(l, { primary: pri, options: { mode: "under", baseBlock: 5 } }));
    expect(under.built[0]!.tiles.slice(0, 4)).toEqual([7, 7, 7, 7]);
    expect(under.built[0]!.attribute).toBe(0x12 | (1 << 29));
    expect(under.problems.some((p) => p.code === "baseUpper")).toBe(true);
    const over = planImport(input(l, { primary: pri, options: { mode: "over", baseBlock: 5 } }));
    expect(over.built[0]!.attribute).toBe(0x12);
  });

  it("主へ入れるときに副のタイルを使う下地は誤り", () => {
    const sec = table(384, 384);
    sec.blocks.set([0x280, 0, 0, 0], 2 * 8);
    const l = layersOf(16, 16, () => 100);
    const p = planImport(input(l, { secondary: sec, target: { secondary: false, isNew: false }, options: { mode: "under", baseBlock: 0x282 } }));
    expect(p.ok).toBe(false);
    expect(p.problems.find((x) => x.level === "error")!.code).toBe("baseSecondary");
  });
});

describe("空きの探索と上限（#442）", () => {
  it("使っているブロック・0 番・中身のあるブロックを避け、足りなければ後ろへ足す", () => {
    const pri = table(640, 4);
    pri.blocks[2 * 8] = 1;
    const l = layersOf(48, 16, byCell);
    const p = planImport(input(l, { primary: pri, target: { secondary: false, isNew: false }, blockUsed: (b) => (b === 1 ? 3 : 0) }));
    expect(p.ok).toBe(true);
    expect([...p.locals]).toEqual([3, 4, 5]);
    expect(p.blocks.after).toBe(6);
    expect(p.firstBlock).toBe(3);
  });

  it("タイルは空き（全部 0 で指されていない）を先に使い、TileCount を 16 の倍数に切り上げる", () => {
    const sec = table(16, 1);
    sec.tiles[0] = 1; // 0 番は絵がある
    sec.blocks[0] = 0x280 + 1; // 1 番は指されている
    const l = layersOf(16, 16, (x, y) => ((x >> 3) + (y >> 3) * 2 + 1) * 11);
    const p = planImport(input(l, { secondary: sec }));
    expect(p.tiles.created).toBe(4);
    expect(p.tiles.after).toBe(16);
    expect(p.result!.tileRange).toEqual([2, 6]);
    const many = planImport(input(layersOf(64, 32, (x, y) => ((x >> 3) + (y >> 3) * 8 + 1) * 3), { secondary: sec }));
    // 単色のタイルは本が違っても色番号の並びが同じなら 1 枚（32 色で 15 枚）
    expect(many.tiles.created).toBe(15);
    expect(many.tiles.after).toBe(32);
  });

  it("副ではドアのアニメの 8 タイルを空ける", () => {
    const sec = table(384, 1);
    // 空きを 376 番より後ろだけにする
    for (let i = 0; i < DOOR_TILE_START; i++) sec.tiles[i * 32] = 1;
    const l = layersOf(16, 16, () => 100);
    const p = planImport(input(l, { secondary: sec }));
    expect(p.ok).toBe(false);
    expect(p.problems.some((x) => x.code === "tilesShort")).toBe(true);
    expect(p.problems.some((x) => x.code === "doorTiles")).toBe(true);
    expect(planImport(input(l, { secondary: sec, options: { reserveDoorTiles: false } })).ok).toBe(true);
  });

  it("ブロックが上限を超えると理由が出る", () => {
    const l = layersOf(16 * 20, 16 * 20, binCell);
    const p = planImport(input(l, { secondary: table(384, 384), options: { reserveDoorTiles: false } }));
    expect(p.blocks.needed).toBe(400);
    expect(p.ok).toBe(false);
    const short = p.problems.find((x) => x.code === "blocksShort");
    expect(short?.params["short"]).toBe(400 - 384);
  });

  it("本が足りなければ paletteShortage、減色すると収まる", () => {
    // 7 本 × 15 色を超える色（マスごとに 15 色ずつ 8 マス）
    const l = layersOf(128, 16, (x, y) => (x >> 4) * 100 + ((x + y * 3) % 15) + 1);
    const pri = { target: { secondary: false, isNew: true } } as const;
    const p = planImport(input(l, pri));
    expect(p.paletteShortage).toBe(true);
    expect(p.problems.find((x) => x.code === "palettesShort")!.params).toMatchObject({ needed: 8, free: 7, short: 1 });
    const r = planImport(input(l, { ...pri, options: { reduce: true } }));
    expect(r.ok).toBe(true);
    expect(r.reduction!.changedPixels).toBeGreaterThan(0);
    expect(r.palettes.opened.length).toBeLessThanOrEqual(7);
  });

  it("使っている本は書かず、使わない本を手で外せる", () => {
    const sec = table(384, 2);
    sec.blocks[8] = 7 << 12; // 7 番の本を使っている
    const l = layersOf(16, 16, () => 100);
    expect(planImport(input(l, { secondary: sec })).palettes.opened).toEqual([8]);
    expect(planImport(input(l, { secondary: sec, options: { excludedPalettes: [8, 9] } })).palettes.opened).toEqual([10]);
  });

  it("新しいタイルセットは 0 番を空け、透明色を本の 0 番に入れる", () => {
    const l = { ...layersOf(16, 16, () => 100), transparentColor: 0x7c1f };
    const p = planImport(input(l, { target: { secondary: false, isNew: true } }));
    expect(p.ok).toBe(true);
    expect(p.locals[0]).toBe(1);
    expect(p.result!.blocks.length).toBe(16);
    expect(p.result!.palettes[0]).toBe(0x7c1f);
    expect(p.result!.tiles.length).toBe(16 * 32);
    const s = planImport(input(l, { target: { secondary: true, isNew: true } }));
    expect(s.locals[0]).toBe(0);
    expect(s.result!.palettes[7 * 16]).toBe(0x7c1f);
  });

  it("スタンプのマスは通し番号", () => {
    const l = layersOf(32, 16, (x) => (x < 16 ? 100 : TRANSPARENT));
    const p = planImport(input(l));
    expect([...p.stampCells]).toEqual([0x280, -1]);
  });

  it("512×512 の計画と減色の時間", () => {
    // タイルごとに違う並び（4 つの区画で別の 15 色。本は 4 本）と、写真のような絵（画素ごとにばらばらの色）
    let seed = 1;
    const rnd = (): number => (seed = (seed * 1103515245 + 12345) >>> 0) >>> 16;
    const pixelArt = new Uint8Array(512 * 512 * 4);
    const photo = new Uint8Array(512 * 512 * 4);
    for (let i = 0; i < 512 * 512; i++) {
      const x = i % 512;
      const y = i >> 9;
      const region = (x >> 8) + (y >> 8) * 2;
      const c = region * 15 + (rnd() % 3) + ((x >> 3) % 5) * 2;
      pixelArt.set([(c * 8) & 0xf8, (c * 40) & 0xf8, region * 64, 255], i * 4);
      photo.set([rnd() & 0xff, rnd() & 0xff, (x + y) & 0xff, 255], i * 4);
    }
    const timed = (rgba: Uint8Array, reduce: boolean): string => {
      const l = prepareImportLayers([{ width: 512, height: 512, rgba }], { transparent: null });
      const t0 = performance.now();
      const p = planImport(input(l, { target: { secondary: false, isNew: true }, options: { reduce } }));
      const ms = performance.now() - t0;
      expect(ms).toBeLessThan(5000);
      return `${ms.toFixed(0)}ms（新しいタイル ${p.tiles.created}、ブロック ${p.blocks.needed}、本 ${p.palettes.needed}、減色 ${p.reduction ? p.reduction.changedPixels : "なし"}）`;
    };
    console.log(`512x512 ドット絵: ${timed(pixelArt, false)}`);
    console.log(`512x512 写真・減色: ${timed(photo, true)}`);
  });
});

describe("置き場所を手で決める（#446）", () => {
  const t: PlacementTable = {
    blocks: Uint16Array.from({ length: 8 * 8 }, (_, i) => (Math.floor(i / 8) === 2 ? 1 : 0)),
    attributes: Uint32Array.from({ length: 8 }, (_, i) => (i === 4 ? 3 << 28 : 0)),
    capacity: 10,
    base: 0,
    used: (b) => (b === 6 ? 1 : 0),
  };
  it("置ける・置けないの判定", () => {
    expect(placementProblem(t, 0, false, false)).toBe("zero");
    expect(placementProblem(t, 1, false, false)).toBeNull();
    expect(placementProblem(t, 2, false, false)).toBe("notEmpty");
    expect(placementProblem(t, 2, false, true)).toBeNull();
    expect(placementProblem(t, 5, false, true)).toBe("tripleChild");
    expect(placementProblem(t, 6, false, false)).toBe("used");
    expect(placementProblem(t, 10, false, false)).toBe("outside");
    expect(placementProblem(t, 9, true, false)).toBe("noNext");
    expect(placementProblem(t, 1, true, false)).toBe("noNext");
    expect(placementProblem(t, 8, true, false)).toBeNull();
    expect(placementProblem(t, 1, false, false, new Set([1]))).toBe("taken");
  });

  it("手で決めた番号に置き、残りは空きへ。置き換えを数える", () => {
    const built = buildBlocks([[[1, 1, 1, 1], [2, 2, 2, 2], [3, 3, 3, 3]]], [false, false, false], 0).blocks;
    const p = placeBlocks(t, built, new Map([[1, 2]]), true);
    expect([...p.locals]).toEqual([1, 2, 3]);
    expect(p.replaced).toBe(1);
    const bad = placeBlocks(t, built, new Map([[0, 0]]));
    expect(bad.invalid).toEqual([{ block: 0, local: 0, problem: "zero" }]);
  });

  it("計画に手で決めた置き場所を渡せる", () => {
    const l = layersOf(32, 16, byCell);
    const p = planImport(input(l, { options: { placement: new Map([[0, 10], [1, 5]]) } }));
    expect([...p.locals]).toEqual([10, 5]);
    expect([...p.stampCells]).toEqual([0x280 + 10, 0x280 + 5]);
  });
});


describe("手動配置を外す", () => {
  it("外したブロックは未配置のまま残し、自動配置で戻せる", () => {
    const original = input(layersOf(16, 16, () => 100));
    const removed = planImport({ ...original, options: { placement: new Map([[0, -1]]) } });
    expect(removed.locals[0]).toBe(-1);
    expect(removed.blocks.unplaced).toBe(1);
    expect(removed.ok).toBe(false);
    expect(planImport(original).ok).toBe(true);
  });
});
