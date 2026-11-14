import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkStringFileWidth, checkTextWidth, parseStringFile, replaceStringBody, stringifyStringFile } from "../src/index.js";

/** 実フォルダ（CFRU のフォルダ）。設定されていなければ、そのフォルダのテストは飛ばす。読むだけで書かない。 */
const folders: [string, string | undefined][] = [
  ["ND（ZIGZAGU_ND_DIR）", process.env.ZIGZAGU_ND_DIR],
  ["Chronos（ZIGZAGU_CHRONOS_DIR）", process.env.ZIGZAGU_CHRONOS_DIR],
];
/** Chronos のルート（docs/TEXT_WIDTH.md のあるフォルダ）。 */
const chronosRoot = process.env.ZIGZAGU_CHRONOS_ROOT;

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

function stringFiles(folder: string): { name: string; bytes: Uint8Array }[] {
  const dir = join(folder, "strings");
  return readdirSync(dir)
    .filter((n) => n.endsWith(".string"))
    .sort()
    .map((name) => ({ name, bytes: new Uint8Array(readFileSync(join(dir, name))) }));
}

for (const [title, folder] of folders) {
  describe.skipIf(!folder)(`実ファイルの .string: ${title}`, () => {
    it("全ファイルを読んで書くと 1 バイトも変わらない", () => {
      const files = stringFiles(folder!);
      expect(files.length).toBeGreaterThan(20);
      let entries = 0;
      for (const { name, bytes } of files) {
        const file = parseStringFile(utf8.decode(bytes));
        const back = new TextEncoder().encode(stringifyStringFile(file));
        expect(Buffer.from(back).equals(Buffer.from(bytes)), name).toBe(true);
        entries += file.entries.length;
      }
      expect(entries).toBeGreaterThan(1000);
      console.info(`${title}: ${files.length} ファイル、#org ${entries} 個が往復で一致`);
    });

    it("本文を 1 つ差し替えると、そのラベルの行だけが変わる", () => {
      let checked = 0;
      for (const { name, bytes } of stringFiles(folder!)) {
        const source = utf8.decode(bytes);
        const file = parseStringFile(source);
        const withBody = file.entries.filter((e) => e.bodyLines.length > 0);
        // 大きいファイルは間を空けて 20 個まで
        const step = Math.max(1, Math.floor(withBody.length / 20));
        for (let i = 0; i < withBody.length; i += step) {
          const entry = withBody[i]!;
          const out = parseStringFile(stringifyStringFile(replaceStringBody(file, entry.label, "かえた\\nほんぶん")));
          expect(out.lines.length, name).toBe(file.lines.length);
          for (const [k, line] of out.lines.entries()) {
            const before = file.lines[k]!;
            if (k === entry.bodyLines[0]) {
              expect(line.text).toBe("かえた\\nほんぶん");
              expect(line.eol).toBe(before.eol);
            } else {
              expect(line.text === before.text && line.eol === before.eol, `${name}:${k + 1}`).toBe(true);
            }
          }
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(100);
    });

    it("全ファイルの幅検査が例外なく終わる", () => {
      let issues = 0;
      for (const { bytes } of stringFiles(folder!)) {
        issues += checkStringFileWidth(parseStringFile(utf8.decode(bytes))).length;
      }
      console.info(`${title}: 既定の上限（18 字・2 行）を超えたところ ${issues} 個`);
    });
  });
}

describe.skipIf(!chronosRoot)("Chronos の docs/TEXT_WIDTH.md の例（ZIGZAGU_CHRONOS_ROOT）", () => {
  const doc = () => readFileSync(join(chronosRoot!, "docs", "TEXT_WIDTH.md"), "utf8");

  it("全角だけの 1 行は 18 字まで、19 字は超える", () => {
    const text = doc();
    expect(text).toContain("1 行 18 字");
    expect(text).toContain("19 字は 214 px");
    expect(checkTextWidth("あ".repeat(18)).issues).toEqual([]);
    expect(checkTextWidth("あ".repeat(19)).issues[0]).toMatchObject({ kind: "columns", columns: 19, limit: 18 });
  });

  it("NoRoom の 2 行目を 19 字にした例を、簡易検査でも超えると出す", () => {
    // 文書には「NoRoom の 2 行目を 19 字（「…あきが ないよ」）」とあり、行の後ろの部分だけが書かれている
    const m = /NoRoom` の 2 行目を (\d+) 字（「…([^」]+)」）/.exec(doc());
    expect(m).not.toBeNull();
    const count = Number(m![1]);
    const tail = m![2]!;
    expect(count).toBe(19);
    const line2 = "あ".repeat(count - [...tail].length) + tail;
    const issues = checkTextWidth(`てもちも　パソコンも　いっぱいで\\n${line2}`).issues;
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "columns", page: 0, line: 1, columns: 19 });
    // 18 字に縮めれば出ない
    expect(checkTextWidth(`てもちも\\n${line2.slice(1)}`).issues).toEqual([]);
  });
});
