import { EditError, EditErrorCode, defaultScriptsJsonStringsPath, isWorkMapId, normalizeScriptPath, type Command } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaScriptsTable as t } from "../../i18n/ja.scriptsTable";
import { showError } from "../MessageBox";
import { autoId } from "../form/controls";
import { showEditError } from "../form/inputErrors";
import "../../styles/scriptsTable.css";

/**
 * 対応表のダイアログ（ScriptsTableDialog）と「.s を新しく作る」（NewScriptDialog）で使う部品
 * （入力欄・欄の値の読み取り・入力エラーの出し方・コマンドの実行）。
 */

/** 入力の誤り（ダイアログに出す文言つき）。 */
export class InputError extends Error {}

/** バンクの欄（0〜255）。 */
export function parseBank(text: string): number {
  const m = /^\s*(\d{1,3})\s*$/.exec(text);
  const v = m ? Number(m[1]) : NaN;
  if (!(v >= 0 && v <= 255)) throw new InputError(t.invalidBank(text));
  return v;
}

/** マップの欄（空欄でバンク全体）。 */
export function parseMap(text: string): number | null {
  if (text.trim() === "") return null;
  const m = /^\s*(\d{1,3})\s*$/.exec(text);
  const v = m ? Number(m[1]) : NaN;
  if (!(v >= 0 && v <= 255)) throw new InputError(t.invalidMap(text));
  return v;
}

/** コマンドの入力エラーを、この画面の文言で出す。 */
export async function showScriptsError(e: unknown): Promise<void> {
  if (e instanceof InputError) {
    await showError(e.message);
  } else if (e instanceof EditError && e.code === EditErrorCode.InvalidScriptPath) {
    const reason = String(e.params["reason"]);
    await showError(t.invalidPath(String(e.params["field"]), String(e.params["path"]), t.pathProblem[reason] ?? reason));
  } else if (e instanceof EditError && e.code === EditErrorCode.ScriptsTableIndexOutOfRange) {
    await showError(t.indexOutOfRange(Number(e.params["index"]), Number(e.params["count"])));
  } else {
    await showEditError(e);
  }
}

/** 対応表をコマンドで変える。入力エラーはダイアログで出し、false を返す。 */
export function runScriptsCommand(state: EditorState, command: Command): boolean {
  const bus = state.session?.bus;
  if (!bus) return false;
  try {
    bus.execute(command);
    return true;
  } catch (e) {
    void showScriptsError(e);
    return false;
  }
}

/** 入力欄 1 つ（ラベルと、あれば欄の後ろの説明）。 */
export function field(form: HTMLElement, id: string, caption: string, wide = false, hint?: string): HTMLInputElement {
  const label = document.createElement("label");
  label.textContent = caption;
  const input = autoId(document.createElement("input"), id);
  input.type = "text";
  input.spellcheck = false;
  input.id = `st-${id}`;
  label.htmlFor = input.id;
  if (wide) input.classList.add("st-wide");
  if (hint !== undefined) input.placeholder = hint;
  form.append(label, input);
  return input;
}

/** `.string` の欄。`.s` の欄に合わせて既定の名前を入れ、手で変えたらそのまま残す。 */
export class StringsField {
  /** 手で変えたか（変えていなければ `.s` に合わせて書き換える）。 */
  private touched = false;

  constructor(
    readonly input: HTMLInputElement,
    private readonly script: () => string,
  ) {
    input.addEventListener("input", () => {
      this.touched = input.value.trim() !== "" && input.value.trim() !== this.auto();
    });
  }

  /** `.s` に合わせた既定の名前（`.s` が空なら空）。 */
  private auto(): string {
    const s = normalizeScriptPath(this.script());
    return s === "" ? "" : defaultScriptsJsonStringsPath(s);
  }

  /** `.s` の欄が変わったとき。 */
  follow(): void {
    if (!this.touched) this.input.value = this.auto();
  }

  /** 行の値を入れる（`null` なら既定の名前）。 */
  load(strings: string | null): void {
    this.touched = strings !== null && strings !== this.auto();
    this.input.value = strings ?? this.auto();
  }

  /**
   * 表に書く値。既定の名前と同じなら null（`Strings` を省く）にする。
   * ただし、元の行が同じ値を書いていたら、そのまま残す（読み直しても同じ表になるように）。
   */
  value(original: string | null | undefined): string | null {
    const v = normalizeScriptPath(this.input.value);
    if (v === "") return null;
    if (original !== undefined && original !== null && normalizeScriptPath(original) === v) return original;
    return v === this.auto() ? null : v;
  }
}

/** 表示中のマップ（作業用のマップは除く）と名前。 */
export function currentMap(state: EditorState): { bank: number; map: number; name: string } | null {
  const m = state.map;
  if (!m || isWorkMapId(m.id)) return null;
  return { bank: m.id.bank, map: m.id.map, name: m.doc.mapNameText() ?? "" };
}
