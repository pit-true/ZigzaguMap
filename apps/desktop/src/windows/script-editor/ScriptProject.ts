import { invoke } from "@tauri-apps/api/core";
import {
  DisasmCommandSet,
  ScriptAssist,
  ScriptCommandTable,
  buildScriptIndex,
  isScriptSourcePath,
  listScriptSourcePaths,
  loadScriptConfig,
  type ScriptConfig,
} from "@zigzagumap/core";
import { TauriProjectFs } from "../../app/TauriProjectFs";
import { scheduleIdleGc } from "../../util/idleGc";
import type { FileStat } from "./EditorTab";

/** 文字列のファイルを探すフォルダ。 */
const STRINGS_DIR = "strings";
/** リンカのスクリプト（`gStringVar4 = 0x…;` などの名前）。 */
const LINKER_SCRIPT = "BPRJ.ld";
/** 編集中の本文を索引に入れるまでの待ち（ms）。 */
const BUFFER_DELAY_MS = 300;

/**
 * エディタのウィンドウが持つ、プロジェクトの知識（命令表・ラベルと `.equ` の索引・文字列の索引・設定）。
 * ウィンドウを開いたときに裏で読み、読み終えるまで補助の機能は空のまま動く（読み終えたら `onChange` で知らせる）。
 *
 * - 索引は、開いているタブの編集中の本文で置き換える（保存前のラベルも補完・定義へ移動で使える）。
 *   タブを保存せずに閉じたら、ディスクの内容に戻す。
 * - ウィンドウが前面に戻ったとき（外で書き換えたかもしれない）に、更新日時の変わったファイルだけを読み直す。
 * - メインウィンドウのメモリは使わない（読むのはエディタのウィンドウだけ）。
 */
export class ScriptProject {
  readonly assist = new ScriptAssist();
  readonly fs = new TauriProjectFs();
  /** 読んだ設定（読めなければ null）。 */
  config: ScriptConfig | null = null;
  /** 読み込みの誤り（設定が不正など）。 */
  readonly problems: string[] = [];
  /** 読み終えた。 */
  loaded = false;
  private loading: Promise<void> | null = null;
  private readonly listeners = new Set<() => void>();
  private readonly stats = new Map<string, FileStat | null>();
  /** 索引に入れる前の、編集中の本文（文字列にするのは入れるときだけ。打鍵のたびに大きな文字列を作らない）。 */
  private readonly buffers = new Map<string, { toString(): string }>();
  private bufferTimer: ReturnType<typeof setTimeout> | null = null;
  private refreshing = false;
  /** 読み込みにかかった時間（ms）。 */
  loadMs = 0;

  /** 変わったときに呼ぶ関数を足す。 */
  onChange(fn: () => void): void {
    this.listeners.add(fn);
  }

  /** 読み込む（2 回目からは同じ約束を返す）。 */
  load(): Promise<void> {
    return (this.loading ??= this.loadAll());
  }

  private async loadAll(): Promise<void> {
    const t0 = performance.now();
    const fs = this.fs;
    try {
      this.config = (await loadScriptConfig(fs)).config;
    } catch (e) {
      this.problems.push(String(e instanceof Error ? e.message : e));
    }
    const read = async (path: string): Promise<string | null> => {
      try {
        return (await fs.exists(path)) ? await fs.readText(path) : null;
      } catch {
        return null;
      }
    };
    const xse = await read("xse_commands.s");
    if (xse !== null) {
      const defines = (await Promise.all(["xse_defines.s", "asm_defines.s"].map(read))).filter((t): t is string => t !== null);
      const csv = this.config?.commandsCsv ? await read(this.config.commandsCsv) : null;
      this.assist.setCommands(ScriptCommandTable.build({ xseCommands: xse, csv, defines }));
    } else {
      // プロジェクトの無い素の ROM（か xse_commands.s の無いフォルダ）: 逆アセンブルと同じ同梱の表で色付けとホバーをする
      this.assist.setCommands(ScriptCommandTable.build({ xseCommands: DisasmCommandSet.bundled().toMacroText(), defines: [] }));
    }
    const linker = await read(LINKER_SCRIPT);
    if (linker !== null) this.assist.setLinkerSymbols(linker);
    try {
      const index = await buildScriptIndex(fs);
      for (const path of index.paths()) this.assist.index.setFile(index.file(path)!);
      this.assist.changed();
    } catch (e) {
      this.problems.push(String(e instanceof Error ? e.message : e));
    }
    for (const path of await listStringFiles(fs, STRINGS_DIR)) {
      const text = await read(path);
      if (text !== null) this.assist.updateString(path, normalize(text));
    }
    for (const path of [...this.assist.index.paths(), ...this.assist.strings.paths()]) this.stats.set(path, await stat(path));
    // 読んでいる間に編集した本文を入れ直す
    for (const [path, text] of this.buffers) this.apply(path, text.toString());
    this.buffers.clear();
    this.loaded = true;
    this.loadMs = Math.round(performance.now() - t0);
    this.emit();
    // 読み込みの一時的なもの（ファイルの本文・行の解析・IPC の受け取り）を片付ける
    scheduleIdleGc(true);
  }

  /** 索引に入れるファイルか（`.s` は assembly と直下の 3 ファイル、`.string` は strings）。 */
  static isIndexed(path: string): boolean {
    return isScriptSourcePath(path) || (path.startsWith(`${STRINGS_DIR}/`) && /\.string$/i.test(path));
  }

  /** タブの本文が変わった（少し待ってから索引に入れる）。`text` は文字列か CodeMirror の Text。 */
  updateBuffer(path: string, text: { toString(): string }): void {
    if (!ScriptProject.isIndexed(path)) return;
    this.buffers.set(path, text);
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = setTimeout(() => this.flushBuffers(), BUFFER_DELAY_MS);
  }

  /** 待っている本文をすぐに索引に入れる（波線を出す前など）。 */
  flushBuffers(): void {
    if (this.bufferTimer) clearTimeout(this.bufferTimer);
    this.bufferTimer = null;
    if (!this.loaded || this.buffers.size === 0) return;
    for (const [path, text] of this.buffers) this.apply(path, text.toString());
    this.buffers.clear();
    this.emit();
  }

  /** ファイルをディスクから読み直す（保存した・タブを保存せずに閉じた・外で変わった）。 */
  async reloadFile(path: string): Promise<void> {
    if (!ScriptProject.isIndexed(path)) return;
    this.buffers.delete(path);
    const st = await stat(path);
    this.stats.set(path, st);
    if (!st) this.assist.remove(path);
    else this.apply(path, normalize(await this.fs.readText(path)));
    this.emit();
  }

  /** 更新日時の変わったファイルと、増えた・消えたファイルを読み直す（前面に戻ったとき）。`open` は開いているタブのパス（読み直さない）。 */
  async refresh(open: ReadonlySet<string>): Promise<void> {
    if (!this.loaded || this.refreshing) return;
    this.refreshing = true;
    try {
      const paths = new Set([...(await listScriptSourcePaths(this.fs)), ...(await listStringFiles(this.fs, STRINGS_DIR))]);
      for (const p of this.stats.keys()) paths.add(p);
      let changed = false;
      for (const path of paths) {
        if (open.has(path)) continue;
        const st = await stat(path);
        const old = this.stats.get(path);
        if (old !== undefined && sameStat(old, st)) continue;
        this.stats.set(path, st);
        if (!st) this.assist.remove(path);
        else this.apply(path, normalize(await this.fs.readText(path)));
        changed = true;
      }
      if (changed) this.emit();
    } finally {
      this.refreshing = false;
    }
  }

  private apply(path: string, text: string): void {
    if (/\.string$/i.test(path)) this.assist.updateString(path, text);
    else this.assist.updateAsm(path, text);
  }

  private emit(): void {
    for (const fn of this.listeners) fn();
  }
}

function normalize(text: string): string {
  return (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).replace(/\r\n?/g, "\n");
}

function stat(path: string): Promise<FileStat | null> {
  return invoke<FileStat | null>("fs_stat", { path }).catch(() => null);
}

function sameStat(a: FileStat | null, b: FileStat | null): boolean {
  if (!a || !b) return a === b;
  return a.modifiedMs === b.modifiedMs && a.size === b.size;
}

/** フォルダの下の `.string`（`.` を含まない名前はフォルダとみなして中も見る）。 */
async function listStringFiles(fs: TauriProjectFs, dir: string): Promise<string[]> {
  const out: string[] = [];
  let names: string[];
  try {
    names = [...(await fs.list(dir))].sort();
  } catch {
    return out;
  }
  for (const name of names) {
    const path = `${dir}/${name}`;
    if (/\.string$/i.test(name)) out.push(path);
    else if (!name.includes(".")) out.push(...(await listStringFiles(fs, path)));
  }
  return out;
}
