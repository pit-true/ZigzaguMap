import { parseStringFile, type StringFile } from "../strings/StringFile.js";

/** `.string` の `#org` 1 つ（索引用）。 */
export interface ScriptStringEntry {
  readonly label: string;
  /** プロジェクトフォルダからの相対パス（区切りは `/`）。 */
  readonly path: string;
  /** `#org` の行（1 始まり）。 */
  readonly line: number;
  /** ラベルが指す本文（本文の無い `#org` は、本文のある次の `#org` の本文）。 */
  readonly text: string;
}

/**
 * 文字列のラベルの索引（`strings/` の `.string` から作る）。ファイルごとに持ち、1 ファイルを読み直すとそのファイルの分だけが入れ替わる。
 * 名前は大文字小文字を区別する（as と同じ）。同じ名前が複数あれば、すべてを持つ（入れた順、ファイルの中は行の順）。
 */
export class ScriptStringIndex {
  private readonly files = new Map<string, readonly ScriptStringEntry[]>();
  private readonly byLabel = new Map<string, ScriptStringEntry[]>();
  private versionNo = 0;

  /** 変わるたびに増える番号（作った物の使い回しの判定に使う）。 */
  get version(): number {
    return this.versionNo;
  }

  /** ファイルのテキストを読んで、そのファイルの分を入れ替える。読んだ形を返す。 */
  updateFile(path: string, text: string): StringFile {
    const file = parseStringFile(text);
    this.setEntries(path, entriesOf(path, file));
    return file;
  }

  /** ファイルの分を消す。 */
  removeFile(path: string): void {
    const old = this.files.get(path);
    if (!old) return;
    this.files.delete(path);
    for (const e of old) {
      const list = this.byLabel.get(e.label);
      if (!list) continue;
      const kept = list.filter((x) => x.path !== path);
      if (kept.length === 0) this.byLabel.delete(e.label);
      else this.byLabel.set(e.label, kept);
    }
    this.versionNo++;
  }

  /** 入っているファイルのパス（入れた順）。 */
  paths(): string[] {
    return [...this.files.keys()];
  }

  /** ファイルの `#org`（行の順）。 */
  entriesIn(path: string): readonly ScriptStringEntry[] {
    return this.files.get(path) ?? [];
  }

  /** ラベルの `#org`（同じ名前のものすべて）。 */
  find(label: string): readonly ScriptStringEntry[] {
    return this.byLabel.get(label) ?? [];
  }

  /** ラベルがあるか。 */
  has(label: string): boolean {
    return this.byLabel.has(label);
  }

  /** ラベルの名前（重なりなし）。 */
  labels(): string[] {
    return [...this.byLabel.keys()];
  }

  private setEntries(path: string, entries: readonly ScriptStringEntry[]): void {
    this.removeFile(path);
    this.files.set(path, entries);
    for (const e of entries) {
      const list = this.byLabel.get(e.label);
      if (list) list.push(e);
      else this.byLabel.set(e.label, [e]);
    }
    this.versionNo++;
  }
}

function entriesOf(path: string, file: StringFile): ScriptStringEntry[] {
  const out: ScriptStringEntry[] = [];
  for (let i = 0; i < file.entries.length; i++) {
    const e = file.entries[i]!;
    let text = e.text;
    if (e.bodyLines.length === 0) {
      for (let k = i + 1; k < file.entries.length; k++) {
        if (file.entries[k]!.bodyLines.length > 0) {
          text = file.entries[k]!.text;
          break;
        }
      }
    }
    out.push({ label: e.label, path, line: e.headerLine + 1, text });
  }
  return out;
}
