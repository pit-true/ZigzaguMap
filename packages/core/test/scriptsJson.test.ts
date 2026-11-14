import { describe, expect, it } from "vitest";
import {
  MemoryProjectFs,
  ProjectFormatError,
  ScriptsJsonFile,
  defaultScriptsJsonStringsPath,
  findScriptsJsonDuplicates,
  loadScriptsJson,
  resolveScriptsJson,
  saveScriptsJson,
  type ScriptsJson,
} from "../src/index.js";

/** Bochi と同じ整形（2 空白の字下げ、CRLF、ASCII 以外は \uXXXX）で書いた見本。 */
const SAMPLE = [
  "{",
  '  "Format": 1,',
  '  "Entries": [',
  "    {",
  '      "Bank": 1,',
  '      "Name": "\\u30D0\\u30F3\\u30AF1",',
  '      "Script": "assembly/overworld_scripts/bank01.s",',
  '      "Strings": "strings/bank01.string"',
  "    },",
  "    {",
  '      "Bank": 1,',
  '      "Map": 0,',
  '      "Name": "Moegi",',
  '      "Script": "assembly/overworld_scripts/01_moegi.s",',
  '      "Memo": {',
  '        "Tags": [',
  '          "a",',
  "          2",
  "        ]",
  "      }",
  "    }",
  "  ],",
  '  "Editor": true',
  "}",
  "",
].join("\r\n");

describe("maps/scripts.json", () => {
  it("読んで書くと同じ文字列になり、知らない項目も残る", () => {
    const doc = ScriptsJsonFile.parse(SAMPLE);
    expect(doc.entries).toHaveLength(2);
    expect(doc.entries[0]).toMatchObject({ bank: 1, map: null, name: "バンク1", strings: "strings/bank01.string" });
    expect(doc.entries[1]).toMatchObject({ bank: 1, map: 0, strings: null, extra: { Memo: { Tags: ["a", 2] } } });
    expect(doc.extra).toEqual({ Editor: true });
    expect(ScriptsJsonFile.stringify(doc)).toBe(SAMPLE);
  });

  it("マップの項目がバンクの項目より優先される", () => {
    const doc = ScriptsJsonFile.parse(SAMPLE);
    const moegi = resolveScriptsJson(doc, 1, 0)!;
    expect(moegi.entryIndex).toBe(1);
    expect(moegi.script).toBe("assembly/overworld_scripts/01_moegi.s");
    expect(moegi.strings).toBe("strings/overworld_strings_01_moegi.string");
    const other = resolveScriptsJson(doc, 1, 5)!;
    expect(other.entryIndex).toBe(0);
    expect(other.strings).toBe("strings/bank01.string");
    expect(resolveScriptsJson(doc, 3, 0)).toBeNull();
  });

  it("Strings を省いたときの名前", () => {
    expect(defaultScriptsJsonStringsPath("assembly/overworld_scripts/01_moegi.s")).toBe("strings/overworld_strings_01_moegi.string");
    expect(defaultScriptsJsonStringsPath("assembly\\overworld_scripts\\a.b.s")).toBe("strings/overworld_strings_a.b.string");
    expect(defaultScriptsJsonStringsPath("noext")).toBe("strings/overworld_strings_noext.string");
  });

  it("同じバンク・マップの項目を見つける", () => {
    const doc = ScriptsJsonFile.parse(SAMPLE);
    const dup: ScriptsJson = { ...doc, entries: [...doc.entries, { ...doc.entries[1]!, name: "dup" }, { ...doc.entries[0]! }] };
    expect(findScriptsJsonDuplicates(dup)).toEqual([
      { first: 1, duplicate: 2 },
      { first: 0, duplicate: 3 },
    ]);
  });

  it("形式が不正なら ProjectFormatError", () => {
    const bad = [
      '{"Format":2,"Entries":[]}',
      '{"Format":1,"Entries":[{"Bank":1}]}',
      '{"Format":1,"Entries":[{"Bank":300,"Script":"a.s"}]}',
      '{"Format":1,"Entries":[{"Bank":1,"Map":"0","Script":"a.s"}]}',
      '{"Format":1,"Entries":{}}',
      "[]",
    ];
    for (const text of bad) expect(() => ScriptsJsonFile.parse(text)).toThrow(ProjectFormatError);
  });

  it("ProjectFs で読み書きする（無ければ null）", async () => {
    const fs = new MemoryProjectFs();
    expect(await loadScriptsJson(fs)).toBeNull();
    const doc = ScriptsJsonFile.empty();
    await saveScriptsJson(fs, {
      ...doc,
      entries: [{ bank: 3, map: 0, name: "マサラ", script: "assembly/overworld_scripts/03_00.s", strings: null, extra: {} }],
    });
    expect(fs.files.get("maps/scripts.json")).toBe(
      '{\r\n  "Format": 1,\r\n  "Entries": [\r\n    {\r\n      "Bank": 3,\r\n      "Map": 0,\r\n      "Name": "\\u30DE\\u30B5\\u30E9",\r\n      "Script": "assembly/overworld_scripts/03_00.s"\r\n    }\r\n  ]\r\n}\r\n',
    );
    expect((await loadScriptsJson(fs))!.entries[0]!.name).toBe("マサラ");
  });
});
