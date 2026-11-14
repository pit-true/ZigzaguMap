import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { DEFAULT_ITEM_BALL_STYLE, EventReader, ItemBallStyleCounter, MapLoader, Rom, isRomItemBallScript, requireSupportedGame, type MapEvents, type PersonEvent } from "../src/index.js";

function person(over: Partial<PersonEvent>): PersonEvent {
  return {
    localId: 1,
    graphicsId: 0,
    kind: 0,
    padding1: 0,
    x: 0,
    y: 0,
    elevation: 3,
    movementType: 8,
    movementRangeX: 0,
    movementRangeY: 0,
    padding2: 0,
    trainerType: 0,
    trainerRangeOrBerryTree: 0,
    script: 0,
    flag: 0,
    padding3: 0,
    ...over,
  } as PersonEvent;
}

function events(persons: PersonEvent[]): MapEvents {
  return { persons, warps: [], traps: [], signs: [] };
}

describe("落とし物の見た目（#304）", () => {
  const bytes = new Uint8Array(0x1000);
  // 0x100: finditem（落とし物）、0x200: msgbox など別のスクリプト
  bytes.set([0x1a, 0x00, 0x80, 0x44, 0x00, 0x1a, 0x01, 0x80, 0x01, 0x00, 0x09, 0x01, 0x02], 0x100);
  bytes.set([0x6a, 0x5a, 0x0f, 0x00], 0x200);
  const rom = new Rom(bytes);

  it("finditem の並びだけを落とし物のスクリプトとみなす", () => {
    expect(isRomItemBallScript(rom, 0x08000100)).toBe(true);
    expect(isRomItemBallScript(rom, 0x08000200)).toBe(false);
    expect(isRomItemBallScript(rom, 0x08000ff8)).toBe(false);
    expect(isRomItemBallScript(rom, 0)).toBe(false);
  });

  it("ROM のスクリプトと maps\\ の落とし物を数え、いちばん多いものを返す", () => {
    const c = new ItemBallStyleCounter(rom);
    c.addMap(events([person({ graphicsId: 92, movementType: 8, script: 0x08000100 }), person({ graphicsId: 30, script: 0x08000200 })]));
    c.addMap(events([person({ graphicsId: 93, movementType: 9, script: 0 }), person({ graphicsId: 93, movementType: 9, script: 0 })]), new Set([0, 1]));
    // クローンは数えない
    c.addMap(events([person({ graphicsId: 92, movementType: 8, kind: 1, script: 0x08000100 })]));
    expect(c.total).toBe(3);
    expect(c.mostCommon()).toEqual({ graphicsId: 93, movementType: 9 });
  });

  it("同じ数なら先に数えたもの、無ければ既定", () => {
    expect(new ItemBallStyleCounter(rom).mostCommon()).toEqual(DEFAULT_ITEM_BALL_STYLE);
    const c = new ItemBallStyleCounter(null);
    c.add({ graphicsId: 1, movementType: 2 });
    c.add({ graphicsId: 3, movementType: 4 });
    expect(c.mostCommon()).toEqual({ graphicsId: 1, movementType: 2 });
  });
});

const romPath = process.env.ZIGZAGU_TEST_ROM;

describe.skipIf(!romPath)("落とし物の見た目（素の BPRJ）", () => {
  it("いちばん多いのはボール（92）の下向き固定（8）", () => {
    const rom = new Rom(new Uint8Array(readFileSync(romPath!)));
    const loader = new MapLoader(rom, requireSupportedGame(rom).offsets);
    const reader = new EventReader(rom);
    const c = new ItemBallStyleCounter(rom);
    for (const id of loader.bankTable.ids()) {
      const h = loader.readHeader(id);
      if (h.eventsOffset !== null) c.addMap(reader.read(h.eventsOffset));
    }
    expect(c.total).toBeGreaterThan(150);
    expect(c.mostCommon()).toEqual({ graphicsId: 92, movementType: 8 });
  });
});
