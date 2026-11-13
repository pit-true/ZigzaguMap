import { ja } from "../i18n/ja";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "./Dialog";

/**
 * AdvanceMap の入力ダイアログ（InputQuery: 題名、本文、入力欄、OK と Cancel）の再現。
 * 画面内の HTML で出す。OK なら入力した文字列、Cancel・Esc・× なら null。
 */
export function inputDialog(title: string, prompt: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const finish = (value: string | null): void => {
      frame.remove();
      resolve(value);
    };
    const frame = createDialog({ title, width: 276, className: "input-dialog", onClose: () => finish(null) });
    const text = document.createElement("p");
    text.textContent = prompt;
    const input = document.createElement("input");
    input.type = "text";
    input.value = initial;
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    buttons.append(
      dialogButton(ja.ok, () => finish(input.value)),
      dialogButton(ja.cancel, () => finish(null)),
    );
    frame.body.append(text, input, buttons);
    handleDialogKeys(frame, () => finish(null), (e) => {
      if (e.key === "Enter") finish(input.value);
    });
    frame.register({
      title,
      text: prompt,
      ...pressable([
        { label: ja.ok, run: () => finish(input.value) },
        { label: ja.cancel, run: () => finish(null) },
      ]),
      setInput: (v) => {
        input.value = v;
      },
      input: () => input.value,
    });
    input.focus();
    input.select();
  });
}
