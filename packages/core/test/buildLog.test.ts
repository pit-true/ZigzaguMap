import { describe, expect, it } from "vitest";
import { parseBuildLog, projectPath } from "../src/index.js";

describe("ビルドのログ", () => {
  const nd = { cwd: ".", projectName: "NeoDark-CFRU-main" };
  const chronos = { cwd: "..", projectName: "cfru" };

  it("GNU as のエラー行を拾い、パスをプロジェクトフォルダからにする", () => {
    const lines = [
      "Assembling assembly/overworld_scripts/01_moegi.s",
      "assembly/overworld_scripts/01_moegi.s:12: Error: bad instruction `lok'",
      "assembly/overworld_scripts/01_moegi.s:20: Warning: something",
    ];
    const p = parseBuildLog(lines, nd);
    expect(p).toEqual([
      { kind: "asm", severity: "error", message: lines[1], path: "assembly/overworld_scripts/01_moegi.s", line: 12, logLine: 1 },
      { kind: "asm", severity: "warning", message: lines[2], path: "assembly/overworld_scripts/01_moegi.s", line: 20, logLine: 2 },
    ]);
  });

  it(".string・Symbol missing・幅検査・Traceback", () => {
    const lines = [
      "Building strings/overworld_strings_01_moegi.string",
      'Error parsing string on line 7 at character "Ж".',
      "Symbol missing: Moegi_Npc9",
      "TEXT WIDTH ERROR: cfru/strings/debug_famicom.string:21 gText_X (configured) page 1 line 2: 212 px > 208 px",
      "Traceback (most recent call last):",
    ];
    const nd2 = parseBuildLog(lines.slice(0, 3), nd);
    expect(nd2[0]).toMatchObject({ kind: "string", path: "strings/overworld_strings_01_moegi.string", line: 7 });
    expect(nd2[1]).toMatchObject({ kind: "symbol", symbol: "Moegi_Npc9", path: null });
    const c = parseBuildLog(lines.slice(3), chronos);
    expect(c[0]).toMatchObject({ kind: "width", path: "strings/debug_famicom.string", line: 21 });
    expect(c[1]).toMatchObject({ kind: "python" });
  });

  it("gcc のエラーは拾い、警告は拾わない", () => {
    const p = parseBuildLog(["./src\Pokedex_Data_Table.c:11425:9: warning: initialized field overwritten", "src/a.c:3:1: error: expected ';'"], nd);
    expect(p).toEqual([{ kind: "asm", severity: "error", message: "src/a.c:3:1: error: expected ';'", path: "src/a.c", line: 3, logLine: 1 }]);
  });

  it("作業フォルダと絶対パス", () => {
    expect(projectPath("cfru/assembly/overworld_scripts/a.s", chronos)).toBe("assembly/overworld_scripts/a.s");
    expect(projectPath("strings/a.string", { cwd: "../NeoDark-DPE-main", projectName: "NeoDark-CFRU-main" })).toBe("../NeoDark-DPE-main/strings/a.string");
    expect(projectPath("D:\\x\\NeoDark-CFRU-main\\assembly\\a.s", nd)).toBe("assembly/a.s");
  });
});
