import { ja } from "../i18n/ja";
import { createDialog, dialogButton, dialogButtonRow, handleDialogKeys, pressable } from "./Dialog";

/**
 * 一覧から 1 つ選ぶダイアログ（#540 ベース ROM の候補が複数あるとき）。OK なら選んだ番号、Cancel・Esc・× なら null。
 * 自動操作では `setInput` に番号か項目の文字列を入れてから OK を押す。
 */
export function choiceDialog(title: string, prompt: string, items: readonly string[]): Promise<number | null> {
  return new Promise((resolve) => {
    const finish = (value: number | null): void => {
      frame.remove();
      resolve(value);
    };
    const frame = createDialog({ title, width: 520, className: "choice-dialog", onClose: () => finish(null) });
    const text = document.createElement("p");
    text.textContent = prompt;
    const list = document.createElement("select");
    list.size = Math.min(Math.max(items.length, 2), 10);
    list.style.width = "100%";
    for (const item of items) list.append(new Option(item, item));
    list.selectedIndex = 0;
    const ok = (): void => finish(list.selectedIndex >= 0 ? list.selectedIndex : null);
    list.addEventListener("dblclick", ok);
    const buttons = dialogButtonRow(dialogButton(ja.ok, ok), dialogButton(ja.cancel, () => finish(null)));
    frame.body.append(text, list, buttons);
    handleDialogKeys(frame, () => finish(null), (e) => {
      if (e.key === "Enter") ok();
    });
    frame.register({
      title,
      text: prompt,
      ...pressable([
        { label: ja.ok, aliases: ["ok"], run: ok },
        { label: ja.cancel, aliases: ["cancel"], run: () => finish(null) },
      ]),
      setInput: (v) => {
        const i = /^\d+$/.test(v) ? Number(v) : items.indexOf(v);
        if (i < 0 || i >= items.length) throw new Error(`選べる項目にありません: ${v}`);
        list.selectedIndex = i;
      },
      input: () => items[list.selectedIndex] ?? "",
    });
    list.focus();
  });
}
