import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderMarkdown } from "../src/ui/help/markdown";

// ヘルプの中で開ける文書の表（HelpWindows.ts の DOCS）と、docs の文書・リンクを突き合わせる（#535）。
const root = new URL("../../../", import.meta.url);
const source = readFileSync(new URL("../src/ui/help/HelpWindows.ts", import.meta.url), "utf-8");
const table = new Set([...source.slice(source.indexOf("const DOCS = {")).matchAll(/^\s+"([^"]+)": \w+,$/gm)].map((m) => m[1]!));
table.add("LICENSE");

describe("ヘルプで開ける文書の表", () => {
  it("docs の文書と build-support の README を全部入れている", () => {
    const docs = readdirSync(new URL("docs/", root)).filter((f) => f.endsWith(".md")).map((f) => `docs/${f}`);
    for (const path of [...docs, "README.md", "build-support/README.md"]) expect(table, path).toContain(path);
  });

  it("表の文書からのリンクの行き先が、どれも表にある", () => {
    const missing: string[] = [];
    for (const path of table) {
      if (!path.endsWith(".md")) continue;
      const { html } = renderMarkdown(readFileSync(new URL(path, root), "utf-8"), path);
      for (const m of html.matchAll(/data-link="([^"]*)"/g)) {
        const link = m[1]!.replace(/&amp;/g, "&");
        if (/^https?:\/\//i.test(link) || link.startsWith("#")) continue;
        const target = link.split("#")[0]!;
        if (!table.has(target)) missing.push(`${path} → ${target}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
