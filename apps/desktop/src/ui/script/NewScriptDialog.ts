import {
  AddScriptsTableEntryCommand,
  EditError,
  EditErrorCode,
  defaultScriptsJsonStringsPath,
  newScriptPath,
  normalizeScriptPath,
  scriptPathProblem,
  type ScriptsJsonResolution,
  type ScriptsTableEntryArgs,
} from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { jaScriptsTable as t } from "../../i18n/ja.scriptsTable";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";
import { askYesNo, showError } from "../MessageBox";
import { autoId } from "../form/controls";
import { InputError, StringsField, currentMap, field, parseBank, parseMap, runScriptsCommand, showScriptsError } from "./scriptsTableForm";

/** 「.s を新しく作る」ダイアログの初めの値。 */
export interface NewScriptRequest {
  readonly bank: number | null;
  readonly map: number | null;
  /** マップ名（null なら表示中のマップの名前）。 */
  readonly name?: string | null;
  /** 初めのファイル名。 */
  readonly fileName?: string;
  /** マップにスクリプトが要るのに対応する .s が無いときの説明を出す。 */
  readonly needed?: boolean;
}

/**
 * 「.s を新しく作る」（ファイル名の入力）。`assembly/overworld_scripts/<名前>.s` と `.string` の行を対応表に足す。
 * ファイルは出力（Ctrl+S）のときに作る（既にあれば聞いてから、作らずに足す）。足した行の番号を返す。やめたら null。
 */
export function openNewScriptDialog(state: EditorState, request: NewScriptRequest): Promise<number | null> {
  const session = state.session;
  if (!session) return Promise.resolve(null);
  if (!session.projectDir) return showError(t.noProject).then(() => null);
  return new Promise((resolve) => {
    let busy = false;
    const finish = (value: number | null): void => {
      frame.remove();
      resolve(value);
    };
    const frame = createDialog({ title: t.newTitle, className: "scripts-new-dialog", onClose: () => finish(null) });
    const intro = autoId(document.createElement("p"), "scriptsTable.new.intro");
    const neededText = request.needed && request.bank !== null && request.map !== null ? t.newNeeded(request.bank, request.map) : t.newIntro;
    intro.textContent = neededText;
    const form = document.createElement("div");
    form.className = "st-form";
    const fileName = field(form, "scriptsTable.new.name", t.fileName, true, t.fileNameHint);
    fileName.value = request.fileName ?? "";
    const bank = field(form, "scriptsTable.new.bank", t.bank, true);
    bank.value = request.bank === null ? "" : String(request.bank);
    const map = field(form, "scriptsTable.new.map", t.map, true, t.mapHint);
    map.value = request.map === null ? "" : String(request.map);
    const name = field(form, "scriptsTable.new.mapName", t.name, true);
    name.value = request.name ?? currentMap(state)?.name ?? "";
    const scriptOf = (): string => (fileName.value.trim() === "" ? "" : newScriptPath(fileName.value));
    const strings = new StringsField(field(form, "scriptsTable.new.strings", t.strings, true, t.stringsHint), scriptOf);
    const preview = autoId(document.createElement("div"), "scriptsTable.new.preview");
    preview.className = "st-preview";
    const update = (): void => {
      strings.follow();
      const s = scriptOf();
      preview.textContent = s === "" ? "" : t.willCreate(s, normalizeScriptPath(strings.input.value) || defaultScriptsJsonStringsPath(s));
    };
    fileName.addEventListener("input", update);
    strings.input.addEventListener("input", update);
    update();

    const ok = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      try {
        if (fileName.value.trim() === "") throw new InputError(t.invalidFileName);
        const script = scriptOf();
        const entry: ScriptsTableEntryArgs = { bank: parseBank(bank.value), map: parseMap(map.value), name: name.value, script, strings: strings.value(undefined) };
        // 名前の確認はコマンドと同じ規則で先に行う（既にあるかを調べる前に）。
        const problem = scriptPathProblem("script", script, true);
        if (problem) throw new EditError(EditErrorCode.InvalidScriptPath, { field: "script", path: script, reason: problem });
        let create = true;
        if (await session.fileExists(script)) {
          if (!(await askYesNo(t.existsAsk(script)))) return;
          create = false;
        }
        const index = session.scriptsTable.document.count;
        if (!runScriptsCommand(state, new AddScriptsTableEntryCommand({ entry, create }))) return;
        state.setStatus(create ? t.added(script) : t.addedExisting(script));
        finish(index);
      } catch (e) {
        await showScriptsError(e);
      } finally {
        busy = false;
      }
    };
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    buttons.append(
      autoId(dialogButton(t.create, () => void ok()), "scriptsTable.new.create"),
      autoId(dialogButton(t.cancel, () => finish(null)), "scriptsTable.new.cancel"),
    );
    frame.body.append(intro, form, preview, buttons);
    handleDialogKeys(frame, () => finish(null), (e) => {
      if (e.key === "Enter") void ok();
    });
    frame.register({
      title: t.newTitle,
      text: neededText,
      ...pressable([
        { label: t.create, aliases: ["ok"], run: () => void ok() },
        { label: t.cancel, aliases: ["cancel"], run: () => finish(null) },
      ]),
      setInput: (v) => {
        fileName.value = v;
        update();
      },
      input: () => fileName.value,
    });
    fileName.focus();
  });
}

/**
 * マップのスクリプトを書く `.s` と `.string`。対応表に無ければファイル名の入力を出して行を足す（イベントを置いたときなどに使う）。
 * やめたら null。
 */
export async function ensureScriptFile(state: EditorState, bank: number, map: number): Promise<ScriptsJsonResolution | null> {
  const table = state.session?.scriptsTable;
  if (!table) return null;
  const found = table.document.resolve(bank, map);
  if (found) return found;
  const index = await openNewScriptDialog(state, { bank, map, needed: true });
  return index === null ? null : (state.session?.scriptsTable.document.resolve(bank, map) ?? null);
}
