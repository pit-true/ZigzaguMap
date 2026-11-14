import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * メインウィンドウ（index.html）が起動で読む束に、CodeMirror が入っていないこと（スクリプトエディタは開いたときだけ読む）。
 * `vite build` の出力（apps/desktop/dist）を調べる。dist が無ければ飛ばす（`pnpm --filter @zigzagumap/desktop build` のあとに
 * `pnpm test` で動く。`scripts\build.cmd` も dist を作る）。
 *
 * minify すると `@codemirror` の文字列は残らないので、CodeMirror の画面の部品のクラス名（`cm-scroller` など）で見分ける。
 */
const DIST = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");
const MARKERS = ["cm-scroller", "cm-gutters", "cm-lineNumbers"];
const built = existsSync(join(DIST, "index.html"));

/** HTML が読む JS（script と modulepreload）から、静的な import をたどった全部（動的な import() はたどらない）。 */
function staticChunks(html: string): Set<string> {
  const queue = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*rel="modulepreload"[^>]*\shref)="\/?([^"]+\.js)"/g)].map((m) => m[1]!);
  const seen = new Set<string>();
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const code = readFileSync(join(DIST, file), "utf8");
    // `import{a as b}from"./x.js"`・`import"./x.js"`・`export{a}from"./x.js"`（同じフォルダの束）
    for (const m of code.matchAll(/(?:^|[;\s}])(?:import|export)\s*(?:[^"'()]*?from\s*)?["']\.\/([^"']+\.js)["']/g)) {
      queue.push(join(dirname(file), m[1]!).replace(/\\/g, "/"));
    }
  }
  return seen;
}

describe.skipIf(!built)("ビルドの束（dist）", () => {
  it("メインの index.html が起動で読む束に CodeMirror が入っていない", () => {
    const chunks = staticChunks(readFileSync(join(DIST, "index.html"), "utf8"));
    expect(chunks.size).toBeGreaterThan(0);
    for (const file of chunks) {
      const code = readFileSync(join(DIST, file), "utf8");
      for (const marker of MARKERS) expect(code.includes(marker), `${file} に ${marker}`).toBe(false);
    }
  });

  it("CodeMirror はスクリプトエディタの束にある（目印の文字列が今の版でも使えるか）", () => {
    const assets = readdirSync(join(DIST, "assets")).filter((f) => f.endsWith(".js"));
    const withMarker = assets.filter((f) => MARKERS.every((m) => readFileSync(join(DIST, "assets", f), "utf8").includes(m)));
    expect(withMarker.length).toBeGreaterThan(0);
    expect(withMarker.some((f) => f.startsWith("ScriptEditorWindow"))).toBe(true);
  });

  it("別ウィンドウの tool.html も、起動では CodeMirror を読まない（スクリプトエディタのウィンドウで初めて読む）", () => {
    const chunks = staticChunks(readFileSync(join(DIST, "tool.html"), "utf8"));
    for (const file of chunks) {
      const code = readFileSync(join(DIST, file), "utf8");
      expect(code.includes("cm-scroller"), file).toBe(false);
    }
  });
});
