import { listDialogs, operateDialog } from "../../../app/automation/dialogs";
import { settle, str } from "../../../app/automation/registry";
import { click, findField, getField, listFields, setField } from "../../../app/automation/ui";
import { describe, type EditorCommandTable } from "./common";

/** 部品とダイアログ（`dialogs` / `getField` / `setField` / `click` / `ui.list` / `dialog`。メインと同じ名前・同じ引数）。 */
export const uiCommands: EditorCommandTable = {
  dialogs: () => ({ dialogs: listDialogs() }),
  getField: (_w, req) => getField(str(req, "id")),
  setField: async (_w, req) => {
    const r = setField(str(req, "id"), req["value"]);
    await settle();
    return { ...r, dialogs: listDialogs() };
  },
  click: async (w, req) => {
    click(str(req, "id"));
    await settle(200);
    return { dialogs: listDialogs(), ...describe(w) };
  },
  "ui.list": (_w, req) => listFields(typeof req["root"] === "string" ? findField(req["root"]) : document),
  dialog: async (_w, req) => {
    const result = await operateDialog(req);
    await settle(200);
    return result;
  },
};
