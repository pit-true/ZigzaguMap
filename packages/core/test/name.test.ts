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
  });

  it("未知のバイトと FC xx yy は例外を出さず、エスケープで元に戻る", () => {
    for (let b = 0; b < 255; b++) {
      const bytes = Uint8Array.from([0x01, b, 0x02, 0xff]);
      const text = codec.decode(bytes);
      expect(codec.encode(text)).toEqual(bytes);
    }
    // 表に無い FC xx yy は 3 バイトまとめてエスケープする。
    const unknown = Uint8Array.from([0xfc, 0x80, 0x00, 0x01, 0xff]);
    expect(codec.decode(unknown)).toBe("[FC8000]あ");
    expect(codec.encode("[FC8000]あ")).toEqual(unknown);
    // 終端の手前で切れた FC も戻る。
    const cut = Uint8Array.from([0x01, 0xfc, 0x88, 0xff]);
    expect(codec.encode(codec.decode(cut))).toEqual(cut);
  });

  it("漢字（FC xx yy）と制御文字は charmap.tbl の定義で変換する", () => {
    const kanji = Uint8Array.from([0xfc, 0x88, 0x9f, 0x01, 0xff]);
    expect(codec.decode(kanji)).toBe("亜あ");
    expect(codec.encode("亜あ")).toEqual(kanji);
    expect(codec.decode(Uint8Array.from([0xfc, 0x01, 0x01, 0xff]))).toBe("{白}");
    expect(codec.encode("{文字色}こ")).toEqual(Uint8Array.from([0xfc, 0x01, 0x0a, 0xff]));
    // 同じ文字が先に別のバイトで定義されているバイトはエスケープになる（EF は「?」= AC と同じ）。
    expect(codec.decode(Uint8Array.from([0xef, 0xac, 0xff]))).toBe("[EF]?");
    // 0x00 は charmap.tbl の最初の定義（半角の空白）。全角の空白も 0x00 で書ける。
    expect(codec.decode(Uint8Array.from([0x00, 0xff]))).toBe(" ");
    expect(codec.encode("　")).toEqual(Uint8Array.from([0x00, 0xff]));
  });

  it("charmap.tbl の書式", () => {
    const own = TextCodec.fromCharmap("01=あ\r\n\r\n02=い\n02=ゐ\nFC 01=[色]\nFE=\\n\nB7=\\$\nFF=$\n/FF\nzz=x\n");
    expect(own.decode(Uint8Array.from([0x01, 0x02, 0xfe, 0xb7, 0xff]))).toBe("あい\n$");
    expect(own.encode("ゐ")).toEqual(Uint8Array.from([0x02, 0xff]));
    expect(own.encode("[色]")).toEqual(Uint8Array.from([0xfc, 0x01, 0xff]));
    expect(own.decode(Uint8Array.from([0x03, 0xff]))).toBe("[03]");
  });

  it("使えない文字は DataError", () => {
    expect(() => codec.encode("☃")).toThrow(DataError);
    expect(() => codec.encode("[ZZ]")).toThrow(DataError);
    expect(codec.canEncode("☃")).toBe(false);
    expect(codec.firstInvalidChar("あ☃")).toBe("☃");
    expect(codec.firstInvalidChar("あい")).toBeNull();
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
