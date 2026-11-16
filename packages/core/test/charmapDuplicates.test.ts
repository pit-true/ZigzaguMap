import { describe, expect, it } from "vitest";
import { layoutMessage, MessageFont, ScriptTextCodec, TextCodec } from "../src/index.js";

// charmap.tbl に同じ字が 2 回ある表（#505）。ND・Chronos の表は `D5=a` と `F4=a` のように a・o・u・O・U・? と一部の漢字が重なっている。
// ビルドの読み方は 2 通りある:
// - .string の本文（scripts/string.py の PokeByteTableMaker）は `dictionary[value] = ...` で後ろの行が勝つ。
//   ND・Chronos のビルドした ROM でも「another」は F4・F5 で書かれている（2026-11-17 に確かめた）。
// - トレーナー名など（scripts/map_project.py の _charmap）は `setdefault` で前の行が勝つ。
const TABLE = "C2=H\nD5=a\nE3=o\nF4=a\nF5=o\nFE=\\n\nFC 88 9F=亜\nFC E8 9F=亜\n";

describe("charmap.tbl の重なった字", () => {
  it(".string の本文（再生のメッセージ・取り込み）は string.py と同じく後ろの行", () => {
    const codec = ScriptTextCodec.fromCharmap(TABLE);
    expect([...codec.encode("Ha亜")]).toEqual([0xc2, 0xf4, 0xfc, 0xe8, 0x9f]);
    expect(codec.encodeParts("ao").map((part) => part.bytes)).toEqual([[0xf4], [0xf5]]);
    // 戻すときは、書き直して同じバイトになる行だけを字にする（前の行のバイトは 16 進のまま）
    expect(codec.decode(Uint8Array.of(0xc2, 0xf4))).toBe("Ha");
    expect(codec.decode(Uint8Array.of(0xc2, 0xd5))).toBe("H[D5]");
  });

  it("名前（maps・trainers の JSON）は map_project.py と同じく前の行", () => {
    const codec = TextCodec.fromCharmap(TABLE);
    expect([...codec.encode("Ha", false)]).toEqual([0xc2, 0xd5]);
  });

  it("再生のメッセージの窓の字の番号はビルドと同じ", () => {
    const glyphs = new Uint8Array(0x8000).fill(0x55), widths = new Uint8Array(0x200).fill(6);
    const [page] = layoutMessage(ScriptTextCodec.fromCharmap(TABLE).encodeParts("Ha"), MessageFont.fromData(glyphs, widths));
    expect(page!.items.map((item) => item.kind === "glyph" && item.code)).toEqual([0xc2, 0xf4]);
  });

  it("同梱の ND の表でも同じ向き", () => {
    expect([...ScriptTextCodec.japanese.encode("aou")]).toEqual([0xf4, 0xf5, 0xf6]);
    expect([...TextCodec.japanese.encode("aou", false)]).toEqual([0xd5, 0xe3, 0xe9]);
  });
});
