import { AUTOPEN_DIR, listJsonFiles } from "../project/paths.js";
import type { ProjectFs } from "../project/ProjectFs.js";
import { autoPenFileBase, autoPenPath, parseAutoPenFile, stringifyAutoPenFile } from "../project/AutoPenJson.js";
import { parseBochiAssistText } from "./BochiAssistText.js";
import { DEFAULT_PART_FILES } from "./defaults/bprj.js";
import { matchScore, primaryRefMatches, primaryRefOf } from "./tilesetMatch.js";
import { partUsesPrimary, partUsesSecondary, type AutoPenFile, type AutoPenPart, type AutoPenTilesetInfo } from "./types.js";

/** 読めなかったファイル。 */
export interface AutoPenProblem {
  readonly path: string;
  readonly message: string;
}

/** 開くときの指定。 */
export interface AutoPenLibraryOptions {
  /** ファイルを書く前に呼ぶ（CfruProject.ensureManifest を渡す。スタンプと同じ）。 */
  readonly beforeWrite?: (fs: ProjectFs) => Promise<unknown>;
}

interface Entry {
  file: AutoPenFile;
  /** 同梱の既定（ファイルではない）。 */
  builtIn?: boolean;
  /** 書いたファイルの名前の元（拡張子なし）。まだ書いていなければ null。 */
  base: string | null;
}

/** Bochi の txt を取り込んだ結果。 */
export interface BochiImportResult {
  /** 読めたファイルの数。 */
  readonly files: number;
  /** 今のタイルセットの組に合ったファイルの数。 */
  readonly matched: number;
  /** 足したパーツの数（同じ名前は置き換えた）。 */
  readonly parts: number;
  /** 足したパーツ（並び順。編集中の一覧へも同じ規則で足す。#379）。 */
  readonly incoming: readonly AutoPenPart[];
  /** 書いたパス。 */
  readonly written: readonly string[];
}

/** `base` に `incoming` を足す（同じ名前は `incoming` で置き換え、足したものは `incoming` の並びで後ろへ）。 */
export function mergeParts(base: readonly AutoPenPart[], incoming: readonly AutoPenPart[]): AutoPenPart[] {
  const names = new Set(incoming.map((p) => p.name));
  return [...base.filter((p) => !names.has(p.name)), ...incoming];
}

/**
 * 自動ペンのパーツの定義（#303）。`maps\autopen\*.json` を初めて使うときに読み、保存はすぐファイルに書く
 * （マップの出力とは別で、元に戻すの対象にもしない。スタンプと同じ）。
 * 出力先のフォルダが無いとき（素の ROM だけで開いたとき）はメモリだけに持ち、`attach` でフォルダが決まったときに書く。
 *
 * タイルセットに合うファイルは「識別子と場所の両方が同じ」「識別子が同じ（別の ROM へ移したもの）」「場所が同じ
 * （ブロックを編集したあと）」の順で選ぶ。主と副の両方のブロックを使うパーツは副のファイルに入れる。
 */
export class AutoPenLibrary {
  private readonly entries: Entry[] = [];
  private fsValue: ProjectFs | null;
  private beforeWrite: AutoPenLibraryOptions["beforeWrite"];
  /** 読めなかったファイル（使わず、ファイルも消さない）。 */
  readonly problems: AutoPenProblem[] = [];
  /** 保存・取り込みのたびに増える（画面が描き直しの要否を見る）。 */
  revision = 0;
  /** ファイルが無いタイルセットに使う、同梱の既定のパーツ（テストで差し替えられる）。 */
  defaults: readonly AutoPenFile[] = DEFAULT_PART_FILES;

  private constructor(fs: ProjectFs | null, options: AutoPenLibraryOptions) {
    this.fsValue = fs;
    this.beforeWrite = options.beforeWrite;
  }

  /** `fs` の maps\autopen\ を読む。`fs` が null ならメモリだけの空の一覧。 */
  static async open(fs: ProjectFs | null, options: AutoPenLibraryOptions = {}): Promise<AutoPenLibrary> {
    const lib = new AutoPenLibrary(fs, options);
    if (fs) await lib.readFolder(fs);
    return lib;
  }

  /** 書き先のフォルダ（無ければ null）。 */
  get fs(): ProjectFs | null {
    return this.fsValue;
  }

  /** 読んだファイルの数。 */
  get fileCount(): number {
    return this.entries.length;
  }

  private async readFolder(fs: ProjectFs): Promise<void> {
    for (const { path, base } of await listJsonFiles(fs, AUTOPEN_DIR)) {
      try {
        this.entries.push({ file: parseAutoPenFile(await fs.readText(path), path), base });
      } catch (e) {
        this.problems.push({ path, message: (e as Error).message });
      }
    }
  }

  /** タイルセットに合ういちばんよいファイル（無ければ null）。同じ点数なら名前がそのタイルセットの識別子のもの。 */
  private find(info: AutoPenTilesetInfo): Entry | null {
    const own = autoPenFileBase(info);
    let best: Entry | null = null;
    let bestScore = 0;
    for (const e of this.entries) {
      const s = matchScore(e.file.tileset, info) * 2 + (e.base === own ? 1 : 0);
      if (matchScore(e.file.tileset, info) > 0 && s > bestScore) {
        best = e;
        bestScore = s;
      }
    }
    if (best) return best;
    // ファイルが無ければ同梱の既定（識別子か場所が合うもの）
    let def: AutoPenFile | null = null;
    let defScore = 0;
    for (const f of this.defaults) {
      const s = matchScore(f.tileset, info);
      if (s > defScore) {
        def = f;
        defScore = s;
      }
    }
    return def ? { file: def, base: null, builtIn: true } : null;
  }

  /** そのタイルセットのパーツが同梱の既定のものか（まだ保存していない）。 */
  usesDefaults(info: AutoPenTilesetInfo): boolean {
    return this.find(info)?.builtIn === true;
  }

  /** そのタイルセットのファイル（無ければ null）。 */
  fileFor(info: AutoPenTilesetInfo): AutoPenFile | null {
    return this.find(info)?.file ?? null;
  }

  /**
   * 主と副の組で使えるパーツ（並び順）。主のファイルのうち副のブロックを使わないものと、副のファイルのうち
   * 主のブロックを使わないものか、この主と組のもの。
   */
  partsFor(primary: AutoPenTilesetInfo, secondary: AutoPenTilesetInfo): AutoPenPart[] {
    const out: AutoPenPart[] = [];
    const p = this.find(primary);
    if (p) for (const part of p.file.parts) if (!partUsesSecondary(part)) out.push(part);
    const s = this.find(secondary);
    if (s) {
      for (const part of s.file.parts) {
        const usable = !partUsesPrimary(part) || (part.primary !== undefined && primaryRefMatches(part.primary, primary));
        if (usable) out.push(part);
      }
    }
    return out.map((part, i) => ({ part, i })).sort((a, b) => a.part.order - b.part.order || a.i - b.i).map((x) => x.part);
  }

  /**
   * 主と副の組のパーツを保存する（`parts` の並びで order を付け直す）。副のブロックを使うものは副のファイルへ、
   * それ以外は主のファイルへ書く。副のファイルにある、ほかの主と組のパーツはそのまま残す。
   * 中身が無く、ファイルもまだ無いタイルセットには書かない。戻り値は書いたパス（フォルダが無ければ空）。
   */
  async save(primary: AutoPenTilesetInfo, secondary: AutoPenTilesetInfo, parts: readonly AutoPenPart[]): Promise<string[]> {
    const ps: AutoPenPart[] = [];
    const ss: AutoPenPart[] = [];
    parts.forEach((raw, order) => {
      const { primary: _drop, ...rest } = raw;
      const part: AutoPenPart = { ...rest, order };
      if (partUsesSecondary(part)) ss.push(partUsesPrimary(part) ? { ...part, primary: primaryRefOf(primary) } : part);
      else ps.push(part);
    });
    const oldSecondary = this.find(secondary);
    if (oldSecondary) {
      for (const part of oldSecondary.file.parts) {
        if (partUsesPrimary(part) && partUsesSecondary(part) && !(part.primary && primaryRefMatches(part.primary, primary))) ss.push(part);
      }
    }
    const written: string[] = [];
    for (const [info, list] of [
      [primary, ps],
      [secondary, ss],
    ] as const) {
      const old = this.find(info);
      if (list.length === 0 && !old) continue;
      const path = await this.put(info, { tileset: info, parts: list, ...(old?.file.extra ? { extra: old.file.extra } : {}) });
      if (path) written.push(path);
    }
    this.revision++;
    return written;
  }

  /** そのタイルセットのファイルを置き換える（名前はそのタイルセットの識別子）。 */
  private async put(info: AutoPenTilesetInfo, file: AutoPenFile): Promise<string | null> {
    const base = autoPenFileBase(info);
    let entry = this.entries.find((e) => e.base === base || (e.base === null && autoPenFileBase(e.file.tileset) === base));
    if (entry) entry.file = file;
    else this.entries.push((entry = { file, base: null }));
    return this.write(entry);
  }

  private async write(entry: Entry): Promise<string | null> {
    const fs = this.fsValue;
    if (!fs) return null;
    const base = entry.base ?? autoPenFileBase(entry.file.tileset);
    if (this.beforeWrite) await this.beforeWrite(fs);
    await fs.writeText(autoPenPath(base), stringifyAutoPenFile(entry.file));
    entry.base = base;
    return autoPenPath(base);
  }

  /**
   * Bochi の `mapassist\*.txt` の中身を読み、今の組に合うファイルのパーツを足して保存する（同じ名前は置き換える）。
   * Bochi のファイルは書き換えない。
   */
  async importBochi(texts: readonly string[], primary: AutoPenTilesetInfo, secondary: AutoPenTilesetInfo): Promise<BochiImportResult> {
    const files = texts.map(parseBochiAssistText).filter((f): f is AutoPenFile => f !== null);
    const pick = (info: AutoPenTilesetInfo): AutoPenFile | null => {
      let best: AutoPenFile | null = null;
      let score = 0;
      for (const f of files) {
        const s = matchScore(f.tileset, info);
        if (s > score) {
          best = f;
          score = s;
        }
      }
      return best;
    };
    const matched: AutoPenFile[] = [];
    const pf = pick(primary);
    const sf = pick(secondary);
    const incoming: AutoPenPart[] = [];
    if (pf) {
      matched.push(pf);
      incoming.push(...pf.parts.filter((p) => !partUsesSecondary(p)));
    }
    if (sf) {
      matched.push(sf);
      incoming.push(...sf.parts.filter((p) => !partUsesPrimary(p) || (p.primary !== undefined && primaryRefMatches(p.primary, primary))));
    }
    if (incoming.length === 0) return { files: files.length, matched: matched.length, parts: 0, incoming: [], written: [] };
    incoming.sort((a, b) => a.order - b.order);
    const written = await this.save(primary, secondary, mergeParts(this.partsFor(primary, secondary), incoming));
    return { files: files.length, matched: matched.length, parts: incoming.length, incoming, written };
  }

  /** まだファイルに書いていない定義の数。 */
  get pendingCount(): number {
    return this.entries.filter((e) => e.base === null).length;
  }

  /**
   * 書き先のフォルダを決める（素の ROM だけで開いて、出力先を選んだとき）。そのフォルダの定義を読み、
   * メモリだけの定義を書く（同じタイルセットのファイルがあれば、メモリの方で上書きする）。戻り値は書いたパス。
   */
  async attach(fs: ProjectFs, options?: AutoPenLibraryOptions): Promise<string[]> {
    if (options) this.beforeWrite = options.beforeWrite;
    if (this.fsValue === fs) return [];
    return this.moveTo(fs, this.entries.filter((e) => e.base === null));
  }

  /** 書き先のフォルダを移す（出力先を指定して出力したとき）。今持っている定義を全部書く。 */
  async relocate(fs: ProjectFs): Promise<string[]> {
    return this.moveTo(fs, [...this.entries]);
  }

  private async moveTo(fs: ProjectFs, carry: readonly Entry[]): Promise<string[]> {
    const files = carry.map((e) => e.file);
    this.entries.length = 0;
    this.problems.length = 0;
    this.fsValue = fs;
    await this.readFolder(fs);
    const written: string[] = [];
    for (const file of files) {
      const p = await this.put(file.tileset, file);
      if (p) written.push(p);
    }
    this.revision++;
    return written;
  }
}
