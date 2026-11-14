import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeProjectFs } from "../src/node/index.js";
import { applyAsmLineEnding, buildScriptIndex, indexAsmFile, splitAsmLines } from "../src/index.js";

/** 実フォルダ（CFRU-JP のフォルダ）。設定されていなければそのフォルダのテストは飛ばす。読むだけで書かない。 */
const projects = [
  { name: "ND", dir: process.env.ZIGZAGU_ND_DIR },
  { name: "Chronos", dir: process.env.ZIGZAGU_CHRONOS_DIR },
];

/** grep と同じ規則（行頭の空白の後の `名前:`）で数える。`/* *\/` の中は先に消しておく（改行は残す）。 */
function grepLabelCount(text: string): number {
  const stripped = text.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  return splitAsmLines(stripped).filter((l) => /^\s*[A-Za-z_.][A-Za-z0-9_.]*:/.test(l)).length;
}

for (const { name, dir } of projects) {
  describe.skipIf(!dir)(`実フォルダの .s（${name}）`, () => {
    it("overworld_scripts の全ラベルを grep と同じ数だけ拾う", () => {
      const folder = join(dir!, "assembly", "overworld_scripts");
      let grep = 0;
      let raw = 0;
      let found = 0;
      for (const file of readdirSync(folder).filter((f) => f.endsWith(".s"))) {
        const text = readFileSync(join(folder, file), "utf8");
        const entry = indexAsmFile(`assembly/overworld_scripts/${file}`, text);
        const expected = grepLabelCount(text);
        expect(entry.labels.length, file).toBe(expected);
        grep += expected;
        raw += splitAsmLines(text).filter((l) => /^\s*[A-Za-z_.][A-Za-z0-9_.]*:/.test(l)).length;
        found += entry.labels.length;
      }
      console.log(`${name}: overworld_scripts のラベル ${found}（grep ${raw}、/* */ を除くと ${grep}）`);
      expect(found).toBeGreaterThan(100);
    });

    it("全ファイルの索引を作り、写しの JSON が 1MB 未満", async () => {
      const fs = new NodeProjectFs(dir!);
      const started = performance.now();
      const index = await buildScriptIndex(fs);
      const ms = performance.now() - started;
      const json = JSON.stringify(index.toSnapshot());
      const bytes = new TextEncoder().encode(json).length;
      console.log(
        `${name}: ${index.paths().length} ファイル、ラベル ${index.allLabels().length}、.equ ${index.allEqus().length}、` +
          `移動 ${index.movementNames().length}、JSON ${bytes} バイト、${ms.toFixed(0)}ms`,
      );
      expect(bytes).toBeLessThan(1024 * 1024);
      expect(index.movementNames()).toContain("walk_up");
      expect(index.findEqu("walk_up")?.value).toBe("0x11");
      expect(index.allLabels().length).toBeGreaterThan(1000);
      for (const label of index.allLabels().slice(0, 50)) expect(index.findLabels(label.name)).toContain(label);
    });

    it("改行を覚えて、書き戻すときに同じ改行にそろえられる", async () => {
      const fs = new NodeProjectFs(dir!);
      const index = await buildScriptIndex(fs);
      for (const path of index.paths()) {
        const text = await fs.readText(path);
        const eol = index.lineEndingOf(path)!;
        const mixed = text.includes("\r\n") && /(^|[^\r])\n/.test(text);
        if (!mixed) expect(applyAsmLineEnding(text.replace(/\r\n/g, "\n"), eol), path).toBe(text);
      }
    });
  });
}
