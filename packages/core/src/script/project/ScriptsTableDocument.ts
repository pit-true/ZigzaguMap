import type { EditorContext } from "../../command/Command.js";
import {
  defaultScriptsJsonStringsPath,
  findScriptsJsonDuplicates,
  resolveScriptsJson,
  type ScriptsJson,
  type ScriptsJsonEntry,
  type ScriptsJsonExtra,
  type ScriptsJsonResolution,
} from "./ScriptsJson.js";

/** 対応表の 1 行。 */
export interface ScriptsTableRow {
  readonly entry: ScriptsJsonEntry;
  /** 出力のときに `.s` と `.string` を新しく作る行（ファイル名の入力から足した行）。既にあるファイルは書き換えない。 */
  readonly create: boolean;
}

/** 取り消しの控え（行の並び。行そのものは変えないので写さない）。 */
export type ScriptsTableSnapshot = readonly ScriptsTableRow[];

/**
 * 編集中の maps\scripts.json（バンク・マップと `.s`・`.string` の対応表）。
 * 読み書きの形式は ScriptsJsonFile、ここは並びの編集だけを受け持つ。変えるのはコマンド（ScriptsTableCommands）だけ。
 */
export class ScriptsTableDocument {
  private list: ScriptsTableRow[];

  constructor(
    json: ScriptsJson,
    /** ルートの Format と知らない項目（書き戻す）。 */
    private readonly root: { readonly format: number; readonly extra: ScriptsJsonExtra } = json,
  ) {
    this.list = json.entries.map((entry) => ({ entry, create: false }));
  }

  /** 行の並び。 */
  get rows(): readonly ScriptsTableRow[] {
    return this.list;
  }

  /** 行の数。 */
  get count(): number {
    return this.list.length;
  }

  /** 書き出す形。 */
  toJson(): ScriptsJson {
    return { format: this.root.format, entries: this.list.map((r) => r.entry), extra: this.root.extra };
  }

  /** バンク・マップのスクリプトを書く `.s` と `.string`（マップを指定した行が優先）。無ければ null。 */
  resolve(bank: number, map: number): ScriptsJsonResolution | null {
    return resolveScriptsJson(this.toJson(), bank, map);
  }

  /** 同じバンク・マップを指す行の組（後ろの行は使われない）。 */
  duplicates(): { readonly first: number; readonly duplicate: number }[] {
    return findScriptsJsonDuplicates(this.toJson());
  }

  /** 出力のときに作るファイル（`create` の行の `.s` と `.string`。同じパスは 1 回）。 */
  pendingFiles(): { readonly script: string; readonly strings: string }[] {
    const seen = new Set<string>();
    const out: { script: string; strings: string }[] = [];
    for (const r of this.list) {
      if (!r.create || seen.has(r.entry.script)) continue;
      seen.add(r.entry.script);
      out.push({ script: r.entry.script, strings: r.entry.strings ?? defaultScriptsJsonStringsPath(r.entry.script) });
    }
    return out;
  }

  snapshot(): ScriptsTableSnapshot {
    return this.list.slice();
  }

  restore(snapshot: ScriptsTableSnapshot): void {
    this.list = snapshot.slice();
  }

  /** `index` の位置に入れる（`index` が行の数なら末尾）。 */
  insert(index: number, row: ScriptsTableRow): void {
    this.list.splice(index, 0, row);
  }

  /** `index` の行を置き換える。 */
  replace(index: number, row: ScriptsTableRow): void {
    this.list[index] = row;
  }

  /** `index` の行を除く。 */
  remove(index: number): void {
    this.list.splice(index, 1);
  }

  /** `from` の行を `to` の位置へ動かす。 */
  move(from: number, to: number): void {
    const [row] = this.list.splice(from, 1);
    this.list.splice(to, 0, row!);
  }
}

/** 対応表を編集するコマンドが使う入口。 */
export interface ScriptsTableContext extends EditorContext {
  /** 編集中の対応表。読めなかったとき（scripts.json の形式が不正など）は Error。 */
  scriptsTable(): ScriptsTableDocument;
}

/** EditorContext が ScriptsTableContext か。 */
export function isScriptsTableContext(context: EditorContext): context is ScriptsTableContext {
  return typeof (context as Partial<ScriptsTableContext>).scriptsTable === "function";
}

/** EditorContext を ScriptsTableContext として使う。違えば Error。 */
export function scriptsTableContext(context: EditorContext): ScriptsTableContext {
  if (!isScriptsTableContext(context)) throw new Error("このコマンドには scripts.json の対応表（scriptsTable()）が必要です");
  return context;
}

/**
 * 既存の入口に `scriptsTable()` を足したものを作る（withRegionMap と同じ作り）。ほかの呼び出しはそのまま元へ渡す。
 * `get` はコマンドを実行するときに呼ばれる。
 */
export function withScriptsTable<T extends EditorContext>(base: T, get: () => ScriptsTableDocument): T & ScriptsTableContext {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "scriptsTable") return get;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    has(target, prop) {
      return prop === "scriptsTable" || Reflect.has(target, prop);
    },
  }) as T & ScriptsTableContext;
}
