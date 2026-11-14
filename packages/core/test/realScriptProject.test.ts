import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EventScriptsFile, ScriptsJsonFile, defaultScriptsJsonStringsPath } from "../src/index.js";

/** 実フォルダ（CFRU-JP のプロジェクトフォルダ）。設定されていなければ、そのフォルダのテストは飛ばす。読むだけで書かない。 */
const folders = [
  { name: "ND（ZIGZAGU_ND_DIR）", dir: process.env.ZIGZAGU_ND_DIR },
  { name: "Chronos（ZIGZAGU_CHRONOS_DIR）", dir: process.env.ZIGZAGU_CHRONOS_DIR },
];

for (const { name, dir } of folders) {
  describe.skipIf(!dir)(`実フォルダの eventscripts と scripts.json: ${name}`, () => {
    it("eventscripts を読んで書くと 1 バイトも変わらず、読めない行が無い", () => {
      const path = join(dir!, "eventscripts");
      if (!existsSync(path)) return;
      const text = readFileSync(path, "utf8");
      const file = EventScriptsFile.parse(text);
      expect(file.stringify()).toBe(text);
      expect(file.lines().filter((l) => l.type === "unknown").map((l) => l.text)).toEqual([]);
    });

    it("maps/scripts.json があれば読んで書き直しても中身が変わらない", () => {
      const path = join(dir!, "maps", "scripts.json");
      if (!existsSync(path)) return;
      const doc = ScriptsJsonFile.parse(readFileSync(path, "utf8"));
      expect(ScriptsJsonFile.parse(ScriptsJsonFile.stringify(doc))).toEqual(doc);
    });

    it("Strings を省いたときの名前が、実フォルダの .s と対の .string を指す", () => {
      const scripts = join(dir!, "assembly", "overworld_scripts");
      if (!existsSync(scripts)) return;
      const found = readdirSync(scripts)
        .filter((f) => f.endsWith(".s"))
        .map((s) => defaultScriptsJsonStringsPath(`assembly/overworld_scripts/${s}`))
        .filter((p) => existsSync(join(dir!, ...p.split("/"))));
      // ND・Chronos とも 01_moegi.s と strings/overworld_strings_01_moegi.string が対になっている。
      expect(found.length).toBeGreaterThan(0);
    });
  });
}
