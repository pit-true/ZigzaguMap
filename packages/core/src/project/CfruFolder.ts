import type { ProjectFs } from "./ProjectFs.js";

/**
 * CFRU-JP のフォルダの場所を決める部品（#540・#543）。
 * - `locateCfruFolder`: ファイル > CFRU-JP のフォルダを開く で選んだフォルダから、プロジェクトのフォルダとベース ROM を見つける。
 * - `locateCfruSource`: 開いているプロジェクトのフォルダの中で、CFRU のソース（`src/config.h` など）の場所を見つける。
 * どちらも「`src/config.h` があるフォルダが CFRU のソース」という同じ目印で、直下と `cfru\`（Chronos）を探す。
 *
 * 実際の置き場所（2026-11-18 に確かめた）:
 * - ND: `NeoDark-CFRU-main\src\config.h`、ベース ROM は直下の `BPRJ0.gba`（ビルドの出力 `test.gba` も直下にある）。
 * - Chronos: `Chronos\cfru\src\config.h`、ベース ROM は `Chronos\base\BPRJ0.gba`（ビルドの出力は `Chronos\build\Chronos.gba`）。
 */

/** CFRU のソースの目印（プロジェクトのフォルダからの相対）。 */
export const CFRU_MARKER = "src/config.h";
/** CFRU のソースを探すフォルダ（プロジェクトのフォルダの直下と、Chronos の形の `cfru`）。 */
export const CFRU_SOURCE_DIRS: readonly string[] = ["", "cfru"];
/** ベース ROM を置くフォルダの名前（Chronos の形）。 */
export const BASE_ROM_DIR = "base";
/** ベース ROM の決まりの名前（CFRU-JP の README のとおり）。 */
export const BASE_ROM_NAME = "BPRJ0.gba";
/** ビルドの出力なので、ベース ROM に選ばない名前。 */
const BUILD_OUTPUT_NAMES: ReadonlySet<string> = new Set(["test.gba"]);

/** 開いているプロジェクトのフォルダの中の、CFRU のソースの場所。 */
export interface CfruSourceLocation {
  /** ソースのフォルダ（プロジェクトのフォルダからの相対。直下なら ""、Chronos なら "cfru/"。見つからなければ null）。 */
  readonly prefix: string | null;
  /** 探した目印のパス（プロジェクトのフォルダからの相対。見つからなかったときの文に使う）。 */
  readonly searched: readonly string[];
}

/** プロジェクトのフォルダの中で、CFRU のソースを探す（直下、`cfru/` の順）。 */
export async function locateCfruSource(fs: ProjectFs): Promise<CfruSourceLocation> {
  const searched: string[] = [];
  for (const dir of CFRU_SOURCE_DIRS) {
    const prefix = dir ? `${dir}/` : "";
    const marker = prefix + CFRU_MARKER;
    searched.push(marker);
    try {
      if (await fs.exists(marker)) return { prefix, searched };
    } catch {
      // 読めない場所は無いものとして次を探す
    }
  }
  return { prefix: null, searched };
}

/** `prefix`（"cfru/" など）の下を根にした ProjectFs（"" ならそのまま返す）。 */
export function subProjectFs(fs: ProjectFs, prefix: string): ProjectFs {
  if (!prefix) return fs;
  const p = (path: string): string => prefix + path;
  const sub: ProjectFs = {
    readText: (path) => fs.readText(p(path)),
    writeText: (path, text) => fs.writeText(p(path), text),
    readBytes: (path) => fs.readBytes(p(path)),
    exists: (path) => fs.exists(p(path)),
    remove: (path) => fs.remove(p(path)),
    list: (path) => fs.list(p(path)),
    ...(fs.writeBytes ? { writeBytes: (path: string, bytes: Uint8Array) => fs.writeBytes!(p(path), bytes) } : {}),
    ...(fs.inflate ? { inflate: fs.inflate } : {}),
  };
  return sub;
}

/** フォルダの中の 1 つ。 */
export interface FolderEntry {
  readonly name: string;
  readonly dir: boolean;
}

/** 絶対パスのフォルダの中身を読む口（無いフォルダなら null）。 */
export interface FolderReader {
  list(path: string): Promise<readonly FolderEntry[] | null>;
}

/** ベース ROM の決まり方。 */
export type BaseRomChoice =
  /** 1 つに決まった。 */
  | { readonly kind: "found"; readonly path: string }
  /** 決まりで 1 つに決められない（候補の一覧から選ばせる）。 */
  | { readonly kind: "choose"; readonly candidates: readonly string[] }
  /** 1 つも無い（探したフォルダ）。 */
  | { readonly kind: "none"; readonly searched: readonly string[] };

/** 選んだフォルダから決めた、プロジェクトのフォルダとベース ROM。 */
export interface CfruFolderLocation {
  /** プロジェクトのフォルダ（CFRU のソースがある所。見つからなければ選んだフォルダ）。 */
  readonly projectDir: string;
  /** プロジェクトのフォルダに CFRU のソース（`src/config.h`）があるか。 */
  readonly cfru: boolean;
  readonly rom: BaseRomChoice;
}

/**
 * 選んだフォルダ（絶対パス）から、プロジェクトのフォルダとベース ROM を見つける。
 * プロジェクトのフォルダは、選んだフォルダ → その `cfru` → ほかの子のフォルダ（CFRU のソースが 1 つだけのとき）の順。
 * ベース ROM は、プロジェクトのフォルダ・選んだフォルダ・（プロジェクトが `cfru` なら）その親と、それぞれの `base` の中の .gba から、
 * `BPRJ0.gba` を優先して決める。ビルドの出力（`test.gba`、`build` の中）は選ばない。
 */
export async function locateCfruFolder(selected: string, reader: FolderReader): Promise<CfruFolderLocation> {
  const root = trimSeparators(selected);
  const sep = root.includes("\\") ? "\\" : "/";
  const join = (dir: string, name: string): string => (/[\\/]$/.test(dir) ? `${dir}${name}` : `${dir}${sep}${name}`);
  const cache = new Map<string, Promise<readonly FolderEntry[] | null>>();
  const list = (dir: string): Promise<readonly FolderEntry[] | null> => {
    const key = dir.toLowerCase();
    let v = cache.get(key);
    if (!v) { v = reader.list(dir).catch(() => null); cache.set(key, v); }
    return v;
  };
  const child = async (dir: string, name: string, wantDir: boolean): Promise<string | null> => {
    const entry = (await list(dir))?.find((e) => e.dir === wantDir && e.name.toLowerCase() === name.toLowerCase());
    return entry ? join(dir, entry.name) : null;
  };
  const isCfru = async (dir: string): Promise<boolean> => {
    const [srcDir, file] = CFRU_MARKER.split("/") as [string, string];
    const src = await child(dir, srcDir, true);
    return src !== null && (await child(src, file, false)) !== null;
  };

  // プロジェクトのフォルダ
  let projectDir: string | null = null;
  for (const dir of CFRU_SOURCE_DIRS) {
    const candidate = dir ? await child(root, dir, true) : root;
    if (candidate && (await isCfru(candidate))) { projectDir = candidate; break; }
  }
  if (projectDir === null) {
    const others: string[] = [];
    for (const e of (await list(root)) ?? []) if (e.dir && (await isCfru(join(root, e.name)))) others.push(join(root, e.name));
    if (others.length === 1) projectDir = others[0]!;
  }
  const cfru = projectDir !== null;
  projectDir ??= root;

  // ベース ROM を探すフォルダ
  const dirs: string[] = [projectDir, root];
  if (lastName(projectDir).toLowerCase() === "cfru") dirs.push(parentOf(projectDir));
  const searched: string[] = [];
  const seen = new Set<string>();
  const roms: string[] = [];
  for (const dir of dirs) {
    for (const d of [dir, await child(dir, BASE_ROM_DIR, true)]) {
      if (d === null || seen.has(d.toLowerCase())) continue;
      seen.add(d.toLowerCase());
      searched.push(d);
      for (const e of (await list(d)) ?? []) {
        const lower = e.name.toLowerCase();
        if (!e.dir && lower.endsWith(".gba") && !BUILD_OUTPUT_NAMES.has(lower)) roms.push(join(d, e.name));
      }
    }
  }
  const named = roms.find((p) => lastName(p).toLowerCase() === BASE_ROM_NAME.toLowerCase());
  const rom: BaseRomChoice =
    named !== undefined ? { kind: "found", path: named }
    : roms.length === 1 ? { kind: "found", path: roms[0]! }
    : roms.length > 1 ? { kind: "choose", candidates: roms }
    : { kind: "none", searched };
  return { projectDir, cfru, rom };
}

function trimSeparators(path: string): string {
  const t = path.replace(/[\\/]+$/, "");
  return /^[A-Za-z]:$/.test(t) ? `${t}\\` : t || path;
}

function lastName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? "";
}

function parentOf(path: string): string {
  const i = Math.max(path.lastIndexOf("\\"), path.lastIndexOf("/"));
  return i > 0 ? path.slice(0, i) : path;
}
