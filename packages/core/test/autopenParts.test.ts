import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AUTOPEN_DIR,
  AutoPenLibrary,
  MemoryProjectFs,
  PartIndex,
  blockFingerprint,
  gridOf,
  parseAutoPenFile,
  parseBochiAssistText,
  sha1,
  singleGrid,
  stringifyAutoPenFile,
  tilesetInfoOf,
  type AutoPenFile,
  type AutoPenPart,
} from "../src/index.js";

const blocksA = new Uint16Array(640 * 8).map((_, i) => i & 0xffff);
const blocksB = new Uint16Array(384 * 8).map((_, i) => (i * 7) & 0xffff);
const P = tilesetInfoOf({ secondary: false, game: "BPRJ", headerAddress: 0x298b44, blocks: blocksA, blockCount: 640 });
const S = tilesetInfoOf({ secondary: true, game: "BPRJ", headerAddress: 0x298b5c, blocks: blocksB, blockCount: 384 });

function pond(order = 0): AutoPenPart {
  const slots: Record<string, ReturnType<typeof singleGrid>> = {};
  const names = ["NW", "N", "NE", "W", "C", "E", "SW", "S", "SE", "INW", "INE", "ISW", "ISE"];
  names.forEach((n, i) => (slots[n] = singleGrid(0x100 + i, n === "C" ? 0x04 : null)));
  return { name: "池", kind: "edge", role: "water", order, slots };
}

describe("SHA-1 と識別子", () => {
  it("node の crypto と同じ値", () => {
    for (const len of [0, 1, 55, 56, 64, 1000]) {
      const data = new Uint8Array(len).map((_, i) => (i * 31 + 7) & 0xff);
      expect(Buffer.from(sha1(data)).toString("hex")).toBe(createHash("sha1").update(data).digest("hex"));
    }
  });

  it("識別子はブロックの 16 バイト × 数の SHA-1 の先頭 8 バイト", () => {
    const bytes = Buffer.alloc(640 * 16);
    for (let i = 0; i < 640 * 8; i++) bytes.writeUInt16LE(blocksA[i]!, i * 2);
    expect(blockFingerprint(blocksA, 640)).toBe(createHash("sha1").update(bytes).digest("hex").slice(0, 16));
    expect(P.name).toBe("BPRJ TS1 0x298B44");
  });
});

describe("パーツの定義のファイル", () => {
  it("書いて読むと同じ（知らない項目も残す）", () => {
    const file: AutoPenFile = {
      tileset: P,
      parts: [
        pond(),
        { name: "草むら", kind: "fill", role: "grass", order: 1, slots: { Blocks: gridOf(2, 1, [0x0d, 0x0e], [0x0c, null]) } },
        { name: "家", kind: "piece", role: "building", order: 2, slots: { Body: gridOf(2, 2, [1, 2, null, 4]) }, extra: { memo: "テスト" } },
        { name: "森", kind: "repeat", role: "tree", order: 3, slots: { Top: gridOf(2, 1, [5, 6]), Body: gridOf(2, 2, [7, 8, 9, 10]), BodyEdge: singleGrid(11) } },
      ],
      extra: { note: 1 },
    };
    const text = stringifyAutoPenFile(file);
    expect(text).toContain("\r\n");
    expect(text).toContain('"kind": "primary"');
    expect(text).toContain('"headerAddress": "0x298B44"');
    expect(parseAutoPenFile(text)).toEqual(file);
  });

  it("形の違いは ProjectFormatError", () => {
    const base = { format: 1, tileset: { kind: "primary", game: "BPRJ", headerAddress: "0x1", fingerprint: "", blockCount: 640, name: "" } };
    expect(() => parseAutoPenFile(JSON.stringify({ ...base, format: 2 }))).toThrow(/format/);
    expect(() => parseAutoPenFile(JSON.stringify({ ...base, parts: [{ name: "a", kind: "x", slots: {} }] }))).toThrow(/kind/);
    expect(() => parseAutoPenFile(JSON.stringify({ ...base, parts: [{ name: "a", kind: "fill", slots: { NW: { width: 1, height: 1, cells: [[1, 1]] } } }] }))).toThrow(/NW/);
    expect(() => parseAutoPenFile(JSON.stringify({ ...base, parts: [{ name: "a", kind: "fill", slots: { Blocks: { width: 2, height: 1, cells: [[1, 1]] } } }] }))).toThrow(/cells/);
  });
});

describe("Bochi の txt の読み込み", () => {
  const txt = [
    "; 注釈",
    "[Tileset]",
    "Name=BPRJ TS1 0x298B44",
    "Kind=1",
    "Game=BPRJ",
    "HeaderOffset=298B44",
    `Fingerprint=${P.fingerprint}`,
    "BlockCount=640",
    "",
    "[Part]",
    "Name=草むら",
    "Kind=Area",
    "Role=Grass",
    "Order=0",
    "Slot.Blocks=2,1;1:00D:0C,1:00E:--",
    "",
    "[Part]",
    "Name=壊れ",
    "Kind=Area",
    "Role=Nothing",
    "Slot.Blocks=1,1;1:001:0C",
    "",
    "[Part]",
    "Name=岸",
    "Kind=Edge",
    "Role=Water",
    "Order=2",
    "Slot.NW=1,1;1:100:--",
    "Slot.2N=2,1;1:101:--,-",
    "Slot.C=1,1;1:104:04",
    "",
    "[Part]",
    "Name=副を使う",
    "Kind=Area",
    "Role=Other",
    "Slot.Blocks=1,1;2:004:04",
  ].join("\r\n");

  it("同じパーツと枠になる（副のブロックは 0x280 を足し、壊れたパーツは飛ばす）", () => {
    const f = parseBochiAssistText(txt)!;
    expect(f.tileset).toEqual({ ...P });
    expect(f.parts).toEqual([
      { name: "草むら", kind: "fill", role: "grass", order: 0, slots: { Blocks: gridOf(2, 1, [0x0d, 0x0e], [0x0c, null]) } },
      {
        name: "岸",
        kind: "edge",
        role: "water",
        order: 2,
        slots: { NW: singleGrid(0x100), C: singleGrid(0x104, 4), "2N": { width: 2, height: 1, cells: [{ block: 0x101, movement: null }, null] } },
      },
      { name: "副を使う", kind: "fill", role: "other", order: 2, slots: { Blocks: singleGrid(0x284, 4) } },
    ]);
  });

  it("[Tileset] が無いものは null", () => {
    expect(parseBochiAssistText("[Part]\nName=a\nKind=Area")).toBeNull();
  });

  it("取り込むと maps\\autopen に書き、同じ名前は置き換える", async () => {
    const fs = new MemoryProjectFs();
    const lib = await AutoPenLibrary.open(fs);
    await lib.save(P, S, [{ name: "草むら", kind: "fill", role: "grass", order: 0, slots: { Blocks: singleGrid(1) } }, pond(1)]);
    const r = await lib.importBochi([txt, "でたらめ"], P, S);
    expect(r).toMatchObject({ files: 1, matched: 1, parts: 2 });
    const parts = lib.partsFor(P, S);
    expect(parts.map((p) => p.name)).toEqual(["池", "草むら", "岸"]);
    expect(parts[1]!.slots["Blocks"]).toEqual(gridOf(2, 1, [0x0d, 0x0e], [0x0c, null]));
    // 主のファイルにある副のブロックを使うパーツ（Bochi では使われないもの）は取り込まない
    expect(parts.some((p) => p.name === "副を使う")).toBe(false);
  });
});

describe("パーツの一覧（AutoPenLibrary）", () => {
  it("保存して開き直すと同じ。主と副のファイルに分ける", async () => {
    const fs = new MemoryProjectFs();
    const lib = await AutoPenLibrary.open(fs);
    const parts: AutoPenPart[] = [pond(), { name: "副の木", kind: "piece", role: "tree", order: 1, slots: { Body: gridOf(1, 2, [0x290, 0x291]) } }];
    const written = await lib.save(P, S, parts);
    expect(written).toEqual([`${AUTOPEN_DIR}/primary_298B44.json`, `${AUTOPEN_DIR}/secondary_298B5C.json`]);
    const again = await AutoPenLibrary.open(fs);
    expect(again.partsFor(P, S)).toEqual(parts);
  });

  it("識別子が同じなら別の場所（移したタイルセット）でも当たり、場所が同じなら編集したあとでも当たる", async () => {
    const fs = new MemoryProjectFs();
    const lib = await AutoPenLibrary.open(fs);
    await lib.save(P, S, [pond()]);
    const moved = { ...P, headerAddress: 0x800000, game: "BPRE" };
    expect(lib.partsFor(moved, S).map((p) => p.name)).toEqual(["池"]);
    const edited = { ...P, fingerprint: "0000000000000000" };
    expect(lib.partsFor(edited, S).map((p) => p.name)).toEqual(["池"]);
    const other = { ...P, headerAddress: 0x1234, fingerprint: "ffff" };
    expect(lib.partsFor(other, S)).toEqual([]);
  });

  it("副のファイルの、ほかの主と組のパーツは使わず、保存しても残す", async () => {
    const fs = new MemoryProjectFs();
    const lib = await AutoPenLibrary.open(fs);
    const mixed: AutoPenPart = { name: "混ぜ", kind: "piece", role: "other", order: 0, slots: { Body: gridOf(2, 1, [1, 0x281]) } };
    await lib.save(P, S, [mixed]);
    const P2 = { ...P, headerAddress: 0x111111, fingerprint: "abcd" };
    expect(lib.partsFor(P2, S)).toEqual([]);
    await lib.save(P2, S, [{ ...mixed, name: "別の混ぜ" }]);
    expect(lib.partsFor(P, S).map((p) => p.name)).toEqual(["混ぜ"]);
    expect(lib.partsFor(P2, S).map((p) => p.name)).toEqual(["別の混ぜ"]);
  });

  it("フォルダが無ければメモリに持ち、attach で書く", async () => {
    const lib = await AutoPenLibrary.open(null);
    expect(await lib.save(P, S, [pond()])).toEqual([]);
    expect(lib.pendingCount).toBe(1);
    const fs = new MemoryProjectFs();
    expect(await lib.attach(fs)).toEqual([`${AUTOPEN_DIR}/primary_298B44.json`]);
    expect(lib.pendingCount).toBe(0);
  });

  it("読めないファイルは problems に入れて使わない", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText(`${AUTOPEN_DIR}/bad.json`, "{");
    const lib = await AutoPenLibrary.open(fs);
    expect(lib.problems.map((p) => p.path)).toEqual([`${AUTOPEN_DIR}/bad.json`]);
  });
});

describe("ブロック → パーツの表（PartIndex）", () => {
  it("縁つき → くり返し → 部品 → 面 の順で引き、3 層の次の番号は入れない", () => {
    const fill: AutoPenPart = { name: "面", kind: "fill", role: "ground", order: 0, slots: { Blocks: gridOf(3, 1, [0x100, 5, 6]) } };
    const piece: AutoPenPart = { name: "部品", kind: "piece", role: "other", order: 1, slots: { Body: gridOf(2, 1, [5, 7]) } };
    const repeat: AutoPenPart = { name: "森", kind: "repeat", role: "tree", order: 2, slots: { Body: gridOf(2, 1, [7, 8]) } };
    const idx = new PartIndex([fill, piece, repeat, pond(3)], (b) => b === 6);
    expect(idx.get(0x100)?.part.name).toBe("池");
    expect(idx.get(0x100)?.slot).toBe("NW");
    expect(idx.get(5)?.part.name).toBe("部品");
    expect(idx.get(7)?.part.name).toBe("森");
    expect(idx.get(7)).toMatchObject({ slot: "Body", x: 0, y: 0 });
    expect(idx.has(6)).toBe(false);
    expect(idx.get(999)).toBeNull();
    expect(idx.all(5).map((p) => p.part.name)).toEqual(["部品", "面"]);
    expect(idx.slotsIn(idx.partOf(0x104)!, 0x104)).toEqual(["C"]);
  });
});
