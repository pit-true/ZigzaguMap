import { USER_SCRIPT_DIR, saveUserScriptEnabled } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import type { UserScriptHost } from "../../app/scripting/UserScriptHost";
import { keyText } from "../../app/keymap";
import { jaUserScript as t } from "../../i18n/ja.userScript";
import "../../styles/userScript.css";
import { createDialog, dialogButton, handleDialogKeys, pressable, type DialogFrame } from "../Dialog";

let current: UserScriptManager | null = null;

/** 開いている管理の窓（自動操作用）。 */
export function openUserScriptManager(): UserScriptManager | null {
  return current;
}

/**
 * 設定 > スクリプトの管理...（Phase5 #405）。置き場所の `.js` の一覧と有効・無効（チェック）、読み直し、止める、
 * スクリプトが登録した操作の実行、ログ。チェックを変えると `zigzagumap.json` に書いて読み直す。
 */
export class UserScriptManager {
  private readonly frame: DialogFrame;
  private readonly body: HTMLElement;
  private readonly onChange = () => this.render();

  constructor(
    private readonly state: EditorState,
    private readonly host: UserScriptHost,
  ) {
    current?.close();
    current = this;
    this.frame = createDialog({ title: t.title, className: "user-script-dialog", onClose: () => this.close() });
    this.body = document.createElement("div");
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const reload = dialogButton(t.reload, () => void host.reload());
    reload.dataset["autoId"] = "userScripts.reload";
    const stop = dialogButton(t.stop, () => host.stop());
    stop.dataset["autoId"] = "userScripts.stop";
    buttons.append(reload, stop, dialogButton(t.close, () => this.close()));
    this.frame.body.append(this.body, buttons);
    handleDialogKeys(this.frame, () => this.close());
    this.frame.register({
      title: t.title,
      text: "",
      ...pressable([
        { label: t.reload, run: () => void host.reload() },
        { label: t.stop, run: () => host.stop() },
        { label: t.close, aliases: ["close", "cancel"], run: () => this.close() },
      ]),
    });
    host.listeners.add(this.onChange);
    this.render();
  }

  close(): void {
    this.host.listeners.delete(this.onChange);
    this.frame.remove();
    if (current === this) current = null;
  }

  /** 有効・無効を変える（`zigzagumap.json` に書いて読み直す）。 */
  async setEnabled(name: string, on: boolean): Promise<void> {
    const fs = this.state.session?.projectFs();
    if (!fs) return;
    const now = this.host.listing.enabled.filter((n) => n !== name);
    const files = this.host.listing.files;
    const enabled = on ? files.filter((f) => f === name || now.includes(f)) : now;
    await saveUserScriptEnabled(fs, enabled);
    await this.host.reload();
  }

  private render(): void {
    const host = this.host;
    const nodes: HTMLElement[] = [];
    const p = (text: string, className = ""): HTMLElement => {
      const el = document.createElement("div");
      el.className = className;
      el.textContent = text;
      return el;
    };
    if (!this.state.session?.projectDir) {
      nodes.push(p(t.noProject, "user-script-note"));
    } else {
      nodes.push(p(t.folder(USER_SCRIPT_DIR), "user-script-note"), p(t.state(host.active), "user-script-state"));
      const list = document.createElement("div");
      list.className = "user-script-list";
      if (host.listing.files.length === 0) list.append(p(t.noFiles, "user-script-note"));
      for (const name of host.listing.files) {
        const label = document.createElement("label");
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = host.listing.enabled.includes(name);
        box.dataset["autoId"] = `userScripts.enable.${name}`;
        box.addEventListener("change", () => void this.setEnabled(name, box.checked));
        const error = host.loadErrors.get(name);
        label.append(box, name + (error ? `（${error}）` : ""));
        if (error) label.classList.add("error");
        list.append(label);
      }
      nodes.push(list, p(t.actions, "user-script-heading"));
      const actions = document.createElement("div");
      actions.className = "user-script-actions";
      if (host.actions.length === 0) actions.append(p(t.noActions, "user-script-note"));
      for (const [i, a] of host.actions.entries()) {
        const b = dialogButton(`${t.run}: ${a.label}・${t.slot(i + 1, keyText(`scripts.run.${i + 1}`))}`, () => host.runAction(a.id));
        b.dataset["autoId"] = `userScripts.action.${a.id}`;
        actions.append(b);
      }
      nodes.push(actions, p(t.log, "user-script-heading"));
      const log = document.createElement("pre");
      log.className = "user-script-log";
      log.dataset["autoId"] = "userScripts.log";
      log.textContent = host.logs.slice(-50).map((l) => (l.level === "log" ? l.text : `[${l.level}] ${l.text}`)).join("\n");
      nodes.push(log);
    }
    this.body.replaceChildren(...nodes);
  }
}
