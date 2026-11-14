import type { AsmLineEnding } from "../asm/lineEnding.js";
import { indexAsmFile, type ScriptEqu, type ScriptFileIndex, type ScriptLabel } from "./ScriptFileIndex.js";

/** 保存した索引の形式の番号。 */
export const SCRIPT_INDEX_FORMAT = 1;

/**
 * JSON にできる索引の写し（メインとエディタのウィンドウの間で送る・測る用）。
 * 小さくするため、パスはファイルに 1 回だけ書き、ラベルと `.equ` は配列で持つ。
 */
export interface ScriptIndexSnapshot {
  readonly format: number;
  readonly files: readonly ScriptFileSnapshot[];
}

/** 1 ファイル分の写し。 */
export interface ScriptFileSnapshot {
  readonly path: string;
  /** 改行が CRLF なら 1、LF なら 0。 */
  readonly crlf: 0 | 1;
  /** `[名前, 行, 桁, .global なら 1・無ければ 0, プレビュー（行を "\n" でつないだもの）]`。 */
  readonly labels: readonly (readonly [string, number, number, 0 | 1, string])[];
  /** `[名前, 値, 行]` か、説明があれば `[名前, 値, 行, 説明]`。 */
  readonly equs: readonly (readonly [string, string, number] | readonly [string, string, number, string])[];
  readonly includes: readonly string[];
  readonly movements: readonly string[];
}

/**
 * ラベルと `.equ` の索引。ファイルごとに持ち、1 ファイルを読み直すとそのファイルの分だけが入れ替わる。
 *
 * - 名前は大文字・小文字を区別する（as と同じ）。
 * - 同じ名前が複数のファイル（や同じファイルの複数の行）にあれば、すべてを持つ。並びはファイルを入れた順、
 *   同じファイルの中は行の順。
 */
export class ScriptIndex {
  private readonly fileMap = new Map<string, ScriptFileIndex>();
  private readonly labelMap = new Map<string, ScriptLabel[]>();
  private readonly equMap = new Map<string, ScriptEqu[]>();

  /** ファイルのテキストを読んで、そのファイルの分を入れ替える。 */
  updateFile(path: string, text: string): ScriptFileIndex {
    const entry = indexAsmFile(path, text);
    this.setFile(entry);
    return entry;
  }

  /** 1 ファイル分の索引を入れる（同じパスの古い分は消す）。 */
  setFile(entry: ScriptFileIndex): void {
    this.removeFile(entry.path);
    this.fileMap.set(entry.path, entry);
    for (const label of entry.labels) push(this.labelMap, label.name, label);
    for (const equ of entry.equs) push(this.equMap, equ.name, equ);
  }

  /** ファイルの分を消す。無ければ何もしない。 */
  removeFile(path: string): void {
    const old = this.fileMap.get(path);
    if (!old) return;
    this.fileMap.delete(path);
    for (const label of old.labels) drop(this.labelMap, label.name, path);
    for (const equ of old.equs) drop(this.equMap, equ.name, path);
  }

  /** すべて消す。 */
  clear(): void {
    this.fileMap.clear();
    this.labelMap.clear();
    this.equMap.clear();
  }

  /** 入っているファイルのパス（入れた順）。 */
  paths(): string[] {
    return [...this.fileMap.keys()];
  }

  /** 1 ファイル分の索引。無ければ undefined。 */
  file(path: string): ScriptFileIndex | undefined {
    return this.fileMap.get(path);
  }

  /** 読んだときの改行。ファイルが無ければ undefined。 */
  lineEndingOf(path: string): AsmLineEnding | undefined {
    return this.fileMap.get(path)?.lineEnding;
  }

  /** ラベルの定義（同じ名前のものすべて）。無ければ空。 */
  findLabels(name: string): readonly ScriptLabel[] {
    return this.labelMap.get(name) ?? [];
  }

  /** ラベルの定義（最初の 1 つ）。無ければ undefined。 */
  findLabel(name: string): ScriptLabel | undefined {
    return this.labelMap.get(name)?.[0];
  }

  /** `.equ` の定義（同じ名前のものすべて）。無ければ空。 */
  findEqus(name: string): readonly ScriptEqu[] {
    return this.equMap.get(name) ?? [];
  }

  /** `.equ` の定義（最初の 1 つ）。無ければ undefined。 */
  findEqu(name: string): ScriptEqu | undefined {
    return this.equMap.get(name)?.[0];
  }

  /** ラベルの名前（重なりなし）。 */
  labelNames(): string[] {
    return [...this.labelMap.keys()];
  }

  /** `.equ` の名前（重なりなし）。 */
  equNames(): string[] {
    return [...this.equMap.keys()];
  }

  /** すべてのラベル（ファイルの順、ファイルの中は行の順）。 */
  allLabels(): ScriptLabel[] {
    const out: ScriptLabel[] = [];
    for (const f of this.fileMap.values()) out.push(...f.labels);
    return out;
  }

  /** すべての `.equ`（ファイルの順、ファイルの中は行の順）。 */
  allEqus(): ScriptEqu[] {
    const out: ScriptEqu[] = [];
    for (const f of this.fileMap.values()) out.push(...f.equs);
    return out;
  }

  /** 移動の名前（`xse_defines.s` から。値は {@link findEqu} で引ける）。 */
  movementNames(): string[] {
    const out: string[] = [];
    for (const f of this.fileMap.values()) out.push(...f.movements);
    return out;
  }

  /** JSON にできる写し。 */
  toSnapshot(): ScriptIndexSnapshot {
    return { format: SCRIPT_INDEX_FORMAT, files: [...this.fileMap.values()].map(toFileSnapshot) };
  }

  /** 写しから戻す。形式の番号が違えば例外。 */
  static fromSnapshot(snapshot: ScriptIndexSnapshot): ScriptIndex {
    if (snapshot.format !== SCRIPT_INDEX_FORMAT) throw new Error(`索引の形式が違います: ${snapshot.format}`);
    const index = new ScriptIndex();
    for (const f of snapshot.files) index.setFile(fromFileSnapshot(f));
    return index;
  }
}

function toFileSnapshot(f: ScriptFileIndex): ScriptFileSnapshot {
  return {
    path: f.path,
    crlf: f.lineEnding === "\r\n" ? 1 : 0,
    labels: f.labels.map((l) => [l.name, l.line, l.column, l.global ? 1 : 0, l.preview.join("\n")] as const),
    equs: f.equs.map((e) =>
      e.description === null ? ([e.name, e.value, e.line] as const) : ([e.name, e.value, e.line, e.description] as const),
    ),
    includes: f.includes,
    movements: f.movements,
  };
}

function fromFileSnapshot(f: ScriptFileSnapshot): ScriptFileIndex {
  const path = f.path;
  return {
    path,
    lineEnding: f.crlf ? "\r\n" : "\n",
    labels: f.labels.map(([name, line, column, global, preview]) => ({
      name,
      path,
      line,
      column,
      global: global === 1,
      preview: preview === "" ? [] : preview.split("\n"),
    })),
    equs: f.equs.map((e) => ({ name: e[0], value: e[1], description: e[3] ?? null, path, line: e[2] })),
    includes: f.includes,
    movements: f.movements,
  };
}

function push<T>(map: Map<string, T[]>, key: string, value: T): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}

function drop<T extends { readonly path: string }>(map: Map<string, T[]>, key: string, path: string): void {
  const list = map.get(key);
  if (!list) return;
  const kept = list.filter((v) => v.path !== path);
  if (kept.length === 0) map.delete(key);
  else if (kept.length !== list.length) map.set(key, kept);
}
