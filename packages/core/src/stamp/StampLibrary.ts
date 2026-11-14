import { STAMPS_DIR } from "../project/paths.js";
import type { ProjectFs } from "../project/ProjectFs.js";
import { checkStampShape, parseStamp, stampFileBase, stampFits, stampPath, stringifyStamp, type Stamp } from "../project/StampJson.js";

/** 読めなかったスタンプのファイル。 */
export interface StampProblem {
  readonly path: string;
  readonly message: string;
}

/** 開くときの指定。 */
export interface StampLibraryOptions {
  /**
   * ファイルを書く前に呼ぶ（CfruProject.ensureManifest を渡す。maps\project.json が無いと
   * BochiBochiEditor 改造版が maps\ を開けないため）。
   */
  readonly beforeWrite?: (fs: ProjectFs) => Promise<unknown>;
}

interface Entry {
  stamp: Stamp;
  /** 書いたファイルの名前の元（拡張子なし）。まだ書いていなければ null。 */
  base: string | null;
}

/** スタンプの名前を比べる形（前後の空白を外し、大文字小文字を区別しない）。 */
function nameKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * スタンプの一覧（#224）。`maps\stamps\*.json` を開いたときに読み、作る・名前の変更・上書き・削除はすぐファイルに書く
 * （マップの出力とは別で、元に戻すの対象にもしない。研究メモの Q9 の推奨）。
 * 出力先のフォルダが無いとき（素の ROM だけで開いたとき）はメモリだけに持ち、`attach` でフォルダが決まったときに書く。
 */
export class StampLibrary {
  private readonly entries = new Map<string, Entry>();
  private fsValue: ProjectFs | null;
  /** 読めなかったファイル（一覧には出さず、ファイルも消さない）。 */
  readonly problems: StampProblem[] = [];

  private beforeWrite: StampLibraryOptions["beforeWrite"];

  private constructor(fs: ProjectFs | null, options: StampLibraryOptions) {
    this.fsValue = fs;
    this.beforeWrite = options.beforeWrite;
  }

  /** `fs` の maps\stamps\ を読む。`fs` が null ならメモリだけの空の一覧。 */
  static async open(fs: ProjectFs | null, options: StampLibraryOptions = {}): Promise<StampLibrary> {
    const lib = new StampLibrary(fs, options);
    if (fs) await lib.readFolder(fs);
    return lib;
  }

  /** 書き先のフォルダ（無ければ null）。 */
  get fs(): ProjectFs | null {
    return this.fsValue;
  }

  /** まだファイルに書いていないスタンプの数。 */
  get pendingCount(): number {
    let n = 0;
    for (const e of this.entries.values()) if (e.base === null) n++;
    return n;
  }

  private async readFolder(fs: ProjectFs): Promise<void> {
    if (!(await fs.exists(STAMPS_DIR))) return;
    for (const file of await fs.list(STAMPS_DIR)) {
      const m = /^(.*)\.json$/i.exec(file);
      if (!m) continue;
      const path = `${STAMPS_DIR}/${file}`;
      try {
        const stamp = parseStamp(await fs.readText(path), path);
        const key = nameKey(stamp.name);
        if (this.entries.has(key)) {
          this.problems.push({ path, message: `同じ名前のスタンプがほかのファイルにあります: ${stamp.name}` });
          continue;
        }
        this.entries.set(key, { stamp, base: m[1]! });
      } catch (e) {
        this.problems.push({ path, message: (e as Error).message });
      }
    }
  }

  /** 全部（名前順）。 */
  list(): Stamp[] {
    return [...this.entries.values()].map((e) => e.stamp).sort((a, b) => a.name.localeCompare(b.name, "ja"));
  }

  /** 今のマップ（主・副タイルセットのポインタ）に貼れるものだけ（名前順）。 */
  fitting(primary: number, secondary: number): Stamp[] {
    return this.list().filter((s) => stampFits(s, primary, secondary));
  }

  /** 名前で引く。 */
  get(name: string): Stamp | null {
    return this.entries.get(nameKey(name))?.stamp ?? null;
  }

  /** そのスタンプのファイルのパス（まだ書いていなければ null）。 */
  pathOf(name: string): string | null {
    const e = this.entries.get(nameKey(name));
    return e?.base ? stampPath(e.base) : null;
  }

  private takenBases(except: Entry | null = null): string[] {
    const out: string[] = [];
    for (const e of this.entries.values()) if (e !== except && e.base) out.push(e.base);
    return out;
  }

  private async write(entry: Entry): Promise<string | null> {
    const fs = this.fsValue;
    if (!fs) return null;
    const old = entry.base;
    let base = old;
    if (base === null || nameKey(base) !== nameKey(stampFileBase(entry.stamp.name))) {
      const taken = this.takenBases(entry);
      // フォルダにあるが一覧に入っていないファイル（読めなかったものなど）とも重ねない。
      for (const f of await fs.list(STAMPS_DIR)) {
        const m = /^(.*)\.json$/i.exec(f);
        if (m && m[1] !== old) taken.push(m[1]!);
      }
      base = stampFileBase(entry.stamp.name, taken);
    }
    if (this.beforeWrite) await this.beforeWrite(fs);
    await fs.writeText(stampPath(base), stringifyStamp(entry.stamp));
    if (old !== null && old !== base) await fs.remove(stampPath(old));
    entry.base = base;
    return stampPath(base);
  }

  /**
   * 足す。同じ名前があれば、`overwrite` が true なら置き換え（作った日時はそのまま。ファイル名も同じ）、false なら例外。
   * 戻り値は書いたパス（フォルダが無ければ null）。
   */
  async save(stamp: Stamp, overwrite = false): Promise<string | null> {
    checkStampShape(stamp);
    if (stamp.name.trim() === "") throw new Error("スタンプの名前が空です");
    const key = nameKey(stamp.name);
    const old = this.entries.get(key);
    if (old && !overwrite) throw new Error(`同じ名前のスタンプがあります: ${old.stamp.name}`);
    const entry: Entry = old
      ? { stamp: { ...stamp, created: old.stamp.created || stamp.created, ...(old.stamp.extra ? { extra: old.stamp.extra } : {}) }, base: old.base }
      : { stamp, base: null };
    this.entries.set(key, entry);
    return this.write(entry);
  }

  /** 名前を変える（ファイル名も変える）。同じ名前のほかのスタンプがあれば例外。 */
  async rename(name: string, newName: string): Promise<string | null> {
    const key = nameKey(name);
    const entry = this.entries.get(key);
    if (!entry) throw new Error(`スタンプがありません: ${name}`);
    const trimmed = newName.trim();
    if (trimmed === "") throw new Error("スタンプの名前が空です");
    const newKey = nameKey(trimmed);
    if (newKey !== key && this.entries.has(newKey)) throw new Error(`同じ名前のスタンプがあります: ${trimmed}`);
    entry.stamp = { ...entry.stamp, name: trimmed };
    this.entries.delete(key);
    this.entries.set(newKey, entry);
    return this.write(entry);
  }

  /** 消す（ファイルも消す）。無ければ false。 */
  async remove(name: string): Promise<boolean> {
    const key = nameKey(name);
    const entry = this.entries.get(key);
    if (!entry) return false;
    this.entries.delete(key);
    if (this.fsValue && entry.base) await this.fsValue.remove(stampPath(entry.base));
    return true;
  }

  /**
   * 書き先のフォルダを決める（素の ROM だけで開いて、出力先を選んだとき）。そのフォルダのスタンプを読み、
   * メモリだけのスタンプを書く（同じ名前がフォルダにあれば、メモリの方で上書きする）。戻り値は書いたパス。
   */
  async attach(fs: ProjectFs, options?: StampLibraryOptions): Promise<string[]> {
    if (options) this.beforeWrite = options.beforeWrite;
    if (this.fsValue === fs) return [];
    const memory = [...this.entries.values()].filter((e) => e.base === null);
    this.entries.clear();
    this.problems.length = 0;
    this.fsValue = fs;
    await this.readFolder(fs);
    const written: string[] = [];
    for (const m of memory) {
      const key = nameKey(m.stamp.name);
      const existing = this.entries.get(key);
      const entry: Entry = existing ? { stamp: m.stamp, base: existing.base } : { stamp: m.stamp, base: null };
      this.entries.set(key, entry);
      const p = await this.write(entry);
      if (p) written.push(p);
    }
    return written;
  }
}
