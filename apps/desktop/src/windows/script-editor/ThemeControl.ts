import { invoke } from "@tauri-apps/api/core";
import { jaScriptEditorAssist as ta } from "../../i18n/ja.scriptEditorAssist";
import { EDITOR_THEMES, currentEditorTheme, isEditorTheme, setCurrentEditorTheme, themeCompartment, themeFor, type EditorThemeId } from "./extensions/themes";
import type { ScriptEditorWindow } from "./ScriptEditorWindow";

/** エディタのテーマ（下の帯の選択欄と、個人設定の `scriptEditorTheme`）。 */
export class ThemeControl {
  /** 下の帯のテーマの選択欄。 */
  readonly select: HTMLSelectElement;

  constructor(private readonly w: ScriptEditorWindow) {
    const select = document.createElement("select");
    select.className = "se-theme";
    select.title = ta.themeLabel;
    select.dataset["autoId"] = "se.theme";
    for (const id of EDITOR_THEMES) {
      const option = document.createElement("option");
      option.value = id;
      option.textContent = ta.themes[id] ?? id;
      select.append(option);
    }
    select.value = currentEditorTheme();
    select.addEventListener("change", () => {
      if (isEditorTheme(select.value)) this.set(select.value);
      this.w.view.focus();
    });
    this.select = select;
  }

  /** 個人設定のテーマを読む（無ければ既定）。 */
  async load(): Promise<void> {
    try {
      const text = await invoke<string>("load_settings");
      const saved = text ? (JSON.parse(text) as { scriptEditorTheme?: unknown }).scriptEditorTheme : undefined;
      setCurrentEditorTheme(isEditorTheme(saved) ? saved : currentEditorTheme());
      this.select.value = currentEditorTheme();
    } catch {
      setCurrentEditorTheme(currentEditorTheme());
    }
  }

  /** テーマを変える（全部のタブに当て、個人設定に残す）。 */
  set(id: EditorThemeId): void {
    const w = this.w;
    setCurrentEditorTheme(id);
    this.select.value = id;
    const effects = themeCompartment.reconfigure(themeFor(id));
    for (const tab of w.tabs) w.dispatchTo(tab, { effects });
    w.client.setting("scriptEditorTheme", id);
    w.setMessage(ta.themeChanged(ta.themes[id] ?? id));
  }
}
