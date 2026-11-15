import { ScriptConfigJson, SCRIPT_CONFIG_FILE, loadScriptConfig, readTextIfExists, type ProjectFs, type ScriptConfigSettings } from "@zigzagumap/core";
import type { Actions } from "../../app/Actions";
import type { EditorState } from "../../app/EditorState";
import type { MenuItem } from "../../app/menuDefinition";
import { ja } from "../../i18n/ja";
import { jaSettingsWindow as t } from "../../i18n/ja.settingsWindow";
import "../../styles/allSettings.css";
import { createDialog, dialogButton, handleDialogKeys, pressable, type DialogFrame } from "../Dialog";

/** 窓が使う機能（App が渡す）。 */
export interface AllSettingsHost {
  readonly state: EditorState;
  readonly actions: Actions;
  /** 今のメニューの全項目。 */
  menu(): MenuItem[];
  /** プロジェクトフォルダ（無ければ null）。 */
  projectFs(): ProjectFs | null;
  /** zigzagumap.json を書いたあと、スクリプトの設定を読み直す。 */
  reloadScriptConfig(): void;
}

/** プロジェクトの設定の欄（zigzagumap.json の script の節）。 */
type ProjectKey = "outputRom" | "labelTemplate" | "useGlobal" | "lineMaxChars" | "linesPerPage";
const PROJECT_KEYS: readonly ProjectKey[] = ["outputRom", "labelTemplate", "useGlobal", "lineMaxChars", "linesPerPage"];

let current: AllSettingsDialog | null = null;

/** 開いている窓（自動操作用）。 */
export function openAllSettings(): AllSettingsDialog | null {
  return current;
}

/**
 * 設定 > すべての設定...（Phase5 #404、Q14）。表示と設定のメニューの項目を、メニューの並び（サブメニューごとの見出し）で
 * 1 つの窓に並べる。チェックの付く項目はチェックの欄（押すとメニューを押したのと同じ。メニューのチェックも同じになる）、
 * 窓を開く項目は「開く...」のボタン。メニューはそのまま残す。項目はメニューの定義から作るので、メニューに足した項目は
 * ここにも出る（Phase5 の道具・グリッド・カーソル・視界・監視も）。下の欄はプロジェクトの設定（zigzagumap.json の script の節）。
 */
export class AllSettingsDialog {
  private readonly frame: DialogFrame;
  private readonly personal: HTMLElement;
  private readonly project: HTMLElement;
  private readonly fields = new Map<ProjectKey, HTMLInputElement>();
  private loaded: { text: string | null; settings: ScriptConfigSettings } | null = null;
  private readonly stopView: () => void;
  /** 最後の保存・読み込みの結果（自動操作用）。 */
  message = "";

  constructor(private readonly host: AllSettingsHost) {
    current?.close();
    current = this;
    this.frame = createDialog({ title: t.title, className: "all-settings-dialog", onClose: () => this.close() });
    this.personal = document.createElement("div");
    this.personal.className = "all-settings-personal";
    this.project = document.createElement("div");
    this.project.className = "all-settings-project";
    const heading = (text: string, note?: string): HTMLElement => {
      const h = document.createElement("div");
      h.className = "all-settings-heading";
      h.textContent = text;
      if (note) {
        const n = document.createElement("div");
        n.className = "all-settings-note";
        n.textContent = note;
        h.append(n);
      }
      return h;
    };
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const close = dialogButton(t.close, () => this.close());
    buttons.append(close);
    this.frame.body.append(heading(t.personal, t.personalNote), this.personal, heading(t.project), this.project, buttons);
    handleDialogKeys(this.frame, () => this.close());
    this.frame.register({
      title: t.title,
      text: "",
      ...pressable([
        { label: t.save, run: () => void this.saveProject() },
        { label: t.close, aliases: ["close", "cancel"], run: () => this.close() },
      ]),
    });
    this.stopView = host.state.on("view", () => this.refreshChecks());
    this.renderPersonal();
    this.ready = this.renderProject();
  }

  close(): void {
    this.stopView();
    this.frame.remove();
    if (current === this) current = null;
  }

  /** プロジェクトの設定を読み終えるまで待つ（自動操作用）。 */
  ready: Promise<void> = Promise.resolve();

  private renderPersonal(): void {
    const { actions } = this.host;
    const roots = this.host.menu().filter((m) => m.label === ja.menuView || m.label === ja.menuSettings);
    const nodes: HTMLElement[] = [];
    const walk = (items: readonly MenuItem[], path: string[]): void => {
      let group: HTMLElement | null = null;
      for (const item of items) {
        if (item.separator || !item.label) continue;
        if (item.children) {
          walk(item.children, [...path, item.label]);
          continue;
        }
        if (!item.id || !actions.isImplemented(item.id)) continue;
        if (!group) {
          const box = document.createElement("fieldset");
          const legend = document.createElement("legend");
          legend.textContent = path.join(" > ");
          box.append(legend);
          nodes.push(box);
          group = box;
        }
        const row = document.createElement("div");
        row.className = "all-settings-row";
        const id = item.id;
        const enabled = actions.isEnabled(item);
        if (actions.isCheckable(id)) {
          const label = document.createElement("label");
          const box = document.createElement("input");
          box.type = "checkbox";
          box.dataset["autoId"] = `allSettings.${id}`;
          box.dataset["action"] = id;
          box.checked = actions.isChecked(id);
          box.disabled = !enabled;
          box.addEventListener("change", () => {
            actions.run(id, item.label);
            // 押したあとの状態に合わせる（ラジオのような項目は前の印も外れる）
            setTimeout(() => this.refreshChecks(), 0);
          });
          label.append(box, item.label + (item.shortcut?.text ? `（${item.shortcut.text}）` : ""));
          row.append(label);
        } else {
          const name = document.createElement("span");
          name.textContent = item.label.replace(/\.\.\.$|…$/, "");
          const open = dialogButton(t.open, () => actions.run(id, item.label));
          open.dataset["autoId"] = `allSettings.${id}`;
          open.disabled = !enabled;
          row.append(name, open);
        }
        group.append(row);
      }
    };
    for (const root of roots) walk(root.children ?? [], [root.label!.replace(/\(.\)$/, "")]);
    this.personal.replaceChildren(...nodes);
  }

  /** チェックの欄を今の状態にそろえる（メニューで変えたときも）。 */
  private refreshChecks(): void {
    for (const box of this.personal.querySelectorAll<HTMLInputElement>("input[type=checkbox][data-action]")) {
      box.checked = this.host.actions.isChecked(box.dataset["action"]!);
    }
  }

  private async renderProject(): Promise<void> {
    const fs = this.host.projectFs();
    if (!fs) {
      const p = document.createElement("div");
      p.className = "all-settings-note";
      p.textContent = t.noProject;
      this.project.replaceChildren(p);
      return;
    }
    let resolved: Awaited<ReturnType<typeof loadScriptConfig>>["config"] | null = null;
    try {
      const text = await readTextIfExists(fs, SCRIPT_CONFIG_FILE);
      this.loaded = { text, settings: ScriptConfigJson.parse(text).settings };
      resolved = (await loadScriptConfig(fs)).config;
    } catch (e) {
      this.message = t.loadFailed(e instanceof Error ? e.message : String(e));
      const p = document.createElement("div");
      p.className = "all-settings-error";
      p.textContent = this.message;
      this.project.replaceChildren(p);
      return;
    }
    const rows: HTMLElement[] = [];
    for (const key of PROJECT_KEYS) {
      const row = document.createElement("label");
      row.className = "all-settings-row";
      const input = document.createElement("input");
      input.dataset["autoId"] = `allSettings.project.${key}`;
      const value = this.loaded.settings[key];
      if (key === "useGlobal") {
        input.type = "checkbox";
        input.checked = (value as boolean | undefined) ?? resolved.useGlobal;
        row.append(input, t[key]);
      } else {
        input.type = key === "lineMaxChars" || key === "linesPerPage" ? "number" : "text";
        input.value = value === undefined || value === null ? "" : String(value);
        input.placeholder = t.defaultValue(String(resolved[key]));
        const name = document.createElement("span");
        name.textContent = t[key];
        row.append(name, input);
      }
      this.fields.set(key, input);
      rows.push(row);
    }
    const save = dialogButton(t.save, () => void this.saveProject());
    save.dataset["autoId"] = "allSettings.project.save";
    rows.push(save);
    this.project.replaceChildren(...rows);
  }

  /** プロジェクトの設定を zigzagumap.json に書く（ほかの項目と節は残す。空の欄は既定に戻す）。 */
  async saveProject(): Promise<boolean> {
    const fs = this.host.projectFs();
    if (!fs || !this.loaded) return false;
    const next: ScriptConfigSettings = { ...this.loaded.settings };
    try {
      for (const key of PROJECT_KEYS) {
        const input = this.fields.get(key)!;
        if (key === "useGlobal") {
          next.useGlobal = input.checked;
          continue;
        }
        const raw = input.value.trim();
        if (raw === "") {
          delete next[key];
          continue;
        }
        if (key === "lineMaxChars" || key === "linesPerPage") {
          const n = Number(raw);
          if (!Number.isInteger(n) || n < 1) throw new Error(t.badNumber(t[key]));
          next[key] = n;
        } else next[key] = raw.replaceAll("\\", "/");
      }
      const previous = ScriptConfigJson.parse(this.loaded.text);
      const text = ScriptConfigJson.stringify(next, previous);
      ScriptConfigJson.parse(text);
      await fs.writeText(SCRIPT_CONFIG_FILE, text);
      this.loaded = { text, settings: next };
      this.host.reloadScriptConfig();
      this.message = t.saved;
      this.host.state.setStatus(t.saved);
      return true;
    } catch (e) {
      this.message = t.saveFailed(e instanceof Error ? e.message : String(e));
      this.host.state.setStatus(this.message, undefined, true);
      return false;
    }
  }
}
