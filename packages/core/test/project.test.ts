import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  BPRJ_OFFSETS,
  CfruProject,
  CommandBus,
  MapSourceConverter,
  MapSourceJson,
  MemoryProjectFs,
  PlaceBlockCommand,
  ProjectFormatError,
  ProjectManifestJson,
  Rom,
  RomMapSource,
  decodeBase64,
  encodeBase64,
  mapSourcePath,
  writeIndentedJson,
} from "../src/index.js";
import { NAME_BYTES, buildSyntheticRom } from "./helpers/syntheticRom.js";

const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), "utf8");

describe("base64", () => {
  it("往復する", () => {
    for (let n = 0; n < 20; n++) {
      const bytes = Uint8Array.from({ length: n }, (_, i) => (i * 97 + n) & 0xff);
      expect(decodeBase64(encodeBase64(bytes))).toEqual(bytes);
    }
    expect(encodeBase64(Uint8Array.from([0xfb, 0xff]))).toBe("+/8=");
  });
});

describe("Bochi と同じ JSON の整形", () => {
  it("字下げ・空の配列・CRLF・base64 の + はそのまま", () => {
    const text = writeIndentedJson({ A: 1, B: Uint8Array.from([0xfb]), C: [], D: [{ E: "x" }], F: {} });
    expect(text).toBe('{\r\n  "A": 1,\r\n  "B": "+w==",\r\n  "C": [],\r\n  "D": [\r\n    {\r\n      "E": "x"\r\n    }\r\n  ],\r\n  "F": {}\r\n}\r\n');
  });

  it("文字列は System.Text.Json の既定と同じくエスケープする", () => {
    expect(writeIndentedJson("a+b<c>&'\"\\\nあ")).toBe('"a\\u002Bb\\u003Cc\\u003E\\u0026\\u0027\\u0022\\\\\\n\\u3042"\r\n');
  });
});

describe("maps\\03\\00.json", () => {
  const text = fixture("map_03_00.json");

  it("読んで書き戻すとバイト単位で同じ", () => {
    const source = MapSourceJson.parse(text);
    expect(MapSourceJson.stringify(source)).toBe(text);
  });

  it("MapDocument を通しても同じ", () => {
    const doc = MapSourceConverter.fromSource(MapSourceJson.parse(text));
    expect(MapSourceJson.stringify(MapSourceConverter.toSource(doc))).toBe(text);
  });

  it("中身を読める", () => {
    const doc = MapSourceConverter.fromSource(MapSourceJson.parse(text));
    expect(doc.id).toEqual({ bank: 3, map: 0 });
    expect(doc.width).toBe(24);
    expect(doc.height).toBe(20);
    expect(doc.mapNameText()).toBe("マサラタウン");
    expect(doc.events!.persons).toHaveLength(1);
    expect(doc.events!.warps).toHaveLength(3);
    expect(doc.events!.signs).toHaveLength(4);
    expect(doc.connections!.map((c) => [c.direction, c.bank, c.map])).toEqual([
      [2, 3, 19],
      [1, 3, 39],
    ]);
    expect(doc.mapScripts).toEqual([]);
    expect(doc.wild[0]!.areas.map((a) => a.slots.length)).toEqual([0, 5, 0, 10]);
    expect(doc.primaryTileset).toBe(136940356);
  });

  it("件数とデータ長が合わなければ ProjectFormatError", () => {
    const source = MapSourceJson.parse(text);
    source.warps = source.warps.subarray(0, 8);
    expect(() => MapSourceConverter.fromSource(source)).toThrow(ProjectFormatError);
    expect(() => MapSourceJson.parse("{")).toThrow(ProjectFormatError);
    expect(() => MapSourceJson.parse('{"Format":2,"Bank":0,"Number":0}')).toThrow(ProjectFormatError);
  });
});

describe("maps\\project.json", () => {
  it("読んで書き戻すとバイト単位で同じ", () => {
    const text = fixture("project.json");
    const manifest = ProjectManifestJson.parse(text);
    expect(manifest.baseBankCounts[3]).toBe(66);
    expect(ProjectManifestJson.stringify(manifest)).toBe(text);
  });
});

describe("MapDocument と JSON（合成 ROM）", () => {
  const source = new RomMapSource(new Rom(buildSyntheticRom()), BPRJ_OFFSETS);

  it("JSON を通して往復しても変わらない", () => {
    const doc = source.read({ bank: 0, map: 0 });
    const json = MapSourceJson.stringify(MapSourceConverter.toSource(doc));
    const back = MapSourceConverter.fromSource(MapSourceJson.parse(json));
    expect(MapSourceJson.stringify(MapSourceConverter.toSource(back))).toBe(json);
    expect(back.mapScripts![1]!.table!.tail).toEqual(doc.mapScripts![1]!.table!.tail);
    // ポインタは Bochi と同じ位置が 0。
    const s = MapSourceConverter.toSource(doc);
    expect([...s.header.subarray(0, 16)].every((b) => b === 0)).toBe(true);
    expect([...s.footer.subarray(8, 24)].every((b) => b === 0)).toBe(true);
    expect([...s.eventHeader.subarray(4)].every((b) => b === 0)).toBe(true);
    expect([...s.connectionsHeader.subarray(4)].every((b) => b === 0)).toBe(true);
    expect([...s.mapScripts]).toEqual([1, 0x56, 0x34, 0x12, 0x08, 2, 0, 0, 0, 0, 0]);
    expect(s.mapScriptLists).toEqual([{ tableOffset: 6, data: expect.any(Uint8Array) }]);
    expect([...s.mapName]).toEqual(NAME_BYTES);
  });

});

describe("CfruProject（合成 ROM + メモリ上のフォルダ）", () => {
  const rom = buildSyntheticRom();
  const id = { bank: 0, map: 0 };

  it("ROM から読んだままなら何も書かない", async () => {
    const fs = new MemoryProjectFs();
    const project = await CfruProject.open(rom, fs);
    for (const m of project.mapIds()) await project.load(m);
    expect(await project.save()).toEqual({ written: [], removed: [] });
    expect(fs.files.size).toBe(0);
  });

  it("変更したマップだけ書き、project.json を作り、元に戻すと消す", async () => {
    const fs = new MemoryProjectFs();
    const project = await CfruProject.open(rom, fs);
    const doc = await project.load(id);
    await project.load({ bank: 1, map: 0 });
    const bus = new CommandBus(project.gridStore());
    bus.execute(new PlaceBlockCommand({ ...id, x: 1, y: 1, block: 7 }));
    expect(project.isModified(id)).toBe(true);
    expect(project.differsFromBase(doc)).toBe(true);

    const first = await project.save();
    expect(first.written).toEqual(["maps/project.json", mapSourcePath(id)]);
    expect(fs.files.get("maps/project.json")).toBe('{"Format":1,"BaseBankCounts":[2,1]}\r\n');
    expect(project.isModified(id)).toBe(false);

    // 同じ内容なら書かない。
    expect(await project.save()).toEqual({ written: [], removed: [] });

    // 開き直すと JSON が優先される。
    const reopened = await CfruProject.open(rom, fs);
    expect(reopened.hasJson(id)).toBe(true);
    expect((await reopened.load(id)).grid.getBlock(1, 1)).toBe(7);

    bus.undo();
    const second = await project.save();
    expect(second).toEqual({ written: [], removed: [mapSourcePath(id)] });
    expect(fs.files.has(mapSourcePath(id))).toBe(false);
  });

  it("project.json の BaseBankCounts をマップ数に使い、JSON だけの新しいマップも数える", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText("maps/project.json", '{"Format":1,"BaseBankCounts":[1,1]}\r\n');
    const base = new RomMapSource(new Rom(rom), BPRJ_OFFSETS).read({ bank: 0, map: 1 });
    const json = MapSourceJson.stringify(MapSourceConverter.toSource(base));
    await fs.writeText("maps/00/01.json", json);
    const project = await CfruProject.open(rom, fs);
    expect(project.base.bankTable.mapCount(0)).toBe(1);
    expect(project.mapIds()).toEqual([
      { bank: 0, map: 0 },
      { bank: 0, map: 1 },
      { bank: 1, map: 0 },
    ]);
    expect(project.inBase({ bank: 0, map: 1 })).toBe(false);
    const loaded = await project.tryLoad({ bank: 0, map: 1 });
    expect(loaded.ok && loaded.fromJson).toBe(true);
    // ベースに無いマップは消さない。
    expect((await project.save()).removed).toEqual([]);
  });

  it("壊れた JSON は tryLoad で理由を返す", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText("maps/project.json", '{"Format":1,"BaseBankCounts":[2,1]}\r\n');
    await fs.writeText("maps/00/00.json", "{ broken");
    const project = await CfruProject.open(rom, fs);
    const result = await project.tryLoad(id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBeInstanceOf(ProjectFormatError);
  });
});
