import { describe, expect, it } from "vitest";
import {
  CfruProject,
  CommandBus,
  MemoryProjectFs,
  PlaceBlockCommand,
  ProjectFormatError,
  STAMPS_DIR,
  StampLibrary,
  createStamp,
  mapSourcePath,
  parseStamp,
  stampCellValue,
  stampFileBase,
  stampFits,
  stringifyStamp,
} from "../src/index.js";
import { buildSyntheticRom } from "./helpers/syntheticRom.js";

const P1 = 0x082d4a94;
const S1 = 0x082d4aac;
const S2 = 0x082d4b00;
const CREATED = "2026-11-14T12:00:00+09:00";

/** 2×3 の木（ブロック 16〜33、移動許可 1）。 */
function tree(name = "大きな木", secondaryBlock = false) {
  const blocks = [16, 17, 24, 25, 32, secondaryBlock ? 0x281 : 33];
  return createStamp(name, 2, 3, blocks.map((b) => b | (1 << 10)), { primary: P1, secondary: S1 }, CREATED);
}

describe("スタンプのファイル形式", () => {
  it("書いて読むと同じ。cells は行ごと、名前は UTF-8 のまま、CRLF", () => {
    const s = tree();
    const text = stringifyStamp(s);
    expect(text).toBe(
      [
        "{",
        '  "format": 1,',
        '  "name": "大きな木",',
        '  "width": 2,',
        '  "height": 3,',
        '  "primaryTileset": "0x082D4A94",',
        '  "secondaryTileset": "0x082D4AAC",',
        '  "secondaryUsed": false,',
        '  "withMovements": true,',
        '  "cells": [',
        "    [16, 1], [17, 1],",
        "    [24, 1], [25, 1],",
        "    [32, 1], [33, 1]",
        "  ],",
        `  "created": "${CREATED}"`,
        "}",
        "",
      ].join("\r\n"),
    );
    expect(parseStamp(text)).toEqual(s);
  });

  it("null のマスと知らない項目を残す", () => {
    const text = JSON.stringify({
      format: 1,
      name: "L字",
      width: 2,
      height: 2,
      primaryTileset: "0x082D4A94",
      secondaryTileset: "0x082D4AAC",
      secondaryUsed: false,
      cells: [[1, 0], null, [2, 0], [3, 12]],
      created: CREATED,
      memo: { by: "hand" },
    });
    const s = parseStamp(text);
    expect(s.cells[1]).toBeNull();
    expect(s.extra).toEqual({ memo: { by: "hand" } });
    const again = parseStamp(stringifyStamp(s));
    expect(again).toEqual(s);
    expect(stringifyStamp(s)).toContain('"memo": {"by":"hand"}');
  });

  it("形が違えば ProjectFormatError", () => {
    const base = { format: 1, name: "x", width: 1, height: 1, primaryTileset: "0x08000000", secondaryTileset: "0x08000000", cells: [[0, 0]] };
    expect(() => parseStamp(JSON.stringify({ ...base, format: 2 }))).toThrow(ProjectFormatError);
    expect(() => parseStamp(JSON.stringify({ ...base, name: "" }))).toThrow(ProjectFormatError);
    expect(() => parseStamp(JSON.stringify({ ...base, cells: [] }))).toThrow(ProjectFormatError);
    expect(() => parseStamp(JSON.stringify({ ...base, cells: [[1024, 0]] }))).toThrow(ProjectFormatError);
    expect(() => parseStamp(JSON.stringify({ ...base, cells: [[0, 64]] }))).toThrow(ProjectFormatError);
    expect(() => parseStamp(JSON.stringify({ ...base, primaryTileset: "abc" }))).toThrow(ProjectFormatError);
    expect(() => parseStamp("[1]")).toThrow(ProjectFormatError);
  });

  it("secondaryUsed は中身から決める（書いてある値が false でも副のブロックがあれば true）", () => {
    expect(tree("a", true).secondaryUsed).toBe(true);
    const text = stringifyStamp(tree("a", true)).replace('"secondaryUsed": true', '"secondaryUsed": false');
    expect(parseStamp(text).secondaryUsed).toBe(true);
  });

  it("マスの値への変換（移動許可を貼らないときは指定の値）", () => {
    expect(stampCellValue([0x123, 0x0d], true)).toBe(0x123 | (0x0d << 10));
    expect(stampCellValue([0x123, 0x0d], false, 0x01)).toBe(0x123 | (0x01 << 10));
  });
});

describe("貼れるかの判定", () => {
  it("主だけのスタンプは主が同じマップ、副を含むものは主と副が同じマップ", () => {
    const primaryOnly = tree();
    const withSecondary = tree("b", true);
    expect(stampFits(primaryOnly, P1, S1)).toBe(true);
    expect(stampFits(primaryOnly, P1, S2)).toBe(true);
    expect(stampFits(primaryOnly, 0x082d0000, S1)).toBe(false);
    expect(stampFits(withSecondary, P1, S1)).toBe(true);
    expect(stampFits(withSecondary, P1, S2)).toBe(false);
  });
});

describe("ファイル名", () => {
  it("使えない字は _、同じ名前は番号を足す、予約名を避ける", () => {
    expect(stampFileBase('木:2*3/"大"')).toBe("木_2_3__大_");
    expect(stampFileBase("tree", ["TREE"])).toBe("tree_2");
    expect(stampFileBase("tree", ["tree", "tree_2"])).toBe("tree_3");
    expect(stampFileBase("con")).toBe("_con");
    expect(stampFileBase("end. ")).toBe("end");
  });
});

describe("StampLibrary", () => {
  it("作る・読む・名前の変更・上書き・削除がすぐファイルに書かれる", async () => {
    const fs = new MemoryProjectFs();
    const lib = await StampLibrary.open(fs);
    expect(await lib.save(tree())).toBe(`${STAMPS_DIR}/大きな木.json`);
    expect(fs.files.has("maps/stamps/大きな木.json")).toBe(true);
    await expect(lib.save(tree())).rejects.toThrow(/同じ名前/);
    await lib.save(tree("小さな木"));
    expect(lib.list().map((s) => s.name)).toEqual(["小さな木", "大きな木"]);

    // 開き直しても残る。
    const again = await StampLibrary.open(fs);
    expect(again.list().map((s) => s.name)).toEqual(["小さな木", "大きな木"]);
    expect(again.get("大きな木")).toEqual(tree());

    // 名前の変更はファイル名も変える。
    expect(await again.rename("大きな木", "木:大")).toBe("maps/stamps/木_大.json");
    expect(fs.files.has("maps/stamps/大きな木.json")).toBe(false);
    expect(parseStamp(fs.files.get("maps/stamps/木_大.json") as string).name).toBe("木:大");
    await expect(again.rename("木:大", "小さな木")).rejects.toThrow(/同じ名前/);

    // 上書きは作った日時を残す。
    const changed = { ...createStamp("木:大", 1, 1, [5], { primary: P1, secondary: S1 }, "2030-01-01T00:00:00Z") };
    await again.save(changed, true);
    const read = parseStamp(fs.files.get("maps/stamps/木_大.json") as string);
    expect(read.width).toBe(1);
    expect(read.created).toBe(CREATED);

    expect(await again.remove("木:大")).toBe(true);
    expect(fs.files.has("maps/stamps/木_大.json")).toBe(false);
    expect(await again.remove("木:大")).toBe(false);
  });

  it("貼れるものだけを出す", async () => {
    const lib = await StampLibrary.open(new MemoryProjectFs());
    await lib.save(tree("主だけ"));
    await lib.save(tree("副あり", true));
    expect(lib.fitting(P1, S1).map((s) => s.name)).toEqual(["主だけ", "副あり"]);
    expect(lib.fitting(P1, S2).map((s) => s.name)).toEqual(["主だけ"]);
    expect(lib.fitting(0, 0)).toEqual([]);
  });

  it("名前の衝突しないファイル名（同じ元になる別の名前）", async () => {
    const fs = new MemoryProjectFs();
    const lib = await StampLibrary.open(fs);
    await lib.save(tree("a:b"));
    await lib.save(tree("a*b"));
    expect([...fs.files.keys()].sort()).toEqual(["maps/stamps/a_b.json", "maps/stamps/a_b_2.json"]);
    // 上書きしてもファイル名は動かない。
    await lib.save(tree("a*b"), true);
    expect([...fs.files.keys()].sort()).toEqual(["maps/stamps/a_b.json", "maps/stamps/a_b_2.json"]);
  });

  it("読めないファイルは problems に出して、一覧に入れず、消さない", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText("maps/stamps/bad.json", "{");
    await fs.writeText("maps/stamps/note.txt", "x");
    await fs.writeText("maps/stamps/bad2.json", stringifyStamp(tree("bad")));
    const lib = await StampLibrary.open(fs);
    expect(lib.list().map((s) => s.name)).toEqual(["bad"]);
    expect(lib.problems.map((p) => p.path)).toEqual(["maps/stamps/bad.json"]);
    // 新しく作るスタンプが読めないファイルを上書きしない。
    await lib.save(tree("bad", false), true);
    expect(fs.files.get("maps/stamps/bad.json")).toBe("{");
  });

  it("フォルダが無ければメモリに持ち、attach で書く（同じ名前はメモリの方で上書き）", async () => {
    const lib = await StampLibrary.open(null);
    expect(await lib.save(tree())).toBeNull();
    await lib.save(tree("別"));
    expect(lib.pendingCount).toBe(2);
    await lib.rename("別", "別の木");
    expect(await lib.remove("別の木")).toBe(true);

    const fs = new MemoryProjectFs();
    await fs.writeText("maps/stamps/大きな木.json", stringifyStamp(createStamp("大きな木", 1, 1, [1], { primary: P1, secondary: S1 }, CREATED)));
    await fs.writeText("maps/stamps/前から.json", stringifyStamp(tree("前から")));
    expect(await lib.attach(fs)).toEqual(["maps/stamps/大きな木.json"]);
    expect(lib.pendingCount).toBe(0);
    expect(lib.list().map((s) => s.name)).toEqual(["前から", "大きな木"]);
    expect(parseStamp(fs.files.get("maps/stamps/大きな木.json") as string).width).toBe(2);
  });
});

describe("CfruProject と stamps\\", () => {
  it("出力の読み直しに stamps\\ が混ざらない", async () => {
    const rom = buildSyntheticRom();
    const fs = new MemoryProjectFs();
    const lib = await StampLibrary.open(fs);
    await lib.save(tree());
    const project = await CfruProject.open(rom, fs);
    const id = { bank: 0, map: 0 };
    await project.load(id);
    const bus = new CommandBus(project.gridStore());
    bus.execute(new PlaceBlockCommand({ ...id, x: 1, y: 1, block: 7 }));
    const result = await project.save();
    expect(result.written).toEqual(["maps/project.json", mapSourcePath(id)]);
    expect(result.removed).toEqual([]);
    const reopened = await CfruProject.open(rom, fs);
    expect(reopened.hasJson(id)).toBe(true);
    expect(fs.files.has("maps/stamps/大きな木.json")).toBe(true);
    expect(await reopened.save()).toEqual({ written: [], removed: [] });
  });

  it("スタンプを書く前に project.json を作る（Bochi 改造版は maps\\ に JSON があって project.json が無いと開けない）", async () => {
    const rom = buildSyntheticRom();
    const fs = new MemoryProjectFs();
    const project = await CfruProject.open(rom, fs);
    const lib = await StampLibrary.open(fs, { beforeWrite: () => project.ensureManifest() });
    await lib.save(tree());
    expect(fs.files.get("maps/project.json")).toBe('{"Format":1,"BaseBankCounts":[2,1]}\r\n');
    expect(await project.ensureManifest()).toBeNull();
    // 出力しても project.json は書き直さない（同じ内容）。
    expect(await project.save()).toEqual({ written: [], removed: [] });
  });

  it("withMovements（パレットから作ったスタンプ）を読み書きする。省略時は true", () => {
    const s = createStamp("パレット", 1, 1, [5], { primary: P1, secondary: S1 }, CREATED, false);
    expect(parseStamp(stringifyStamp(s)).withMovements).toBe(false);
    const text = stringifyStamp(tree()).replace('  "withMovements": true,\r\n', "");
    expect(parseStamp(text).withMovements).toBe(true);
  });

  it("出力先を移すと、今のスタンプを全部移した先に書く", async () => {
    const a = new MemoryProjectFs();
    const lib = await StampLibrary.open(a);
    await lib.save(tree("木"));
    const b = new MemoryProjectFs();
    await b.writeText("maps/stamps/前から.json", stringifyStamp(tree("前から")));
    expect(await lib.relocate(b)).toEqual(["maps/stamps/木.json"]);
    expect(lib.list().map((s) => s.name)).toEqual(["前から", "木"]);
    expect(b.files.has("maps/stamps/木.json")).toBe(true);
  });
});
