import type { ProjectFs } from "../../project/ProjectFs.js";
import { ScriptIndex } from "./ScriptIndex.js";

/** 索引に入れるフォルダ（この下の `.s` をすべて）。 */
export const SCRIPT_INDEX_ASSEMBLY_DIR = "assembly";
/** 索引に入れる、プロジェクトフォルダ直下のファイル。 */
export const SCRIPT_INDEX_ROOT_FILES: readonly string[] = ["xse_commands.s", "xse_defines.s", "asm_defines.s"];

/**
 * 索引に入れるファイルのパス（`assembly/**\/*.s` を名前の順にたどった後、直下の 3 ファイルのうちあるもの）。
 * `.` を含まない名前はフォルダとみなして中を見る（ファイルなら中は空）。`.s` 以外の拡張子は見ない。
 */
export async function listScriptSourcePaths(fs: ProjectFs): Promise<string[]> {
  const out = await listProjectFiles(fs, SCRIPT_INDEX_ASSEMBLY_DIR, /\.s$/i);
  for (const path of SCRIPT_INDEX_ROOT_FILES) if (await fs.exists(path)) out.push(path);
  return out;
}

/** 索引に入れるファイルか（パスはプロジェクトフォルダからの相対、区切りは `/`）。 */
export function isScriptSourcePath(path: string): boolean {
  if (SCRIPT_INDEX_ROOT_FILES.includes(path)) return true;
  return path.startsWith(SCRIPT_INDEX_ASSEMBLY_DIR + "/") && /\.s$/i.test(path);
}

/** プロジェクトの `.s` をすべて読んで索引を作る。 */
export async function buildScriptIndex(fs: ProjectFs): Promise<ScriptIndex> {
  const index = new ScriptIndex();
  for (const path of await listScriptSourcePaths(fs)) index.updateFile(path, await fs.readText(path));
  return index;
}

/**
 * 1 ファイルを読み直す。ファイルが無くなっていれば索引から消す。
 * 返り値は読み直したか（false なら消した）。
 */
export async function reloadScriptIndexFile(index: ScriptIndex, fs: ProjectFs, path: string): Promise<boolean> {
  if (!(await fs.exists(path))) {
    index.removeFile(path);
    return false;
  }
  index.updateFile(path, await fs.readText(path));
  return true;
}

/**
 * `dir` の下の、名前が `pattern` に合うファイル（名前の順にたどる。下のフォルダも）。
 * `.` を含まない名前はフォルダとみなして中を見る（ファイルなら中は空）。
 */
export async function listProjectFiles(fs: ProjectFs, dir: string, pattern: RegExp): Promise<string[]> {
  const out: string[] = [];
  await walk(fs, dir, pattern, out);
  return out;
}

async function walk(fs: ProjectFs, dir: string, pattern: RegExp, out: string[]): Promise<void> {
  const names = [...(await fs.list(dir))].sort();
  for (const name of names) {
    const path = `${dir}/${name}`;
    if (pattern.test(name)) out.push(path);
    else if (!name.includes(".")) await walk(fs, path, pattern, out);
  }
}
