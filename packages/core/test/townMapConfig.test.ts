import { describe, expect, it } from "vitest";
import {
  EMPTY_TOWN_LINKS,
  MemoryProjectFs,
  ProjectFormatError,
  SCRIPT_CONFIG_FILE,
  ScriptConfigJson,
  loadTownMapConfig,
  parseTownMapConfig,
  readTownLinks,
  saveScriptConfig,
  saveTownMapConfig,
  stringifyTownMapConfig,
  type TownLinks,
} from "../src/index.js";

const rect = (page: number, x: number, y: number, width = 1, height = 1) => ({ page, x, y, width, height });

function links(sections: [number, ReturnType<typeof rect>][], maps: [string, ReturnType<typeof rect>][] = []): TownLinks {
  return { sections: new Map(sections), maps: new Map(maps) };
}

describe("タウンマップの紐づけ（zigzagumap.json の townMap）", () => {
  it("ファイルや節が無ければ空", () => {
    expect(parseTownMapConfig(null)).toEqual(EMPTY_TOWN_LINKS);
    expect(parseTownMapConfig("")).toEqual(EMPTY_TOWN_LINKS);
    expect(parseTownMapConfig('{"script":{}}').sections.size).toBe(0);
  });

  it("地名の鍵は 16 進と 10 進、マップの鍵はバンク.マップ。page・width・height は省くと 0・1・1", () => {
    const l = parseTownMapConfig(
      JSON.stringify({ townMap: { sections: { "0x58": rect(0, 4, 11, 2, 1), "89": { x: 1, y: 2 } }, maps: { "3.0": rect(1, 5, 6) } } }),
    );
    expect(l.sections.get(0x58)).toEqual(rect(0, 4, 11, 2, 1));
    expect(l.sections.get(89)).toEqual(rect(0, 1, 2));
    expect(l.maps.get("3.0")).toEqual(rect(1, 5, 6));
  });

  it("壊れた項目は読み飛ばす（表の外・数でない・鍵が読めない・節がオブジェクトでない）", () => {
    const l = parseTownMapConfig(
      JSON.stringify({
        townMap: {
          sections: { "0x58": rect(0, 21, 0, 2, 1), "0x59": { x: "1", y: 2 }, zz: rect(0, 1, 1), "0x5A": rect(4, 0, 0), "0x5B": rect(0, 1, 1) },
          maps: { "3": rect(0, 1, 1), "3.0": [1, 2], "3.1": rect(0, 0, 14) },
        },
      }),
    );
    expect([...l.sections.keys()]).toEqual([0x5b]);
    expect([...l.maps.keys()]).toEqual(["3.1"]);
    expect(parseTownMapConfig('{"townMap":[1,2]}')).toEqual(EMPTY_TOWN_LINKS);
    expect(readTownLinks({ sections: "x", maps: null })).toEqual(EMPTY_TOWN_LINKS);
  });

  it("JSON として読めなければ ProjectFormatError（書くときも壊さない）", () => {
    expect(() => parseTownMapConfig("{ broken")).toThrow(ProjectFormatError);
    expect(() => stringifyTownMapConfig(links([[0x58, rect(0, 1, 1)]]), "{ broken")).toThrow(ProjectFormatError);
  });

  it("書くとき、ほかの節・知らない項目・読み飛ばした壊れた項目を残し、外した紐づけは消す", () => {
    const before = JSON.stringify({
      script: { dialect: "nd", extra: 1 },
      other: [1, 2],
      townMap: {
        note: "手で書いた",
        sections: { "0x58": rect(0, 1, 1), "88": rect(0, 9, 9), "0x60": { x: "壊れ" }, bad: 1, "0x61": rect(0, 2, 2) },
        maps: { "3.0": rect(0, 3, 3), "x.y": 2 },
      },
    });
    const text = stringifyTownMapConfig(links([[0x58, rect(1, 4, 5, 2, 3)]], [["3.1", rect(0, 6, 7)]]), before);
    expect(text.endsWith("}\n")).toBe(true);
    const root = JSON.parse(text);
    expect(root.script).toEqual({ dialect: "nd", extra: 1 });
    expect(root.other).toEqual([1, 2]);
    expect(root.townMap.note).toBe("手で書いた");
    // 0x58 は 1 つにまとまる（10 進の "88" は消える）、0x61 は外したので消える、壊れた 0x60 と鍵の読めない bad は残る
    expect(root.townMap.sections).toEqual({ "0x60": { x: "壊れ" }, bad: 1, "0x58": rect(1, 4, 5, 2, 3) });
    expect(root.townMap.maps).toEqual({ "x.y": 2, "3.1": rect(0, 6, 7) });
    // 読み直すと同じ
    const again = parseTownMapConfig(text);
    expect(again.sections.get(0x58)).toEqual(rect(1, 4, 5, 2, 3));
    expect(again.maps.get("3.1")).toEqual(rect(0, 6, 7));
    expect(again.maps.has("3.0")).toBe(false);
  });

  it("壊れた項目と同じ地名を紐づけたら置き換える", () => {
    const before = JSON.stringify({ townMap: { sections: { "0x58": { x: -1 } } } });
    const root = JSON.parse(stringifyTownMapConfig(links([[0x58, rect(0, 1, 1)]]), before));
    expect(root.townMap.sections).toEqual({ "0x58": rect(0, 1, 1) });
  });

  it("プロジェクトに書くとスクリプトの節は残り、スクリプトの設定を書いても紐づけは残る", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText(SCRIPT_CONFIG_FILE, JSON.stringify({ script: { dialect: "nd" } }));
    await saveTownMapConfig(fs, links([[0x58, rect(0, 4, 11)]]));
    expect(ScriptConfigJson.parse(await fs.readText(SCRIPT_CONFIG_FILE)).settings.dialect).toBe("nd");
    await saveScriptConfig(fs, { dialect: "chronos" });
    expect((await loadTownMapConfig(fs)).sections.get(0x58)).toEqual(rect(0, 4, 11));
  });

  it("ファイルが無ければ作る", async () => {
    const fs = new MemoryProjectFs();
    await saveTownMapConfig(fs, links([], [["3.0", rect(2, 1, 1)]]));
    expect(JSON.parse(await fs.readText(SCRIPT_CONFIG_FILE))).toEqual({ townMap: { sections: {}, maps: { "3.0": rect(2, 1, 1) } } });
  });
});
