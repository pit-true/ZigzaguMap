import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  AnimatedTiles,
  BlockRenderer,
  BPRJ_OFFSETS,
  DOOR_CELL_LAYER,
  DOOR_TEMP_TILE,
  doorAt,
  doorStateAt,
  doorStepFrames,
  doorWaitResume,
  MapLoader,
  readDoorTable,
  renderGameScene,
  Rom,
  type DoorCellLookup,
  type DoorEvent,
  type Tileset,
} from "../src/index.js";

/** 表（2 件）と手順（素の ROM と同じ 4 段・待ち 4）を置いた小さな ROM。 */
function syntheticDoors() {
  const bytes = new Uint8Array(0x2000);
  const view = new DataView(bytes.buffer);
  const ptr = (at: number, to: number) => view.setUint32(at, 0x08000000 + to, true);
  // リテラル（表と手順の位置）。
  ptr(0x10, 0x100); ptr(0x14, 0x200); ptr(0x18, 0x220); ptr(0x1c, 0x240); ptr(0x20, 0x260);
  // 表: 1 マスのブロック 5（絵 0x400、パレット 0x300）、縦 2 マスのブロック 6（絵 0x800、パレット 0x310）。終わりは絵が NULL。
  view.setUint16(0x100, 5, true); bytes[0x103] = 0; ptr(0x104, 0x400); ptr(0x108, 0x300);
  view.setUint16(0x10c, 6, true); bytes[0x10e] = 1; bytes[0x10f] = 1; ptr(0x110, 0x800); ptr(0x114, 0x310);
  bytes.set([2, 2, 2, 2, 2, 2, 2, 2, 9, 9, 9, 9], 0x300);
  bytes.set([3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5], 0x310);
  const steps = (at: number, offsets: number[]) => offsets.forEach((o, i) => { bytes[at + i * 4] = 4; view.setUint16(at + i * 4 + 2, o, true); });
  steps(0x200, [0xffff, 0, 128, 256]); steps(0x220, [0xffff, 0, 256, 512]);
  steps(0x240, [256, 128, 0, 0xffff]); steps(0x260, [512, 256, 0, 0xffff]);
  // 絵: 段ごとに違う値。
  for (let i = 0; i < 6; i++) bytes.fill(0x10 + i, 0x400 + i * 128, 0x400 + i * 128 + 128);
  bytes.fill(0x21, 0x800, 0x800 + 768 + 256);
  const offsets = { ...BPRJ_OFFSETS, doorAnimationTablePointer: 0x10, doorOpenSequencePointers: [0x14, 0x18] as const, doorCloseSequencePointers: [0x1c, 0x20] as const };
  const table = readDoorTable(new Rom(bytes), offsets)!;
  // (2,3) は 1 マスのドア、(4,5) は縦 2 マス、(1,1) は挙動が違う、(7,7) は表に無いブロック。
  const cells: Record<string, { block: number; attribute: number }> = {
    "2,3": { block: 5, attribute: 0x69 }, "4,5": { block: 6, attribute: 0x3000_0069 }, "1,1": { block: 5, attribute: 0x6a }, "7,7": { block: 9, attribute: 0x69 },
  };
  const lookup: DoorCellLookup = (x, y) => cells[`${x},${y}`] ?? null;
  return { table, lookup };
}

it("表と手順を ROM から読み、開け閉めはそれぞれ 20 フレーム", () => {
  const { table } = syntheticDoors();
  expect(table.doors.map((d) => [d.blockId, d.tall])).toEqual([[5, false], [6, true]]);
  expect(table.open[0].map((s) => s.offset)).toEqual([null, 0, 128, 256]);
  expect(table.close[1].map((s) => s.offset)).toEqual([512, 256, 0, null]);
  expect(doorStepFrames(table.open[0])).toBe(20);
  expect(doorStepFrames(table.close[1])).toBe(20);
});

it("挙動が 0x69 でないマスと、表に無いブロックはドアにならない", () => {
  const { table, lookup } = syntheticDoors();
  expect(doorAt(table, lookup, 1, 1).reason).toBe("behavior");
  expect(doorAt(table, lookup, 7, 7).reason).toBe("unknownDoor");
  expect(doorAt(table, lookup, 9, 9).reason).toBe("behavior");
  expect(doorAt(table, lookup, 2, 3).door?.blockId).toBe(5);
  // 挙動は下位 8 ビットで見る（ATR_DoorEffectCheck の引数は u8）。
  expect(doorAt(table, lookup, 4, 5).door?.blockId).toBe(6);
});

it("開けるのは元の絵・0・1・2 番を 5 フレームずつ、最後の絵のまま残り、タスクは 20 回で消える", () => {
  const { table, lookup } = syntheticDoors();
  const events: DoorEvent[] = [{ frame: 10, kind: "open", x: 2, y: 3 }];
  const at = (f: number) => doorStateAt(table, lookup, events, f);
  expect(at(9).task).toBeNull();
  for (const f of [10, 14]) { expect(at(f).cells.size).toBe(0); expect(at(f).task?.lastFrame).toBe(29); }
  for (const [f, value] of [[15, 0x10], [19, 0x10], [20, 0x11], [25, 0x12], [29, 0x12], [80, 0x12]] as const) {
    const state = at(f);
    expect(state.tiles![0], `frame ${f}`).toBe(value);
    expect([...state.cells.get("2,3")!]).toEqual([0x2000 | 1016, 0x2000 | 1017, 0x2000 | 1018, 0x2000 | 1019, 0x2000, 0x2000, 0x2000, 0x2000]);
  }
  expect(at(28).task).not.toBeNull();
  expect(at(29).task).toBeNull();
  // 後のフレームから前へ戻っても、同じ命令から計算し直すので同じ結果。
  expect(at(16).tiles![0]).toBe(0x10);
});

it("動いている間の 2 回目は何もせず、消えた次のフレームからは受け付ける", () => {
  const { table, lookup } = syntheticDoors();
  const busy = doorStateAt(table, lookup, [{ frame: 10, kind: "open", x: 2, y: 3 }, { frame: 29, kind: "close", x: 2, y: 3 }], 60);
  expect(busy.results.map((r) => r.reason)).toEqual([null, "busy"]);
  expect(busy.cells.has("2,3")).toBe(true);
  const ok = doorStateAt(table, lookup, [{ frame: 10, kind: "open", x: 2, y: 3 }, { frame: 30, kind: "close", x: 2, y: 3 }], 30);
  expect(ok.results.map((r) => r.ok)).toEqual([true, true]);
  // 閉めるは始めたフレームに 2 番を写す。15 フレーム後に元のブロックへ戻る。
  expect(ok.tiles![0]).toBe(0x12);
  const closed = doorStateAt(table, lookup, [{ frame: 10, kind: "open", x: 2, y: 3 }, { frame: 30, kind: "close", x: 2, y: 3 }], 45);
  expect(closed.cells.size).toBe(0);
  expect(closed.task).not.toBeNull();
  expect(closed.tiles![0]).toBe(0x10);
});

it("縦 2 マスは上のマスも描き、下のマスは 4〜11 番目のパレットを使う", () => {
  const { table, lookup } = syntheticDoors();
  const state = doorStateAt(table, lookup, [{ frame: 0, kind: "open", x: 4, y: 5 }], 5);
  expect([...state.cells.get("4,4")!]).toEqual([0x3000 | 1016, 0x3000 | 1017, 0x3000 | 1018, 0x3000 | 1019, 0x4000, 0x4000, 0x4000, 0x4000]);
  expect([...state.cells.get("4,5")!]).toEqual([0x4000 | 1020, 0x4000 | 1021, 0x4000 | 1022, 0x4000 | 1023, 0x5000, 0x5000, 0x5000, 0x5000]);
});

it("アニメ無しの開け閉めはその場で最後の絵・元のブロックにする", () => {
  const { table, lookup } = syntheticDoors();
  const open = doorStateAt(table, lookup, [{ frame: 3, kind: "setOpen", x: 2, y: 3 }], 3);
  expect(open.tiles![0]).toBe(0x12);
  expect(open.task).toBeNull();
  const closed = doorStateAt(table, lookup, [{ frame: 3, kind: "setOpen", x: 2, y: 3 }, { frame: 4, kind: "setClosed", x: 2, y: 3 }], 4);
  expect(closed.cells.size).toBe(0);
  expect(doorStateAt(table, lookup, [{ frame: 0, kind: "open", x: 1, y: 1 }], 5).results[0]!.reason).toBe("behavior");
});

it("waitdooranim はタスクが消えた次のフレームから続ける", () => {
  const { table, lookup } = syntheticDoors();
  const events: DoorEvent[] = [{ frame: 10, kind: "open", x: 2, y: 3 }];
  expect(doorWaitResume(table, lookup, events, 10)).toBe(30);
  expect(doorWaitResume(table, lookup, events, 29)).toBe(30);
  expect(doorWaitResume(table, lookup, events, 40)).toBe(41);
  expect(doorWaitResume(table, lookup, [], 5)).toBe(6);
});

function tileset(): Tileset {
  const palettes = new Uint16Array(256);
  for (let p = 0; p < 16; p++) for (let c = 0; c < 16; c++) palettes[p * 16 + c] = (p << 5) | c;
  return {
    header: { offset: 0, isCompressed: false, isSecondary: false, tilesOffset: 0, palettesOffset: 0, blocksOffset: 0, callback: 0, attributesOffset: 0 },
    tiles: new Uint8Array(640 * 32).fill(0x11).fill(0, 0, 32), palettes, blocks: new Uint16Array(8), attributes: new Uint32Array(1),
  };
}

it("仮のブロックは重ね方 1 で描く（素の ROM は BG3、CFRU はふつうの重ね方で BG2）", () => {
  const { table, lookup } = syntheticDoors();
  const state = doorStateAt(table, lookup, [{ frame: 0, kind: "setOpen", x: 0, y: 0 }, { frame: 0, kind: "setOpen", x: 2, y: 3 }], 0);
  const cells = new AnimatedTiles(tileset(), tileset(), null, null);
  cells.setOverlay(DOOR_TEMP_TILE, state.tiles);
  const t = cells.at(0);
  const renderer = new BlockRenderer(t.primary, t.secondary);
  const entries = state.cells.get("2,3")!;
  // 絵（値 0x12 の色番号 2）は素の ROM では BG3、CFRU では BG2 に乗る。
  expect(renderer.renderGameCell(entries, DOOR_CELL_LAYER, 3, false)![0]).not.toBe(0);
  expect(renderer.renderGameCell(entries, DOOR_CELL_LAYER, 2, false)![3]).toBe(0);
  expect(renderer.renderGameCell(entries, DOOR_CELL_LAYER, 2, true)![3]).toBe(255);
  const view = { x: 32, y: 48, width: 16, height: 16 };
  const scene = renderGameScene(renderer, view, () => 0, [], false, (x, y) => (state.cells.get(`${x},${y}`) ? { entries: state.cells.get(`${x},${y}`)!, mode: DOOR_CELL_LAYER } : null));
  const plain = renderGameScene(renderer, view, () => 0, [], false);
  expect(scene.image.data).not.toEqual(plain.image.data);
});

const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("実 ROM のドア", () => {
  it("32 件の表と 4 つの手順を読み、ポケモンセンターとトレーナータワーのドアを見分ける", () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const table = readDoorTable(rom, BPRJ_OFFSETS)!;
    expect(table.doors).toHaveLength(32);
    expect(table.doors.filter((d) => d.tall)).toHaveLength(8);
    expect(table.doors.find((d) => d.blockId === 98)).toMatchObject({ sound: 1, tall: false });
    expect(table.doors.find((d) => d.blockId === 854)).toMatchObject({ sound: 1, tall: true });
    expect([...table.doors.find((d) => d.blockId === 683)!.palettes.slice(0, 8)]).toEqual([12, 12, 2, 2, 2, 2, 2, 2]);
    expect(table.open[0].map((s) => [s.wait, s.offset])).toEqual([[4, null], [4, 0], [4, 128], [4, 256]]);
    expect(table.open[1].map((s) => s.offset)).toEqual([null, 0, 256, 512]);
    expect(table.close[0].map((s) => s.offset)).toEqual([256, 128, 0, null]);
    expect(table.close[1].map((s) => s.offset)).toEqual([512, 256, 0, null]);
    for (const door of table.doors) for (const step of table.open[door.tall ? 1 : 0]) if (step.offset !== null) expect(table.frameTiles(door, step.offset)).not.toBeNull();
  });

  it("マサラタウンの主人公の家のドアは 1 マスのドアとして開く", () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const table = readDoorTable(rom, BPRJ_OFFSETS)!;
    const map = new MapLoader(rom, BPRJ_OFFSETS).load({ bank: 3, map: 0 });
    const lookup: DoorCellLookup = (x, y) => {
      if (x < 0 || y < 0 || x >= map.layout.width || y >= map.layout.height) return null;
      const block = map.layout.blocks[y * map.layout.width + x]! & 0x3ff;
      const ts = block < 640 ? map.primary : map.secondary;
      return { block, attribute: ts.attributes[block < 640 ? block : block - 640] ?? 0 };
    };
    const doors: string[] = [];
    for (let y = 0; y < map.layout.height; y++) for (let x = 0; x < map.layout.width; x++) if (doorAt(table, lookup, x, y).door) doors.push(`${x},${y}`);
    expect(doors.length).toBeGreaterThanOrEqual(3);
    const [x, y] = doors[0]!.split(",").map(Number) as [number, number];
    const state = doorStateAt(table, lookup, [{ frame: 0, kind: "open", x, y }], 19);
    expect(state.cells.size).toBe(1);
    expect(state.task).toBeNull();
  });
});
