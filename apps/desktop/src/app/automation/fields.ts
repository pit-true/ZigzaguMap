import { click, describeElement, findField, getField, leave, listFields, setField } from "./ui";
import { settle, str, type CommandTable } from "./registry";
import { listDialogs } from "./dialogs";

/**
 * 入力欄・コンボ・チェック・ボタン（`getField` / `setField` / `click` / `ui.list` / `ui.type`）。
 * `id` はアプリ独自の ID（`data-auto-id`）か、AdvanceMap の部品名（`field:Txt_PosX`）。
 * `setField` と `click` の返事には、そのあと開いているダイアログ（入力エラーなど）も入れる。
 */
export const fieldCommands: CommandTable = {
  getField: (_app, req) => getField(str(req, "id")),
  setField: async (_app, req) => {
    const r = setField(str(req, "id"), req["value"]);
    await settle();
    return { ...r, dialogs: listDialogs() };
  },
  click: async (_app, req) => {
    click(str(req, "id"));
    await settle();
    return { dialogs: listDialogs() };
  },
  "ui.list": (_app, req) => listFields(typeof req["root"] === "string" ? findField(req["root"]) : document),
  "ui.type": (_app, req) => {
    // 1 文字ずつ入力する（入力のたびに反映される動きの確認用）。
    const el = findField(str(req, "id"));
    if (!(el instanceof HTMLInputElement)) throw new Error("文字を入力できる部品ではありません");
    el.focus();
    if (req["clear"] !== false) {
      el.value = "";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    for (const ch of str(req, "text")) {
      el.value += ch;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (req["blur"] !== false) leave(el);
    return describeElement(el);
  },
};
