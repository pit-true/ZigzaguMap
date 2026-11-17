// CFRU-JP のフォルダの場所を決める部品（#540・#543）。ND・Chronos の実際の形を写した、メモリ上のフォルダで確かめる。
import { describe, expect, it } from "vitest";
import { MemoryProjectFs, locateCfruFolder, locateCfruSource, subProjectFs, type FolderEntry, type FolderReader } from "../src/index.js";

/** パスの一覧（`\` 区切りの絶対パス。末尾が `\` ならフォルダ）から、FolderReader を作る。 */
function tree(paths: readonly string[]): FolderReader & { calls: string[] } {
  const dirs = new Map<string, FolderEntry[]>();
  const add = (parent: string, entry: FolderEntry): void => {
    const key = parent.toLowerCase();
    const list = dirs.get(key) ?? [];
    if (!list.some((e) => e.name === entry.name)) list.push(entry);
    dirs.set(key, list);
  };
  for (const raw of paths) {
    const isDir = raw.endsWith("\\");
    const parts = raw.replace(/\\$/, "").split("\\");
    for (let i = 1; i < parts.length; i++) add(parts.slice(0, i).join("\\"), { name: parts[i]!, dir: i < parts.length - 1 || isDir });
  }
  const calls: string[] = [];
  return { calls, list: async (path) => { calls.push(path); return dirs.get(path.replace(/\//g, "\\").toLowerCase()) ?? null; } };
}

const ND = [
  "C:\\p\\NeoDark-CFRU-main\\src\\config.h",
  "C:\\p\\NeoDark-CFRU-main\\include\\new\\dns_data.h",
  "C:\\p\\NeoDark-CFRU-main\\maps\\03\\00.json",
  "C:\\p\\NeoDark-CFRU-main\\BPRJ0.gba",
  "C:\\p\\NeoDark-CFRU-main\\test.gba",
  "C:\\p\\NeoDark-CFRU-main\\build\\x.o",
];
const CHRONOS = [
  "C:\\p\\Chronos\\cfru\\src\\config.h",
  "C:\\p\\Chronos\\cfru\\src\\chronos_time.c",
  "C:\\p\\Chronos\\base\\BPRJ0.gba",
  "C:\\p\\Chronos\\base\\base_info.json",
  "C:\\p\\Chronos\\build\\Chronos.gba",
  "C:\\p\\Chronos\\dpe\\include\\species.h",
];

describe("locateCfruFolder", () => {
  it("ND: 直下の src と BPRJ0.gba（test.gba は選ばない）", async () => {
    const r = await locateCfruFolder("C:\\p\\NeoDark-CFRU-main", tree(ND));
    expect(r.projectDir).toBe("C:\\p\\NeoDark-CFRU-main");
    expect(r.cfru).toBe(true);
    expect(r.rom).toEqual({ kind: "found", path: "C:\\p\\NeoDark-CFRU-main\\BPRJ0.gba" });
  });

  it("末尾の区切りがあっても同じ", async () => {
    const r = await locateCfruFolder("C:\\p\\NeoDark-CFRU-main\\", tree(ND));
    expect(r.projectDir).toBe("C:\\p\\NeoDark-CFRU-main");
  });

  it("Chronos のルート: プロジェクトは cfru、ROM は base の BPRJ0.gba（build の Chronos.gba は選ばない）", async () => {
    const r = await locateCfruFolder("C:\\p\\Chronos", tree(CHRONOS));
    expect(r.projectDir).toBe("C:\\p\\Chronos\\cfru");
    expect(r.cfru).toBe(true);
    expect(r.rom).toEqual({ kind: "found", path: "C:\\p\\Chronos\\base\\BPRJ0.gba" });
  });

  it("Chronos の cfru を選んでも、親の base の ROM を見つける", async () => {
    const r = await locateCfruFolder("C:\\p\\Chronos\\cfru", tree(CHRONOS));
    expect(r.projectDir).toBe("C:\\p\\Chronos\\cfru");
    expect(r.rom).toEqual({ kind: "found", path: "C:\\p\\Chronos\\base\\BPRJ0.gba" });
  });

  it("素の CFRU-JP: BPRJ0.gba の名前でなくても、.gba が 1 つなら選ぶ", async () => {
    const r = await locateCfruFolder("D:/w/CFRU-JP", tree(["D:\\w\\CFRU-JP\\src\\config.h", "D:\\w\\CFRU-JP\\Pocket Monsters - FireRed (Japan).gba"]));
    // `/` 区切りで選んだら、見つけたパスも `/` でつなぐ
    expect(r.projectDir).toBe("D:/w/CFRU-JP");
    expect(r.rom).toEqual({ kind: "found", path: "D:/w/CFRU-JP/Pocket Monsters - FireRed (Japan).gba" });
  });

  it("候補が複数で BPRJ0.gba が無いときは、一覧から選ばせる", async () => {
    const r = await locateCfruFolder("C:\\p\\ND", tree([
      "C:\\p\\ND\\ND_v0.3.0.gba",
      "C:\\p\\ND\\org_Pocket Monsters - FireRed (Japan).gba",
      "C:\\p\\ND\\NeoDark-CFRU-map-sources\\src\\config.h",
      "C:\\p\\ND\\tools\\",
    ]));
    // CFRU のソースを持つ子が 1 つだけなので、それをプロジェクトにする
    expect(r.projectDir).toBe("C:\\p\\ND\\NeoDark-CFRU-map-sources");
    expect(r.rom).toEqual({ kind: "choose", candidates: ["C:\\p\\ND\\ND_v0.3.0.gba", "C:\\p\\ND\\org_Pocket Monsters - FireRed (Japan).gba"] });
  });

  it(".gba が 1 つも無いときは、探したフォルダを返す", async () => {
    const r = await locateCfruFolder("C:\\p\\Empty", tree(["C:\\p\\Empty\\src\\config.h", "C:\\p\\Empty\\build\\test.gba"]));
    expect(r.rom).toEqual({ kind: "none", searched: ["C:\\p\\Empty"] });
  });

  it("CFRU のソースが無いフォルダは、選んだフォルダをそのままプロジェクトにする", async () => {
    const r = await locateCfruFolder("C:\\p\\maps-only", tree(["C:\\p\\maps-only\\maps\\03\\00.json", "C:\\p\\maps-only\\BPRJ.gba"]));
    expect(r).toEqual({ projectDir: "C:\\p\\maps-only", cfru: false, rom: { kind: "found", path: "C:\\p\\maps-only\\BPRJ.gba" } });
  });

  it("CFRU のソースを持つ子が複数あれば、どれも選ばない", async () => {
    const r = await locateCfruFolder("C:\\p", tree(ND.concat(["C:\\p\\Other\\src\\config.h"])));
    expect(r.cfru).toBe(false);
    expect(r.projectDir).toBe("C:\\p");
  });

  it("大文字・小文字の違いは問わない", async () => {
    const r = await locateCfruFolder("C:\\p\\X", tree(["C:\\p\\X\\Cfru\\SRC\\Config.H", "C:\\p\\X\\Base\\bprj0.GBA", "C:\\p\\X\\Base\\other.gba"]));
    expect(r.projectDir).toBe("C:\\p\\X\\Cfru");
    expect(r.rom).toEqual({ kind: "found", path: "C:\\p\\X\\Base\\bprj0.GBA" });
  });
});

describe("locateCfruSource", () => {
  it("ND の形: 直下", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText("src/config.h", "#define TIME_ENABLED");
    expect(await locateCfruSource(fs)).toEqual({ prefix: "", searched: ["src/config.h"] });
  });

  it("Chronos のルートを開いた形: cfru/ の下", async () => {
    const fs = new MemoryProjectFs();
    await fs.writeText("cfru/src/config.h", "x");
    const r = await locateCfruSource(fs);
    expect(r).toEqual({ prefix: "cfru/", searched: ["src/config.h", "cfru/src/config.h"] });
    expect(await subProjectFs(fs, r.prefix!).readText("src/config.h")).toBe("x");
  });

  it("どこにも無ければ null と探した場所", async () => {
    expect(await locateCfruSource(new MemoryProjectFs())).toEqual({ prefix: null, searched: ["src/config.h", "cfru/src/config.h"] });
  });

  it("subProjectFs は書き込み・一覧も下のフォルダへ向ける", async () => {
    const fs = new MemoryProjectFs();
    const sub = subProjectFs(fs, "cfru/");
    await sub.writeText("a/b.txt", "1");
    expect(fs.files.has("cfru/a/b.txt")).toBe(true);
    expect(subProjectFs(fs, "")).toBe(fs);
  });
});
