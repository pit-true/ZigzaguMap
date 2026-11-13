import { describe, expect, it } from "vitest";
import {
  DataError,
  EventReader,
  Rom,
  RomError,
  eventHeaderCodec,
  personCodec,
  signCodec,
  trapCodec,
  warpCodec,
  type SignEvent,
} from "../src/index.js";
import { PERSON_BYTES, SIGN_BYTES, SYN, WARP_BYTES, buildSyntheticRom } from "./helpers/syntheticRom.js";

/** 0〜255 の並びで埋めたバイト列（全バイトが別の値になる）。 */
function pattern(length: number, seed = 1): Uint8Array {
  return Uint8Array.from({ length }, (_, i) => (i * 37 + seed) & 0xff);
}

describe("イベントの相互変換", () => {
  it("人: フィールドを読み、元のバイト列に戻る", () => {
    const bytes = Uint8Array.from(PERSON_BYTES);
    const p = personCodec.decode(bytes);
    expect(p).toMatchObject({
      localId: 1,
      graphicsId: 5,
      x: 3,
      y: 4,
      elevation: 3,
      movementType: 8,
      movementRangeX: 1,
      movementRangeY: 2,
      trainerType: 1,
      trainerRangeOrBerryTree: 2,
      script: 0x08345678,
      flag: 0x10,
    });
    expect(personCodec.encode(p)).toEqual(bytes);
  });

  it("全構造体: 任意のバイト列が decode → encode で元に戻る", () => {
    for (const codec of [eventHeaderCodec, personCodec, warpCodec, trapCodec, signCodec]) {
      for (let seed = 0; seed < 8; seed++) {
        const bytes = pattern(codec.size * 3, seed);
        const list = (codec.decodeList as (b: Uint8Array, n: number) => unknown[])(bytes, 3);
        expect((codec.encodeList as (v: unknown[]) => Uint8Array)(list)).toEqual(bytes);
      }
    }
  });

  it("看板の種類 0〜15 のすべてで元に戻る", () => {
    for (let kind = 0; kind < 16; kind++) {
      const bytes = pattern(12, kind);
      bytes[5] = kind;
      expect(signCodec.encode(signCodec.decode(bytes))).toEqual(bytes);
    }
  });

  it("看板: 種別でスクリプトと隠しアイテムを読み分ける", () => {
    const [script, hidden] = signCodec.decodeAll(Uint8Array.from(SIGN_BYTES)) as [SignEvent, SignEvent];
    expect(script.content).toEqual({ type: "script", script: 0x08332211 });
    expect(hidden.kind).toBe(7);
    expect(hidden.content).toEqual({ type: "hiddenItem", item: 0x0d, flag: 5, amount: 1, underfoot: true });
  });

  it("看板: 中身を隠しアイテムに変えて書ける", () => {
    const sign = signCodec.decode(Uint8Array.from(SIGN_BYTES));
    sign.kind = 7;
    sign.content = { type: "hiddenItem", item: 0x123, flag: 0x45, amount: 3, underfoot: false };
    expect([...signCodec.encode(sign).subarray(8)]).toEqual([0x23, 0x01, 0x45, 0x03]);
  });

  it("ワープ: フィールドを読む", () => {
    expect(warpCodec.decode(Uint8Array.from(WARP_BYTES))).toEqual({ x: 1, y: 1, elevation: 0, warpId: 2, map: 3, bank: 4 });
  });

  it("短いバイト列や割り切れない長さは DataError", () => {
    expect(() => personCodec.decode(new Uint8Array(23))).toThrow(DataError);
    expect(() => warpCodec.decodeAll(new Uint8Array(9))).toThrow(DataError);
  });
});

describe("EventReader（合成 ROM）", () => {
  const rom = new Rom(buildSyntheticRom());

  it("ヘッダーと 4 種の一覧を読む", () => {
    const events = new EventReader(rom).read(SYN.events);
    expect(events.persons).toHaveLength(1);
    expect(events.warps).toHaveLength(1);
    expect(events.traps).toHaveLength(0);
    expect(events.signs).toHaveLength(2);
    expect(personCodec.encodeList(events.persons)).toEqual(Uint8Array.from(PERSON_BYTES));
  });

  it("件数があるのにポインタが ROM 外なら RomError", () => {
    const bytes = buildSyntheticRom();
    new DataView(bytes.buffer).setUint32(SYN.events + 4, 0x09ffff00, true);
    expect(() => new EventReader(new Rom(bytes)).read(SYN.events)).toThrow(RomError);
  });
});
