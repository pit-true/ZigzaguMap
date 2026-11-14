import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildMenu, flattenMenu } from "../src/app/menuDefinition";
import { shortcutMarkdown, shortcutRows } from "../src/app/shortcutList";

const README = readFileSync(new URL("../../../README.md", import.meta.url), "utf-8").replace(/\r\n/g, "\n");

describe("ショートカット一覧", () => {
  it("メニューのショートカットを全部含む", () => {
    const keys = shortcutRows().map((r) => r.keys);
    for (const item of flattenMenu(buildMenu([]))) if (item.shortcut) expect(keys).toContain(item.shortcut.text);
    expect(keys).toContain("Ctrl+Z");
    expect(keys).toContain("Ctrl+Y、Ctrl+Shift+Z");
  });

  it("README の「ショートカット」の節の表と同じ", () => {
    const section = README.slice(README.indexOf("## ショートカット\n"), README.indexOf("\n## 設定\n"));
    const table = shortcutMarkdown().slice(shortcutMarkdown().indexOf("| キー |")).trimEnd();
    expect(section).toContain(table);
  });
});
