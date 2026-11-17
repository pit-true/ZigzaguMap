import { describe, expect, it } from "vitest";
import { searchProject } from "../src/index.js";

const files = [
  { path: "a.s", text: "Main:\r\n\tsetflag FLAG_GOT_ITEM\r\n\tcheckflag FLAG_GOT_ITEM_2\r\n\tend\r\n" },
  { path: "strings/b.string", text: "#org @gText_A\nflag_got_item は小文字\n" },
];

describe("スクリプトエディタの全ファイル検索（#520）", () => {
  it("ファイルごとに一致した行と位置を出す。既定は大文字小文字を区別しない", () => {
    const r = searchProject(files, { text: "flag_got_item" });
    expect(r.files.map((f) => [f.path, f.lines.map((l) => l.line)])).toEqual([["a.s", [2, 3]], ["strings/b.string", [2]]]);
    expect(r.files[0]!.lines[0]).toEqual({ line: 2, text: "\tsetflag FLAG_GOT_ITEM", ranges: [[9, 22]] });
    expect(r.count).toBe(3);
    expect(r.truncated).toBe(false);
  });

  it("大文字小文字の区別・単語単位・正規表現", () => {
    expect(searchProject(files, { text: "flag_got_item", caseSensitive: true }).count).toBe(1);
    expect(searchProject(files, { text: "FLAG_GOT_ITEM", wholeWord: true }).files.map((f) => f.lines.map((l) => l.line))).toEqual([[2], [2]]);
    const re = searchProject(files, { text: "^\t(set|check)flag", regexp: true, caseSensitive: true });
    expect(re.files[0]!.lines.map((l) => l.ranges)).toEqual([[[0, 8]], [[0, 10]]]);
    // 正規表現として読まないときは記号もそのまま探す
    expect(searchProject([{ path: "x", text: "a.b axb" }], { text: "a.b" }).files[0]!.lines[0]!.ranges).toEqual([[0, 3]]);
  });

  it("正しくない正規表現は結果なしで誤りを返す。空の文字は何も探さない", () => {
    const bad = searchProject(files, { text: "(", regexp: true });
    expect(bad.files).toEqual([]);
    expect(bad.error).not.toBeNull();
    expect(searchProject(files, { text: "" })).toEqual({ files: [], count: 0, truncated: false, error: null });
    // 幅 0 の一致でも止まる
    expect(searchProject([{ path: "x", text: "ab" }], { text: "", regexp: true }).count).toBe(0);
    expect(searchProject([{ path: "x", text: "ab\ncd" }], { text: "^", regexp: true }).count).toBe(2);
  });

  it("上限で止め、止めたことを返す（ちょうど上限なら止めたことにしない）", () => {
    const many = [{ path: "m.s", text: Array.from({ length: 12 }, () => "hit").join("\n") }, { path: "n.s", text: "hit" }];
    const r = searchProject(many, { text: "hit" }, 10);
    expect(r.count).toBe(10);
    expect(r.truncated).toBe(true);
    expect(r.files).toHaveLength(1);
    expect(searchProject([{ path: "m.s", text: "hit\nhit" }], { text: "hit" }, 2).truncated).toBe(false);
  });

  it("未保存の本文の優先は渡す側で決める（渡した本文だけを探す）", () => {
    const disk = { path: "a.s", text: "old_label:" };
    const tab = { path: "a.s", text: "new_label:" };
    const merged = [disk].map((f) => (f.path === tab.path ? tab : f));
    expect(searchProject(merged, { text: "new_label" }).count).toBe(1);
    expect(searchProject(merged, { text: "old_label" }).count).toBe(0);
  });
});
