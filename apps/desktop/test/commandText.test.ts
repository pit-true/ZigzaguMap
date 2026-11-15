import { describe, expect, it } from "vitest";
import { createDefaultRegistry } from "@zigzagumap/core";
import { commandText } from "../src/app/commandText";
import { jaCommands } from "../src/i18n/ja.commands";

describe("履歴の窓の文（#402）", () => {
  it("登録済みのコマンドの名前がすべて表にある", () => {
    const missing = createDefaultRegistry()
      .names()
      .filter((name) => !(name in jaCommands.names));
    expect(missing).toEqual([]);
  });

  it("対象のマップを後ろに付ける", () => {
    expect(commandText({ name: "paintBlocks", args: { bank: 3, map: 0 } })).toBe("ブロックを塗る（3.0）");
    expect(commandText({ name: "setRegionCells", args: { page: 0 } })).toBe("タウンマップのマスの変更");
  });

  it("表に無い名前はそのまま", () => {
    expect(commandText({ name: "somethingNew", args: {} })).toBe("somethingNew");
  });

  it("まとめた操作は中の名前で", () => {
    const place = { name: "placeBlock", args: { bank: 3, map: 0 } };
    const remove = { name: "removeEvent", args: { bank: 3, map: 0 } };
    expect(commandText({ name: "group", args: { commands: [place, place, place], bank: 3, map: 0 } })).toBe("ブロックを置く × 3（3.0）");
    expect(commandText({ name: "group", args: { commands: [place], bank: 3, map: 0 } })).toBe("ブロックを置く（3.0）");
    expect(commandText({ name: "group", args: { commands: [remove, place, place] } })).toBe(`${jaCommands.names["removeEvent"]} ほか 2 件`);
  });
});
