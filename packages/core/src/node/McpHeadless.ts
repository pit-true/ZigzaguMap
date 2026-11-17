import { readdir, readFile, realpath, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { detectGame } from "../game/GameInfo.js";
import { CoreMcpWorkspace } from "../mcp/CoreMcpWorkspace.js";
import type { McpPermissions } from "../mcp/McpToolRunner.js";
import { SpeciesNameTable } from "../name/SpeciesNameTable.js";
import { CfruProject } from "../project/CfruProject.js";
import { Rom } from "../rom/Rom.js";
import { NodeProjectFs } from "./NodeProjectFs.js";

/** ZigzaguMap が置く「使用中」の印のフォルダ（一時フォルダの下。Rust の in_use.rs と同じ）。 */
export function defaultInUseDir(): string {
  return join(tmpdir(), "zigzagumap-in-use");
}

/** 比べるためにパスをそろえる（`\\?\` を外し、区切りと大文字小文字と末尾の区切りをそろえる）。 */
export function normalizeProjectPath(p: string): string {
  return resolve(p.replace(/^\\\\\?\\/, "")).replace(/\//g, "\\").replace(/\\+$/, "").toLowerCase();
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // 権限が無いだけなら、プロセスはある
    return (e as NodeJS.ErrnoException).code === "EPERM";
  }
}

/**
 * 同じプロジェクトフォルダを開いている ZigzaguMap のプロセス ID（無ければ null）。印のプロセスが終わっていれば数えない
 * （落ちたときに残った印は無視する）。
 */
export async function appUsingProject(projectDir: string, inUseDir: string = defaultInUseDir()): Promise<number | null> {
  let names: string[];
  try {
    names = await readdir(inUseDir);
  } catch {
    return null;
  }
  const want = normalizeProjectPath(projectDir);
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      const v = JSON.parse(await readFile(join(inUseDir, name), "utf8")) as { pid?: unknown; project?: unknown };
      if (typeof v.pid !== "number" || typeof v.project !== "string") continue;
      if (v.pid !== process.pid && normalizeProjectPath(v.project) === want && alive(v.pid)) return v.pid;
    } catch {
      // 書きかけ・壊れた印は飛ばす
    }
  }
  return null;
}

/** 画面なしで開くときの指定。 */
export interface HeadlessOptions {
  /** ベース ROM（BPRJ）。読むだけ。 */
  readonly rom: string;
  /** CFRU-JP のプロジェクトフォルダ。出力は maps\ に書く。 */
  readonly project: string;
  readonly permissions: McpPermissions;
  /** 使用中の印のフォルダ（テスト用。省略で一時フォルダの下）。 */
  readonly inUseDir?: string;
}

/** 開いた結果。 */
export interface HeadlessWorkspace {
  readonly workspace: CoreMcpWorkspace;
  /** プロジェクトフォルダの絶対パス。 */
  readonly projectDir: string;
  /** 開くのにかかった時間（ms）。 */
  readonly openMs: number;
}

/**
 * ZigzaguMap を起動せずに、ROM とプロジェクトフォルダを core で開く（Phase7 #522）。読み書きできるのはプロジェクトフォルダの中だけ。
 * ZigzaguMap が同じプロジェクトを開いているあいだ（使用中の印があり、そのプロセスが生きているあいだ）は、書き換えと出力を断る。
 */
export async function openHeadlessWorkspace(options: HeadlessOptions): Promise<HeadlessWorkspace> {
  const started = performance.now();
  const bytes = new Uint8Array(await readFile(options.rom).catch((e: unknown) => {
    throw new Error(`ROM が読めません: ${options.rom}（${(e as Error).message}）`);
  }));
  const rom = new Rom(bytes);
  let supported = false;
  try {
    supported = detectGame(rom).offsets !== null;
  } catch {
    supported = false;
  }
  if (!supported) throw new Error(`ファイアレッド日本語版（BPRJ）の ROM ではありません: ${options.rom}`);
  const projectDir = await realpath(options.project).catch(() => {
    throw new Error(`プロジェクトフォルダがありません: ${options.project}`);
  });
  if (!(await stat(projectDir)).isDirectory()) throw new Error(`フォルダではありません: ${options.project}`);
  const project = await CfruProject.open(bytes, new NodeProjectFs(projectDir));
  const inUseDir = options.inUseDir ?? defaultInUseDir();
  let blocked: string | null = null;
  // 書き換えの道具を呼ぶたびに確かめる（ZigzaguMap をあとから開いても気づく）。印を読むのは非同期なので、直前の結果を使う
  const refresh = async (): Promise<void> => {
    const pid = await appUsingProject(projectDir, inUseDir);
    blocked =
      pid === null
        ? null
        : `ZigzaguMap（プロセス ${pid}）が同じプロジェクトを開いているので、画面なしの形では書き換えと出力をしません（食い違わないように）。開いている ZigzaguMap につなぐ形（--rom・--project を付けずに起動）を使ってください。読むだけの道具は使えます。`;
  };
  await refresh();
  let species: (string | null)[] | null = null;
  const workspace = await CoreMcpWorkspace.create(project, {
    permissions: options.permissions,
    writeBlocked: () => blocked,
    beforeCall: refresh,
    speciesNames: async () => {
      if (!species) {
        try {
          const table = SpeciesNameTable.read(project.rom, project.game.offsets.speciesNameTablePointer);
          species = Array.from({ length: 412 }, (_, i) => table.name(i, project.textCodec));
        } catch {
          species = [];
        }
      }
      return species;
    },
  });
  return { workspace, projectDir, openMs: Math.round(performance.now() - started) };
}
