import { describe, expect, it } from "vitest";
import { buildMenu, flattenMenu, type MenuItem } from "../src/app/menuDefinition";
import { ja } from "../src/i18n/ja";

const ids = (items: readonly MenuItem[]): string[] => flattenMenu(items).flatMap((i) => (i.id ? [i.id] : []));

describe("メニューの構成（Phase1 のフィードバック）", () => {
  const menu = buildMenu([]);

  it("ファイル・表示・設定・ツール・ヘルプの順", () => {
    expect(menu.map((m) => m.label)).toEqual([ja.menuFile, ja.menuView, ja.menuSettings, ja.menuTools, ja.menuHelp]);
  });

  it("見た目の項目は「表示」にあり、「設定」には無い", () => {
    const view = ids(menu[1]!.children!);
    const settings = ids(menu[2]!.children!);
    const looks = ["view.grid", "view.objects", "zoom.map", "zoom.movement", "zoom.event", "zoom.palette", "zoom.movementPalette", "view.opacity", "view.paletteWidth", "view.toolbar", "view.combobox", "view.hideEventPanel", "opt.advancedHeader", "sort.0", "sort.4", "neighbors.band", "neighbors.all", "neighbors.off", "view.usageMarks", "view.clones"];
    for (const id of looks) {
      expect(view).toContain(id);
      expect(settings).not.toContain(id);
    }
    expect(settings).toEqual(["opt.rememberLast", "opt.autoSearch", "opt.backupOnOpen", "opt.romShortcut", "opt.contextMenu", "opt.alignConnections", "recent.max", "recent.clear", "recent.showPath", "theme.light", "theme.dark"]);
  });

  it("設定 > テーマに明るい標準色とダークがある（Phase2。画面全体の配色なので設定に置く）", () => {
    const theme = menu[2]!.children!.find((i) => i.label === ja.themeMenu);
    expect(theme?.children?.map((i) => i.id)).toEqual(["theme.light", "theme.dark"]);
  });

  it("言語・スクリプトエディタ・ini の項目は無い", () => {
    const all = ids(menu);
    for (const id of ["lang.ja", "opt.scriptEditor", "display.header", "display.ini", "display.createIni"]) expect(all).not.toContain(id);
  });

  it("同じ階層のアクセスキーは重ならない", () => {
    const check = (items: readonly MenuItem[]): void => {
      const keys = items.flatMap((i) => (i.accel && !i.inlineAccel ? [i.accel] : []));
      expect(new Set(keys).size).toBe(keys.length);
      for (const i of items) if (i.children) check(i.children);
    };
    check(menu);
  });
});
