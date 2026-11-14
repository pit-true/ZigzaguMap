import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { renderInline, renderMarkdown, resolveLink, slugify } from "../src/ui/help/markdown";

const README = readFileSync(new URL("../../../README.md", import.meta.url), "utf-8");

describe("ヘルプの Markdown の変換", () => {
  it("見出し・段落・強調・コード", () => {
    const { html, headings } = renderMarkdown("# 題名\n\n本文の **太字** と `code<b>` と *斜体*。\n続きの行", "README.md");
    expect(html).toContain('<h1 id="題名">題名</h1>');
    expect(html).toContain("<strong>太字</strong>");
    expect(html).toContain("<code>code&lt;b&gt;</code>");
    expect(html).toContain("<em>斜体</em>");
    expect(html).toContain("<br>続きの行");
    expect(headings).toEqual([{ level: 1, text: "題名", id: "題名" }]);
  });

  it("HTML とスクリプトは文字として出す", () => {
    const { html } = renderMarkdown('<script>alert(1)</script>\n\n<img src=x onerror="alert(1)">\n\n[x](javascript:alert(1))', "README.md");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("javascript:");
  });

  it("箇条書き（入れ子と番号つき）", () => {
    const { html } = renderMarkdown("- a\n  - b\n  - c\n- d\n\n1. x\n2. y", "README.md");
    expect(html).toContain("<ul><li>a<ul><li>b</li><li>c</li></ul></li><li>d</li></ul>");
    expect(html).toContain("<ol><li>x</li><li>y</li></ol>");
  });

  it("表（\\| は文字の |）とコードブロック", () => {
    const { html } = renderMarkdown("| キー | 値 |\n|---|---|\n| `a\\|b` | 1 |\n\n```sh\necho <x>\n```", "README.md");
    expect(html).toContain("<thead><tr><th>キー</th><th>値</th></tr></thead>");
    expect(html).toContain("<td><code>a|b</code></td><td>1</td>");
    expect(html).toContain('<pre class="md-code" data-lang="sh"><code>echo &lt;x&gt;</code></pre>');
  });

  it("リンクの行き先", () => {
    expect(resolveLink("#使い方", "README.md")).toEqual({ kind: "anchor", id: "使い方" });
    expect(resolveLink("docs/automation.md", "README.md")).toEqual({ kind: "doc", path: "docs/automation.md", id: null });
    expect(resolveLink("../README.md#設定", "docs/automation.md")).toEqual({ kind: "doc", path: "README.md", id: "設定" });
    expect(resolveLink("https://github.com/pit-true/ZigzaguMap", "README.md")).toEqual({ kind: "external", url: "https://github.com/pit-true/ZigzaguMap" });
    expect(resolveLink("javascript:alert(1)", "README.md")).toEqual({ kind: "none" });
    expect(resolveLink("../../x.md", "README.md")).toEqual({ kind: "none" });
    expect(renderInline("[A](docs/compare-test.md)", "README.md")).toContain('data-link="docs/compare-test.md"');
  });

  it("見出しのアンカーは GitHub と同じ", () => {
    expect(slugify("AdvanceMap と違う点")).toBe("advancemap-と違う点");
    expect(slugify("「保存」ボタンの読み替え")).toBe("保存ボタンの読み替え");
    expect(slugify("新規マップ・作成したマップ（.map / .evt）")).toBe("新規マップ作成したマップmap--evt");
    expect(slugify("maps\\regionmap.json")).toBe("mapsregionmapjson");
  });

  it("README の目次のリンクは全部、README の見出しを指す", () => {
    const { html, headings } = renderMarkdown(README, "README.md");
    const ids = new Set(headings.map((h) => h.id));
    const anchors = [...html.matchAll(/data-link="#([^"]+)"/g)].map((m) => m[1]!.replace(/&amp;/g, "&"));
    expect(anchors.length).toBeGreaterThan(5);
    for (const a of anchors) expect(ids, a).toContain(a);
    expect(html).not.toContain("<script");
  });
});
