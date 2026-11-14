import type { MapEvents } from "../../event/types.js";
import type { MapId } from "../../map/types.js";
import type { MapScriptEntry } from "../../mapscript/types.js";
import type { ProjectFs } from "../../project/ProjectFs.js";
import type { Rom } from "../../rom/Rom.js";
import { asmEquDefinition, parseAsmLine } from "../asm/AsmLine.js";
import { splitAsmLines } from "../asm/lineEnding.js";
import { evaluateMacroExpression } from "../commands/macroExpression.js";
import type { ScriptCommandTable } from "../commands/ScriptCommandTable.js";
import { DEFAULT_USAGE_CONFIG, type UsageConfig, type UsageKind } from "../config/UsageConfig.js";
import type { DisasmCommandSet } from "../disasm/DisasmCommandSet.js";
import type { ScriptTextCodec } from "../disasm/scriptText.js";
import { listProjectFiles, listScriptSourcePaths } from "../index/buildScriptIndex.js";
import { asmUsage } from "./asmUsage.js";
import { C_SOURCE_DIRS, CSourceScanner } from "./cUsage.js";
import { eventUsage, romScriptEntries } from "./eventUsage.js";
import { romOffsetOf, romScriptUsage } from "./romUsage.js";
import { UsageIndex, type UsageSite } from "./UsageIndex.js";

/** 索引に入れるマップ 1 枚の中身。 */
export interface UsageMapContent {
  readonly events: MapEvents | null;
  readonly mapScripts: readonly MapScriptEntry[] | null;
  /** 落とし物の人の番号（スクリプトは HiddenItem.s。ROM のスクリプトとして読まない）。 */
  readonly itemBallPersons?: ReadonlySet<number>;
}

/** 索引を作る材料。 */
export interface UsageSources {
  readonly rom: Rom;
  readonly commands: DisasmCommandSet;
  readonly text?: ScriptTextCodec;
  /** 全マップの番号。 */
  readonly maps: readonly MapId[];
  /** マップの中身（読めなければ null）。編集中のマップは編集中の中身を返す。 */
  map(id: MapId): Promise<UsageMapContent | null> | UsageMapContent | null;
  /** プロジェクトフォルダ（素の ROM だけなら null）。 */
  readonly fs: ProjectFs | null;
  /** プロジェクトの命令表（`.s` の引数の種類を引く。無ければ `.s` は読まない）。 */
  readonly table: ScriptCommandTable | null;
  /** 待ち時間をはさむ（画面を止めないため。省けばはさまない）。 */
  readonly pause?: () => Promise<void>;
}

/** 作り終えたときの記録。 */
export interface UsageBuildStats {
  readonly ms: number;
  readonly maps: number;
  readonly asmFiles: number;
  readonly cFiles: number;
  readonly sites: number;
}

const ROM_KEY = (id: MapId) => `rom:${id.bank}.${id.map}`;
const EVENT_KEY = (id: MapId) => `event:${id.bank}.${id.map}`;
const ASM_KEY = (path: string) => `asm:${path}`;
const C_KEY = "c";

/**
 * 使われている番号の索引（#227）と、作り方・直し方。
 * - `build` で全部を作る（素の ROM の全マップのスクリプト、全マップのイベント、`.s`、C のソース）。
 * - `updateMap` でマップの分（イベントと、そのマップから入る ROM のスクリプト）を、`updateAsm` で `.s` 1 ファイルの分を差し替える。
 * - `next` で範囲（zigzagumap.json の `usage`）の中の未使用の最小の番号を返す。
 */
export class UsageProject {
  readonly index = new UsageIndex();
  /** `.equ` の値の文字列（ファイルごと。`.s` を読み直したときに入れ替える）。 */
  private readonly equs = new Map<string, Map<string, string>>();
  private stats: UsageBuildStats | null = null;

  constructor(
    public config: UsageConfig = DEFAULT_USAGE_CONFIG,
    private table: ScriptCommandTable | null = null,
    private readonly rom: Rom | null = null,
    private commands: DisasmCommandSet | null = null,
    private text: ScriptTextCodec | undefined = undefined,
  ) {}

  /** 作り終えたか（作っていなければ null）。 */
  get built(): UsageBuildStats | null {
    return this.stats;
  }

  /** 全部を作る。 */
  static async build(sources: UsageSources, config: UsageConfig = DEFAULT_USAGE_CONFIG): Promise<UsageProject> {
    const start = Date.now();
    const project = new UsageProject(config, sources.table, sources.rom, sources.commands, sources.text);
    const pause = sources.pause ?? (async () => {});
    let maps = 0;
    for (const id of sources.maps) {
      const content = await sources.map(id);
      if (content) {
        project.setMap(id, content);
        maps++;
      }
      if (maps % 16 === 0) await pause();
    }
    let asmFiles = 0;
    let cFiles = 0;
    if (sources.fs) {
      // .equ は全ファイルを先に読む（ほかのファイルの名前も引くため）。本文は 2 回目に読み直す（全部を同時に持たない）
      const paths = await listScriptSourcePaths(sources.fs);
      for (const path of paths) project.equs.set(path, equsOf(await sources.fs.readText(path)));
      if (sources.table) {
        const resolve = project.resolver();
        for (const path of paths) {
          if (!path.startsWith("assembly/")) continue;
          project.index.setSource(ASM_KEY(path), asmUsage(path, await sources.fs.readText(path), sources.table, resolve));
          asmFiles++;
          if (asmFiles % 8 === 0) await pause();
        }
      }
      // C のソースは 1 ファイルずつ読んで捨てる（全部の本文を同時に持たない）
      const scan = new CSourceScanner();
      for (const dir of C_SOURCE_DIRS) {
        for (const path of await listProjectFiles(sources.fs, dir, /\.(c|h)$/i)) {
          scan.add(path, await sources.fs.readText(path));
          if (++cFiles % 32 === 0) await pause();
        }
      }
      project.index.setSource(C_KEY, scan.result());
    }
    project.stats = { ms: Date.now() - start, maps, asmFiles, cFiles, sites: project.index.siteCount };
    return project;
  }

  /** マップの分を入れ替える（イベントを編集したとき）。 */
  setMap(id: MapId, content: UsageMapContent): void {
    this.index.setSource(EVENT_KEY(id), eventUsage(id, content.events, content.mapScripts));
    if (!this.rom || !this.commands) return;
    const rom = this.rom;
    const entries = romScriptEntries(content.events, content.mapScripts, (p) => romOffsetOf(rom, p), content.itemBallPersons);
    const where = `マップ ${id.bank}.${id.map}`;
    this.index.setSource(
      ROM_KEY(id),
      romScriptUsage(rom, entries, { commands: this.commands, ...(this.text ? { text: this.text } : {}), where, map: { bank: id.bank, map: id.map } }),
    );
  }

  /** マップを消したとき。 */
  removeMap(id: MapId): void {
    this.index.removeSource(EVENT_KEY(id));
    this.index.removeSource(ROM_KEY(id));
  }

  /** `.s` 1 ファイルを入れ替える（`text` が null なら消えた）。 */
  updateAsm(path: string, text: string | null): void {
    if (text === null) {
      this.equs.delete(path);
      this.index.removeSource(ASM_KEY(path));
      return;
    }
    this.equs.set(path, equsOf(text));
    if (this.table && path.startsWith("assembly/")) this.index.setSource(ASM_KEY(path), asmUsage(path, text, this.table, this.resolver()));
  }

  /** ZigzaguMap が書くトレーナーの表（trainers.json）の分を入れ替える（#245）。 */
  setTrainers(sites: readonly UsageSite[]): void {
    this.index.setSource("trainers", sites);
  }

  /** 範囲の中で使われていない最小の番号。`skip` は同じ操作で先に選んだ番号（2 つ続けて選ぶとき）。 */
  next(kind: UsageKind, skip?: ReadonlySet<number>): number | null {
    return this.index.next(kind, this.config[kind], skip);
  }

  /** 使っている場所。 */
  find(kind: UsageKind, value: number): UsageSite[] {
    return this.index.find(kind, value);
  }

  private resolver(): (name: string) => number | null {
    const cache = new Map<string, number | null>();
    const lookup = (name: string): string | undefined => {
      for (const m of this.equs.values()) {
        const v = m.get(name);
        if (v !== undefined) return v;
      }
      return undefined;
    };
    const resolve = (name: string): number | null => {
      if (cache.has(name)) return cache.get(name)!;
      const text = lookup(name);
      if (text === undefined) return this.table?.resolveConstant(name) ?? null;
      cache.set(name, null);
      const v = evaluateMacroExpression(text, resolve);
      cache.set(name, v);
      return v;
    };
    return resolve;
  }
}

function equsOf(text: string): Map<string, string> {
  const out = new Map<string, string>();
  let inBlock = false;
  for (const raw of splitAsmLines(text)) {
    const line = parseAsmLine(raw, inBlock);
    inBlock = line.endsInBlockComment;
    const equ = asmEquDefinition(line);
    if (equ && !out.has(equ.name)) out.set(equ.name, equ.value);
  }
  return out;
}
