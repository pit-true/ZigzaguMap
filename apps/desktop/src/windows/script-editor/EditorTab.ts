import { invoke } from "@tauri-apps/api/core";
import type { EditorState, StateEffect, Text } from "@codemirror/state";
import type { LineEnding, ScriptFileKind } from "./fileText";
import type { ScriptRomOpenRequest } from "./protocol";

/** ファイルの更新日時と大きさ（Rust の `fs_stat`）。 */
export interface FileStat {
  readonly modifiedMs: number;
  readonly size: number;
  readonly dir: boolean;
}

/**
 * タブ 1 つ（開いているファイル 1 つ）。EditorState をファイルごとに持ち、表示中のタブだけを EditorView に載せる。
 * `state` は表示中のタブでも常に最新（ビューの更新のたびに入れ直す）。
 */
export class EditorTab {
  /** 保存した（読んだ）ときの本文。今の本文と違えば未保存。 */
  savedDoc: Text;
  /** 最後に読んだ・保存したときの更新日時と大きさ（外部の変更を見つけるのに使う）。 */
  stat: FileStat | null;
  /** ディスクに見当たらない（外部で消された）。 */
  missing = false;
  /** 保存中（その間は外部の変更を調べない）。 */
  saving = false;
  /** 表示していないときのスクロールの位置。 */
  scroll: StateEffect<unknown> | null = null;
  /** 素の ROM のスクリプトの読み取り専用のタブ（#206）なら、その中身。ファイルのタブなら null。 */
  rom: ScriptRomOpenRequest | null = null;

  constructor(
    readonly path: string,
    readonly kind: ScriptFileKind,
    public state: EditorState,
    public lineEnding: LineEnding,
    public bom: boolean,
    stat: FileStat | null,
  ) {
    this.savedDoc = state.doc;
    this.stat = stat;
  }

  /** ファイルの名前（タブに出す）。 */
  get name(): string {
    return this.path.slice(this.path.lastIndexOf("/") + 1);
  }

  /** 未保存の変更があるか（ROM のタブは読み取り専用なので無い）。 */
  get dirty(): boolean {
    if (this.rom) return false;
    return !this.state.doc.eq(this.savedDoc);
  }
}

/** 更新日時と大きさが同じか。 */
export function sameStat(a: FileStat | null, b: FileStat | null): boolean {
  if (!a || !b) return a === b;
  return a.modifiedMs === b.modifiedMs && a.size === b.size;
}

/** ファイルの更新日時と大きさ（Rust の `fs_stat`。無ければ null）。 */
export function statFile(path: string): Promise<FileStat | null> {
  return invoke<FileStat | null>("fs_stat", { path });
}
