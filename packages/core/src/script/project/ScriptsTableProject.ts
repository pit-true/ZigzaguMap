import type { ProjectFs } from "../../project/ProjectFs.js";
import { SCRIPTS_JSON_PATH, ScriptsJsonFile, saveScriptsJson, type ScriptsJson } from "./ScriptsJson.js";
import { ScriptsTableDocument } from "./ScriptsTableDocument.js";

/**
 * 新しく作る `.s` の中身。ND と Chronos の既存の `.s` と同じ先頭（`.text`・`.thumb`・`.align 2`、空行、3 つの `.include`）に、
 * 書き始める位置の空行を 1 つ付ける。改行は LF（既存のファイルと同じ）。
 */
export const NEW_SCRIPT_FILE_TEXT = [
  ".text",
  ".thumb",
  ".align 2",
  "",
  '.include "../xse_commands.s"',
  '.include "../xse_defines.s"',
  '.include "../asm_defines.s"',
  "",
  "",
].join("\n");

/** 新しく作る `.string` の中身（空）。 */
export const NEW_STRINGS_FILE_TEXT = "";

/**
 * プロジェクトの maps\scripts.json（対応表）。プロジェクトを開いたときに読み（無ければ空）、出力（Ctrl+S）のときに書く。
 * 形式の読み書きは ScriptsJsonFile。読めなかったときは `loadError` を持ち、編集も書き出しもしない（壊れたファイルを上書きしないため）。
 */
export class ScriptsTableProject {
  /** 書き出し（か読み込み）の時点の scripts.json の文字列。 */
  private savedJson: string;
  /** このセッションで作った（か、作ろうとしたら既にあった）`.s` のパス。 */
  private readonly created = new Set<string>();

  private constructor(
    readonly document: ScriptsTableDocument,
    /** 読めなかった理由（読めたなら null）。 */
    readonly loadError: string | null,
    /** 読んだときにファイルがあったか。 */
    private fileExists: boolean,
  ) {
    this.savedJson = ScriptsJsonFile.stringify(document.toJson());
  }

  /** maps\scripts.json を読む。`fs` が null（素の ROM だけ）かファイルが無ければ空の表。 */
  static async open(fs: ProjectFs | null): Promise<ScriptsTableProject> {
    if (!fs || !(await fs.exists(SCRIPTS_JSON_PATH))) return ScriptsTableProject.of(ScriptsJsonFile.empty());
    try {
      return new ScriptsTableProject(new ScriptsTableDocument(ScriptsJsonFile.parse(await fs.readText(SCRIPTS_JSON_PATH))), null, true);
    } catch (e) {
      return new ScriptsTableProject(new ScriptsTableDocument(ScriptsJsonFile.empty()), e instanceof Error ? e.message : String(e), true);
    }
  }

  /** 読んだ内容から作る（テスト用）。 */
  static of(json: ScriptsJson, fileExists = false): ScriptsTableProject {
    return new ScriptsTableProject(new ScriptsTableDocument(json), null, fileExists);
  }

  /** 出力のときに作る `.s` と `.string`（まだ作っていないもの）。 */
  pendingFiles(): { readonly script: string; readonly strings: string }[] {
    return this.document.pendingFiles().filter((f) => !this.created.has(f.script));
  }

  /** 書き出してから変わったか（表か、まだ作っていないファイル）。 */
  isModified(): boolean {
    if (this.loadError !== null) return false;
    return ScriptsJsonFile.stringify(this.document.toJson()) !== this.savedJson || this.pendingFiles().length > 0;
  }

  /**
   * 出力する。新しく作る行の `.s` と `.string` を作り（既にあるファイルは書き換えない）、表が変わっていれば scripts.json を書く。
   * 表を変えていなければ scripts.json に触らない（手で書いた整形をそのまま残す）。戻り値は書いたパス。
   */
  async save(fs: ProjectFs): Promise<{ written: string[]; removed: string[] }> {
    const out = { written: [] as string[], removed: [] as string[] };
    if (this.loadError !== null) return out;
    for (const f of this.pendingFiles()) {
      if (!(await fs.exists(f.script))) {
        await fs.writeText(f.script, NEW_SCRIPT_FILE_TEXT);
        out.written.push(f.script);
      }
      if (!(await fs.exists(f.strings))) {
        await fs.writeText(f.strings, NEW_STRINGS_FILE_TEXT);
        out.written.push(f.strings);
      }
      this.created.add(f.script);
    }
    const json = ScriptsJsonFile.stringify(this.document.toJson());
    if (json !== this.savedJson || (!this.fileExists && this.document.count > 0)) {
      await saveScriptsJson(fs, this.document.toJson());
      out.written.push(SCRIPTS_JSON_PATH);
      this.fileExists = true;
    }
    this.savedJson = json;
    return out;
  }
}
