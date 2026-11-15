import { afterEach, describe, expect, it } from "vitest";
import {
  KEY_ACTIONS,
  applyKeyOverrides,
  chordCode,
  chordOf,
  chordText,
  conflictOf,
  defaultKeymap,
  findConflicts,
  keyText,
  keymapOverrides,
  matchesKey,
  parseChord,
  releasesKey,
  resolveKeymap,
} from "../src/app/keymap";
import { buildMenu, flattenMenu } from "../src/app/menuDefinition";
import { keyActionNames, shortcutRows } from "../src/app/shortcutList";

const ev = (key: string, mods: { ctrl?: boolean; alt?: boolean; shift?: boolean } = {}) => ({
  key,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
});

afterEach(() => applyKeyOverrides({}));

describe("ショートカットの表（#392）", () => {
  it("既定のキーは今までと同じ表記で、重なりが無い", () => {
    expect(findConflicts(defaultKeymap())).toEqual([]);
    expect(keyText("tools.pointers")).toBe("Ctrl+Shift+P");
    expect(keyText("tools.previousMap")).toBe("Alt+BkSp");
    expect(keyText("view.forward")).toBe("Alt+Shift+BkSp");
    expect(keyText("edit.redo")).toBe("Ctrl+Y、Ctrl+Shift+Z");
    expect(keyText("dive.hold")).toBe("Space");
    expect(keyText("file.reload")).toBe("F5");
    expect(keyText("view.history")).toBe("Ctrl+E");
    expect(keyText("blockEditor.edit.copy")).toBe("Ctrl+C");
    expect(keyText("blockEditor.edit.swap")).toBe("X");
  });

  it("メニューの項目は表から作ったキーを持ち、表のメニューの操作は全部メニューにある", () => {
    const ids = new Set(flattenMenu(buildMenu([])).flatMap((i) => (i.id ? [i.id] : [])));
    for (const a of KEY_ACTIONS.filter((a) => a.menu)) expect(ids.has(a.id), a.id).toBe(true);
    const item = flattenMenu(buildMenu([])).find((i) => i.id === "view.grid");
    expect(item?.shortcut?.text).toBe("Ctrl+G");
    expect(keyActionNames().find((n) => n.id === "view.grid")?.action).toBe("表示 > グリッドの表示");
  });

  it("表記と個人設定の形を行き来できる", () => {
    for (const a of KEY_ACTIONS) for (const ch of a.defaults) expect(parseChord(chordCode(ch))).toEqual(ch);
    expect(parseChord("Ctrl+Shift+P")).toEqual({ key: "P", ctrl: true, shift: true });
    expect(parseChord("Ctrl++")).toEqual({ key: "+", ctrl: true });
    expect(parseChord("Shift")).toBeNull();
    expect(parseChord(3)).toBeNull();
    expect(chordText({ key: "ESCAPE" })).toBe("Esc");
  });

  it("押したキーを読む（修飾キーだけは読まない）", () => {
    expect(chordOf(ev("Control", { ctrl: true }))).toBeNull();
    expect(chordOf(ev(" "))).toEqual({ key: "SPACE" });
    expect(chordOf(ev("z", { ctrl: true }))).toEqual({ key: "Z", ctrl: true });
    expect(matchesKey("edit.undo", ev("z", { ctrl: true }))).toBe(true);
    expect(matchesKey("edit.undo", ev("z", { ctrl: true, shift: true }))).toBe(false);
    expect(matchesKey("edit.redo", ev("Z", { ctrl: true, shift: true }))).toBe(true);
    expect(matchesKey("tool.pencil", ev("n"))).toBe(true);
    expect(matchesKey("tool.pencil", ev("n", { ctrl: true }))).toBe(false);
    expect(releasesKey("dive.hold", ev(" "))).toBe(true);
  });

  it("重なりは、受ける場所が重なる操作どうしだけ", () => {
    const map = defaultKeymap();
    // N はマップタブ・移動エリアタブの鉛筆。メニュー（どのタブでも）に N を決めると重なる
    expect(conflictOf(map, "view.cursorFrame", { key: "N" })).toBe("tool.pencil");
    // Ctrl+D はイベントタブだけ。マップタブだけのコピーとは重ならない
    expect(conflictOf(map, "stamp.copy", { key: "D", ctrl: true })).toBeNull();
    // Ctrl+S（出力）は別ウィンドウでも受けるので、どの操作とも重なる
    expect(conflictOf(map, "tool.fill", { key: "S", ctrl: true })).toBe("file.export");
  });

  it("個人設定には既定と違うものだけ残し、読み直すと同じになる", () => {
    const map = { ...defaultKeymap(), "tool.fill": [{ key: "F" }], "view.grid": [] };
    const saved = keymapOverrides(map);
    expect(saved).toEqual({ "tool.fill": ["F"], "view.grid": [] });
    expect(JSON.parse(JSON.stringify(resolveKeymap(saved)))).toEqual(JSON.parse(JSON.stringify(map)));
    expect(keymapOverrides(defaultKeymap())).toEqual({});
    // 表に無い操作・読めないキー・3 つ目は捨てる
    expect(resolveKeymap({ nothing: ["A"], "edit.redo": ["Ctrl+Y", "Shift", "Ctrl+Q", "Ctrl+W"] })["edit.redo"]).toEqual([
      { key: "Y", ctrl: true },
      { key: "Q", ctrl: true },
    ]);
  });

  it("当てるとメニューとショートカット一覧がすぐ変わる", () => {
    applyKeyOverrides({ "view.grid": ["Ctrl+Shift+G"], "tool.pencil": ["Q", "Alt+N"], "event.delete": [] });
    expect(flattenMenu(buildMenu([])).find((i) => i.id === "view.grid")?.shortcut?.text).toBe("Ctrl+Shift+G");
    const rows = shortcutRows();
    expect(rows.some((r) => r.keys === "Q、Alt+N")).toBe(true);
    expect(rows.some((r) => r.keys === "")).toBe(false);
    expect(matchesKey("tool.pencil", ev("q"))).toBe(true);
    expect(matchesKey("tool.pencil", ev("n"))).toBe(false);
    expect(matchesKey("view.grid", ev("g", { ctrl: true }))).toBe(false);
  });
});
