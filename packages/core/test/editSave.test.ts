import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BPRJ_OFFSETS,
  CfruProject,
  CommandBus,
  CreateMapCommand,
  MapSourceConverter,
  MapSourceJson,
  MemoryProjectFs,
  ND_CHARMAP_TBL,
  Rom,
  RomMapSource,
  SetItemBallCommand,
  SetMapNameCommand,
  SetPaletteColorsCommand,
  SetHeaderFieldsCommand,
  buildHiddenItemSource,
  hiddenItemBlock,
  mapSourcePath,
} from "../src/index.js";
import { M00, fingerprint } from "./helpers/editHarness.js";
import { SYN, buildSyntheticRom } from "./helpers/syntheticRom.js";

const rom = buildSyntheticRom();
const PRIMARY = { pointer: 0x08000000 + SYN.primaryHeader, secondary: false };
const SECONDARY = { pointer: 0x08000000 + SYN.secondaryHeader, secondary: true };
const HIDDEN = "assembly/overworld_scripts/HiddenItem.s";
const ID_A = "a".repeat(32);
const ID_B = "b".repeat(32);

async function openAll(fs: MemoryProjectFs): Promise<CfruProject> {
  const p = await CfruProject.open(rom, fs);
  for (const id of p.mapIds()) await p.load(id);
  return p;
}

describe("HiddenItem.s の生成（Bochi と同じ形）", () => {
  const item = (id: string, itemId: number) => ({ id, personIndex: 0, itemId, label: `HiddenItem_03_00_${id}` });

  it("手書き部分を残し、ラベル順に生成範囲を並べる", () => {
    const manual = ".text\r\n.thumb\r\n.align 2\r\n\r\nMyScript:\r\n    .byte 0x02\r\n";
    const text = buildHiddenItemSource(manual, [item(ID_B, 0x10d), item(ID_A, 4)], new Map())!;
    expect(text).toBe(manual.trimEnd() + "\n\n" + hiddenItemBlock(item(ID_A, 4)) + "\n\n" + hiddenItemBlock(item(ID_B, 0x10d)) + "\n");
    expect(hiddenItemBlock(item(ID_B, 0x10d))).toBe(
      `@ BBE-BEGIN ${ID_B}\n.global HiddenItem_03_00_${ID_B}\nHiddenItem_03_00_${ID_B}:\n    .byte 0x1A, 0x00, 0x80, 0x0D, 0x01\n    .byte 0x1A, 0x01, 0x80, 0x01, 0x00, 0x09, 0x01, 0x02\n@ BBE-END ${ID_B}`,
    );
    // 前回と同じなら元のまま。
    const previous = new Map([ID_A, ID_B].map((id, i) => [id, item(id, i === 0 ? 4 : 0x10d)]));
    expect(buildHiddenItemSource(text, [item(ID_A, 4), item(ID_B, 0x10d)], previous)).toBe(text);
    // 落とし物を消すと範囲が消え、手書き部分は残る。
    const removed = buildHiddenItemSource(text, [item(ID_A, 4)], previous)!;
    expect(removed).toContain("MyScript:");
    expect(removed).not.toContain(ID_B);
    // 道具が変わった範囲だけ作り直す（他は前回の範囲を手で直していてもそのまま）。
    const edited = text.replace("0x04, 0x00", "0x04, 0x00 @ 手で直した");
    const changed = buildHiddenItemSource(edited, [item(ID_A, 4), item(ID_B, 1)], previous)!;
    expect(changed).toContain("@ 手で直した");
    expect(changed).toContain("0x80, 0x01, 0x00\n");
  });

  it("空のファイルで落とし物が無ければ作らない。終端の無い範囲は Error", () => {
    expect(buildHiddenItemSource("", [], new Map())).toBeNull();
    expect(buildHiddenItemSource("", [item(ID_A, 1)], new Map())!.startsWith(".text\n.thumb\n.align 2\n\n@ BBE-BEGIN")).toBe(true);
    expect(() => buildHiddenItemSource(`@ BBE-BEGIN ${ID_A}\nfoo\n`, [], new Map())).toThrow();
  });
});

describe("CfruProject の保存（マップ以外）", () => {
  it("落とし物: JSON の ItemBalls と HiddenItem.s を書き、手書き部分を残す。消すと範囲も消える", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText(HIDDEN, ".text\n.thumb\n.align 2\n\nManual:\n    .byte 0x02\n");
    const p = await openAll(fs);
    const bus = new CommandBus(p.editorContext());
    bus.execute(new SetItemBallCommand({ ...M00, personIndex: 0, itemId: 13, id: ID_A }));
    const first = await p.save();
    expect(first.written).toEqual(["maps/project.json", mapSourcePath(M00), HIDDEN]);
    const hidden = await fs.readText(HIDDEN);
    expect(hidden).toContain("Manual:");
    expect(hidden).toContain(`HiddenItem_00_00_${ID_A}:`);
    const source = MapSourceJson.parse(await fs.readText(mapSourcePath(M00)));
    expect(source.itemBalls).toEqual([{ id: ID_A, personIndex: 0, itemId: 13, label: `HiddenItem_00_00_${ID_A}` }]);
    expect(await p.save()).toEqual({ written: [], removed: [] });

    // 開き直しても同じで、何も書かない。
    const again = await openAll(fs);
    expect(fingerprint(again)).toBe(fingerprint(p));
    expect(await again.save()).toEqual({ written: [], removed: [] });

    bus.undo();
    const second = await p.save();
    expect(second).toEqual({ written: [HIDDEN], removed: [mapSourcePath(M00)] });
    expect(await fs.readText(HIDDEN)).toBe(".text\n.thumb\n.align 2\n\nManual:\n    .byte 0x02\n");
  });

  it("タイルセット: 変えたものだけ tileset.json と tiles.png を書き、読み直すと同じ。戻すと消す", async () => {
    const fs = new MemoryProjectFs();
    const p = await openAll(fs);
    await p.loadTilesetDocument(PRIMARY);
    await p.loadTilesetDocument(SECONDARY);
    const bus = new CommandBus(p.editorContext());
    bus.execute(new SetPaletteColorsCommand({ tileset: SECONDARY.pointer, secondary: true, palette: 7, start: 2, colors: [0x1234, 0x0421] }));
    expect(p.hasUnsavedChanges()).toBe(true);
    const folder = "maps/tilesets/secondary_055100";
    expect((await p.save()).written).toEqual(["maps/project.json", `${folder}/tileset.json`, `${folder}/tiles.png`]);
    expect(p.hasUnsavedChanges()).toBe(false);
    expect(await p.save()).toEqual({ written: [], removed: [] });

    const again = await CfruProject.open(rom, fs);
    const t = await again.loadTilesetDocument(SECONDARY);
    expect(t.toJson()).toBe(p.editorContext().tileset(SECONDARY).toJson());
    expect(t.palettes[7 * 16 + 2]).toBe(0x1234);
    expect((await again.loadTileset(SECONDARY.pointer, true)).palettes[7 * 16 + 3]).toBe(0x0421);

    bus.undo();
    expect(await p.save()).toEqual({ written: [], removed: [`${folder}/tileset.json`, `${folder}/tiles.png`] });
  });

  it("新しいマップとバンク: maps\\BB\\MM.json に書き、project.json の BaseBankCounts はベースのまま", async () => {
    const fs = new MemoryProjectFs();
    const p = await openAll(fs);
    const bus = new CommandBus(p.editorContext());
    const base = { width: 3, height: 3, primaryTileset: PRIMARY.pointer, secondaryTileset: SECONDARY.pointer };
    bus.execute(new CreateMapCommand({ ...base, bank: 0, map: 2 }));
    bus.execute(new CreateMapCommand({ ...base, bank: 2, map: 0 }));
    expect(p.mapIds()).toContainEqual({ bank: 2, map: 0 });
    const result = await p.save();
    expect(result.written).toEqual(["maps/project.json", "maps/00/02.json", "maps/02/00.json"]);
    expect(await fs.readText("maps/project.json")).toBe('{"Format":1,"BaseBankCounts":[2,1]}\r\n');

    const again = await CfruProject.open(rom, fs);
    expect(again.bankCounts()).toEqual([3, 1, 1]);
    expect(MapSourceJson.stringify(MapSourceConverter.toSource(await again.load({ bank: 2, map: 0 })))).toBe(await fs.readText("maps/02/00.json"));

    // 追加を取り消して保存すると JSON を消す。やり直すとまた書ける。
    bus.undo();
    expect(p.isModified({ bank: 2, map: 0 })).toBe(true);
    expect(await p.save()).toEqual({ written: [], removed: ["maps/02/00.json"] });
    expect(p.bankCounts()).toEqual([3, 1]);
    bus.redo();
    expect((await p.save()).written).toEqual(["maps/02/00.json"]);
  });

  it("マップ名の変更は同じ地名番号の全マップに書き、戻すと消す", async () => {
    const fs = new MemoryProjectFs();
    const p = await CfruProject.open(rom, fs);
    await p.load(M00);
    const bus = new CommandBus(p.editorContext());
    bus.execute(new SetMapNameCommand({ regionId: 0x58, text: "トキワ" }));
    const result = await p.save();
    expect(result.written).toEqual(["maps/project.json", "maps/00/00.json", "maps/00/01.json", "maps/01/00.json"]);
    const again = await CfruProject.open(rom, fs);
    expect((await again.load({ bank: 1, map: 0 })).mapNameText()).toBe("トキワ");
    bus.undo();
    expect((await p.save()).removed).toEqual(["maps/00/00.json", "maps/00/01.json", "maps/01/00.json"]);
  });

  it("保存のたびに maps\\ の全 JSON を見て、ベースと同じものを消す（読み込んでいないマップも）", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText("maps/project.json", '{"Format":1,"BaseBankCounts":[2,1]}\r\n');
    const same = new RomMapSource(new Rom(rom), BPRJ_OFFSETS).read({ bank: 1, map: 0 });
    await fs.writeText("maps/01/00.json", MapSourceJson.stringify(MapSourceConverter.toSource(same)));
    const p = await CfruProject.open(rom, fs);
    await p.load(M00);
    new CommandBus(p.editorContext()).execute(new SetHeaderFieldsCommand({ ...M00, fields: { weather: 3 } }));
    expect(await p.save()).toEqual({ written: [mapSourcePath(M00)], removed: ["maps/01/00.json"] });
  });

  it("プロジェクトの charmap.tbl があればそれで文字列を変換する", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText("charmap.tbl", "6F=ま\n5B=さ\n77=ら\nFF=$\n");
    const p = await CfruProject.open(rom, fs);
    expect(p.textCodec.decode(Uint8Array.from([0x6f, 0x5b, 0x77, 0xff]))).toBe("まさら");
    expect((await p.load(M00)).mapNameText(p.textCodec)).toBe("まさら");
  });

  it("漢字を含むマップ名（ND の charmap.tbl。漢字は FC xx yy）を書いて読み直せる", async () => {
    // NeoDark-CFRU の charmap.tbl があればそれを、無ければ同梱の写し（同じ内容）を使う。
    const nd = process.env.ZIGZAGU_TEST_ND_PROJECT;
    const charmap = nd ? readFileSync(`${nd}/charmap.tbl`, "utf-8") : ND_CHARMAP_TBL;
    const fs = new MemoryProjectFs();
    await fs.writeText("charmap.tbl", charmap);
    const p = await CfruProject.open(rom, fs);
    await p.load(M00);
    const name = "漢字の森町あ洞";
    new CommandBus(p.editorContext()).execute(new SetMapNameCommand({ regionId: 0x58, text: name }));
    expect((await p.save()).written).toContain("maps/00/00.json");
    // JSON の MapName は ROM の文字コード（漢字は FC xx yy の 3 バイト、終端 FF）
    const json = JSON.parse(await fs.readText("maps/00/00.json")) as { MapName: string };
    const bytes = Uint8Array.from(Buffer.from(json.MapName, "base64"));
    expect([...bytes.subarray(0, 6)]).toEqual([0xfc, 0x8a, 0xbf, 0xfc, 0x8e, 0x9a]);
    expect(bytes[bytes.length - 1]).toBe(0xff);
    // 開き直すと同じ文字列になる（一覧の名前も同じ）
    const again = await CfruProject.open(rom, fs);
    expect((await again.load(M00)).mapNameText(again.textCodec)).toBe(name);
    expect((await again.load({ bank: 1, map: 0 })).mapNameText(again.textCodec)).toBe(name);
    // 変えずにもう一度出力しても同じ内容
    const text = await fs.readText("maps/00/00.json");
    await again.save();
    expect(await fs.readText("maps/00/00.json")).toBe(text);
  });
});
