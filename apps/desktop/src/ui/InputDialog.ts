import { ja } from "../i18n/ja";

/**
 * AdvanceMap の入力ダイアログ（InputQuery: 題名、本文、入力欄、OK と Cancel）の再現。
 * 画面内の HTML で出す。OK なら入力した文字列、Cancel・Esc なら null。
 */
export function inputDialog(title: string, prompt: string, initial: string): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    const box = document.createElement("div");
    box.className = "dialog";
    box.setAttribute("role", "dialog");
    const head = document.createElement("div");
    head.className = "dialog-title";
    head.textContent = title;
    const body = document.createElement("div");
    body.className = "dialog-body";
    const text = document.createElement("p");
    text.textContent = prompt;
    const input = document.createElement("input");
    input.type = "text";
    input.value = initial;
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const ok = document.createElement("button");
    ok.textContent = ja.ok;
    const cancel = document.createElement("button");
    cancel.textContent = ja.cancel;
    buttons.append(ok, cancel);
    body.append(text, input, buttons);
    box.append(head, body);
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
    input.select();

    const finish = (value: string | null): void => {
      overlay.remove();
      resolve(value);
    };
    ok.addEventListener("click", () => finish(input.value));
    cancel.addEventListener("click", () => finish(null));
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter") finish(input.value);
      else if (e.key === "Escape") finish(null);
    });
  });
}
