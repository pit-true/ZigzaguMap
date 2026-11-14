import { isScriptLabelName } from "@zigzagumap/core";
import { jaRomScript as t } from "../../i18n/ja.romScript";
import { createDialog } from "../../ui/Dialog";
import type { ScriptRomOpenRequest } from "./protocol";

/**
 * 「.s に取り込む」の前に、付けるラベルの一覧を出して確かめる（#207）。名前は変えられる（前に取り込んだものは変えない）。
 * 「取り込む」で、変えた名前の組（自動で付けた名前 → 新しい名前）を返す。キャンセルなら null。
 */
export function openRomImportDialog(request: ScriptRomOpenRequest): Promise<Record<string, string> | null> {
  return new Promise((resolve) => {
    const frame = createDialog({ title: t.dialogTitle, width: 520, className: "rom-import-dialog", onClose: () => finish(null) });
    const note = document.createElement("p");
    note.className = "rom-import-note";
    note.textContent = t.dialogText;
    const table = document.createElement("div");
    table.className = "rom-import-list";
    const inputs: { from: string; input: HTMLInputElement }[] = [];
    request.items.forEach((item, i) => {
      const row = document.createElement("div");
      row.className = "rom-import-row";
      row.classList.toggle("reused", item.reused);
      const kind = document.createElement("span");
      kind.className = "rom-import-kind";
      kind.textContent = t.kindNames[item.kind] ?? item.kind;
      const at = document.createElement("span");
      at.className = "rom-import-at";
      at.textContent = `0x${item.pointer.toString(16).toUpperCase().padStart(8, "0")}`;
      const input = document.createElement("input");
      input.type = "text";
      input.value = item.label;
      input.disabled = item.reused;
      input.spellcheck = false;
      input.dataset["autoId"] = `romImport.label:${i}`;
      input.addEventListener("input", () => input.classList.toggle("invalid", !isScriptLabelName(input.value.trim())));
      inputs.push({ from: item.label, input });
      row.append(kind, at, input);
      table.append(row);
    });
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.textContent = t.importOk;
    ok.dataset["autoId"] = "romImport.ok";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.textContent = t.cancel;
    cancel.dataset["autoId"] = "romImport.cancel";
    buttons.append(ok, cancel);
    frame.body.append(note, table, buttons);

    const accept = (): void => {
      const rename: Record<string, string> = {};
      for (const { from, input } of inputs) {
        const to = input.value.trim();
        if (!isScriptLabelName(to)) {
          input.classList.add("invalid");
          input.focus();
          return;
        }
        if (to !== from) rename[from] = to;
      }
      finish(rename);
    };
    let done = false;
    function finish(value: Record<string, string> | null): void {
      if (done) return;
      done = true;
      frame.remove();
      resolve(value);
    }
    ok.addEventListener("click", accept);
    cancel.addEventListener("click", () => finish(null));
    frame.register({
      title: t.dialogTitle,
      text: t.dialogText,
      buttons: [t.importOk, t.cancel],
      press: (b) => (b === t.importOk ? accept() : b === t.cancel ? finish(null) : (() => { throw new Error(t.noButton(b)); })()),
    });
    inputs[0]?.input.focus();
  });
}
