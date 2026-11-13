import { describe, expect, it } from "vitest";
import { BPRJ_OFFSETS, DataError, JP_CHARSET, MapNameTable, Rom, TextCodec, hasMapName } from "../src/index.js";
import { NAME_BYTES, buildSyntheticRom } from "./helpers/syntheticRom.js";

describe("マップ名と文字コード", () => {
  const codec = TextCodec.japanese;

  it("文字コード表の位置", () => {
    expect(JP_CHARSET[0x01]).toBe("あ");
    expect(JP_CHARSET[0x50]).toBe("っ");
    expect(JP_CHARSET[0x51]).toBe("ア");
    expect(JP_CHARSET[0xa0]).toBe("ッ");
    expect(JP_CHARSET[0xa1]).toBe("0");
    expect(JP_CHARSET[0xbb]).toBe("A");
    expect(JP_CHARSET[0xee]).toBe("z");
    expect(JP_CHARSET[0xf0]).toBe(":");
    expect(JP_CHARSET[0xf6]).toBe("ü");
  });

  it("decode と encode", () => {
    expect(codec.decode(Uint8Array.from(NAME_BYTES))).toBe("マサラ");
    expect(codec.encode("マサラ")).toEqual(Uint8Array.from(NAME_BYTES));
    expect(codec.encode("１ばんどうろ")).toEqual(codec.encode("1ばんどうろ"));
  });

  it("未知のバイトと FC xx yy は例外を出さず、エスケープで元に戻る", () => {
    for (let b = 0; b < 255; b++) {
      const bytes = Uint8Array.from([0x01, b, 0x02, 0xff]);
      const text = codec.decode(bytes);
      expect(codec.encode(text)).toEqual(bytes);
    }
    const kanji = Uint8Array.from([0xfc, 0x88, 0x9f, 0x01, 0xff]);
    expect(codec.decode(kanji)).toBe("[FC889F]あ");
    expect(codec.encode("[FC889F]あ")).toEqual(kanji);
    // 終端の手前で切れた FC も戻る。
    const cut = Uint8Array.from([0x01, 0xfc, 0x88, 0xff]);
    expect(codec.encode(codec.decode(cut))).toEqual(cut);
  });

  it("使えない文字は DataError", () => {
    expect(() => codec.encode("漢")).toThrow(DataError);
    expect(() => codec.encode("[ZZ]")).toThrow(DataError);
    expect(codec.canEncode("漢")).toBe(false);
  });

  it("名前表を読む", () => {
    const table = MapNameTable.read(new Rom(buildSyntheticRom()), BPRJ_OFFSETS.mapNameTablePointer);
    expect(table.name(0x58)).toBe("マサラ");
    expect([...table.rawName(0x58)!]).toEqual(NAME_BYTES);
    expect(table.rawName(0x57)).toBeNull();
    expect(hasMapName(0xc4)).toBe(true);
    expect(hasMapName(0xc5)).toBe(false);
  });
});
