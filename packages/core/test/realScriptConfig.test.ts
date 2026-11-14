import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NodeProjectFs } from "../src/node/index.js";
import { defaultScriptConfig, loadScriptConfig } from "../src/index.js";

/**
 * 実フォルダ（読むだけ）。ZIGZAGU_ND_DIR は ND の CFRU フォルダ、ZIGZAGU_CHRONOS_DIR は Chronos のフォルダ
 * （CFRU 部分の `cfru` か、その 1 つ上）。設定されていなければ飛ばす。
 */
const ndDir = process.env.ZIGZAGU_ND_DIR;
const chronosDir = process.env.ZIGZAGU_CHRONOS_DIR;

/** xse_commands.s のあるフォルダ（Chronos はルートを渡されたら cfru を見る）。 */
function projectDir(dir: string): string {
  return existsSync(join(dir, "xse_commands.s")) ? dir : join(dir, "cfru");
}

describe.skipIf(!ndDir)("実フォルダ ND（ZIGZAGU_ND_DIR）", () => {
  it("方言を nd と判定し、ND の既定値を入れる", async () => {
    const dir = projectDir(ndDir!);
    const loaded = await loadScriptConfig(new NodeProjectFs(dir));
    expect(loaded.config.dialect).toBe("nd");
    if (!existsSync(join(dir, "zigzagumap.json"))) expect(loaded.config).toEqual(defaultScriptConfig("nd"));
    expect(existsSync(join(dir, "scripts/make.py"))).toBe(true);
  });
});

describe.skipIf(!chronosDir)("実フォルダ Chronos（ZIGZAGU_CHRONOS_DIR）", () => {
  it("方言を chronos と判定し、既定のビルドと幅検査のファイルがある", async () => {
    const dir = projectDir(chronosDir!);
    const loaded = await loadScriptConfig(new NodeProjectFs(dir));
    expect(loaded.config.dialect).toBe("chronos");
    if (!existsSync(join(dir, "zigzagumap.json"))) expect(loaded.config).toEqual(defaultScriptConfig("chronos"));
    const d = defaultScriptConfig("chronos");
    expect(existsSync(join(dir, d.build[0]!.cwd, d.build[0]!.args[0]!))).toBe(true);
    expect(existsSync(join(dir, d.widthCheck!.cwd, d.widthCheck!.args[0]!))).toBe(true);
  });
});
