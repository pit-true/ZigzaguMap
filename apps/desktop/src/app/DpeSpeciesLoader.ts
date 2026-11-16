import { DpeSpecies, ScriptConfigJson, loadScriptConfig } from "@zigzagumap/core";
import { ProcessRunner } from "../util/processRunner";
import type { TauriProjectFs } from "./TauriProjectFs";

/** DPE のフォルダ（プロジェクトフォルダからの相対か絶対）。zigzagumap.json の `dpeDirectory`、無ければ ND は隣の NeoDark-DPE-main、ほかは ../dpe。空の指定なら null。 */
export async function dpeDirectoryOf(fs: TauriProjectFs): Promise<string | null> {
  const text = await fs.exists("zigzagumap.json") ? await fs.readText("zigzagumap.json") : null;
  const root = ScriptConfigJson.parse(text).root;
  const custom = root["dpeDirectory"];
  if (custom !== undefined && (typeof custom !== "string" || !custom.trim())) return null;
  const dialect = (await loadScriptConfig(fs)).config.dialect;
  return typeof custom === "string" ? custom : dialect === "nd" ? "../NeoDark-DPE-main" : "../dpe";
}

/** 野生やトレーナーを初めて開いたときだけ、隣の DPE の2ファイルを読む。書き込まない。 */
export async function loadDpeSpecies(fs: TauriProjectFs): Promise<DpeSpecies | null> {
  try {
    const directory = await dpeDirectoryOf(fs);
    if (directory === null) return null;
    const [header, strings] = await Promise.all([
      ProcessRunner.readText("include/species.h", directory),
      ProcessRunner.readText("strings/Pokemon_Name_Table.string", directory),
    ]);
    return DpeSpecies.parse(header, strings);
  } catch {
    return null;
  }
}
