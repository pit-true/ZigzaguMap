import { describe, expect, it } from "vitest";
import { MAPSEC_COUNT, MAPSEC_FIRST, Rom, VisitFlagHook } from "../src/index.js";

/** 関数の位置 0x100 にフック（ldr r1, [pc, #0]; bx r1; .word）と表へのポインタ、0x200 に表を置いた ROM。 */
function hookedRom(): Rom {
  const bytes = new Uint8Array(0x1000).fill(0xff);
  const view = new DataView(bytes.buffer);
  view.setUint16(0x100, 0x4900, true);
  view.setUint16(0x102, 0x4708, true);
  view.setUint32(0x104, 0x08000801, true);
  view.setUint32(0x108, 0x08000200, true);
  for (let i = 0; i < MAPSEC_COUNT; i++) view.setUint16(0x200 + i * 2, i === 0 ? 0x890 : i === 11 ? 0x8a2 : 0xffff, true);
  return new Rom(bytes);
}

describe("訪問フラグのフック（#499）", () => {
  it("フックの直後のポインタから表を読み、0xFFFF の場所は含めない", () => {
    const flags = VisitFlagHook.read(hookedRom(), 0x100);
    expect(flags).not.toBeNull();
    expect([...flags!.entries()]).toEqual([
      [MAPSEC_FIRST, 0x890],
      [MAPSEC_FIRST + 11, 0x8a2],
    ]);
  });

  it("フックでない関数（素の switch 文）は null", () => {
    const rom = hookedRom();
    expect(VisitFlagHook.read(rom, 0x200)).toBeNull();
    const plain = new Uint8Array(0x200);
    new DataView(plain.buffer).setUint32(0, 0x0600b500, true); // push {lr}; lsls r0, r0, #24
    expect(VisitFlagHook.isHook(new Rom(plain), 0)).toBe(false);
  });

  it("フックなのに表へのポインタが ROM の外なら止める", () => {
    const rom = hookedRom();
    new DataView(rom.bytes.buffer).setUint32(0x108, 0x09000000, true);
    expect(() => VisitFlagHook.read(rom, 0x100)).toThrow();
  });

  it("プロジェクトの hooks に 2 つのフックがあるときだけ対応", () => {
    const chronos = "#include \"src/config.h\"\r\nTownMap_GetMapState 080C47C0 1\r\nTownMap_GetCaveState 080C4A5C 1\r\n";
    expect(VisitFlagHook.supportedBy(chronos)).toBe(true);
    expect(VisitFlagHook.supportedBy("TownMap_GetMapState 080C47C0 1\n")).toBe(false);
    expect(VisitFlagHook.supportedBy("#TownMap_GetMapState 080C47C0 1\n#TownMap_GetCaveState 080C4A5C 1\n")).toBe(false);
    expect(VisitFlagHook.supportedBy(null)).toBe(false);
  });
});
