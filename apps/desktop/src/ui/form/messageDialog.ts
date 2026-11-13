import { ja } from "../../i18n/ja";

/** 自動操作から見えるメッセージ（題名、本文、ボタン）。 */
export interface OpenMessage {
  readonly title: string;
  readonly text: string;
  readonly buttons: readonly string[];
  /** ボタンを押す（文字列で指定。無ければ Error）。 */
  press(button: string): void;
}

/** 開いているメッセージ（後に開いたものが末尾）。 */
export const openMessages: OpenMessage[] = [];

/**
 * Windows 標準のメッセージボックス（題名、本文、OK）の再現。画面内の HTML で出す
 * （ネイティブのダイアログは自動操作のときに画面を奪い、テストから押せないため）。
 * 閉じると解決する。
 */
export function showMessage(title: string, text: string): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    const box = document.createElement("div");
    box.className = "dialog message-dialog";
    box.setAttribute("role", "alertdialog");
    box.tabIndex = -1;
    const head = document.createElement("div");
    head.className = "dialog-title";
    head.textContent = title;
    const body = document.createElement("div");
    body.className = "dialog-body";
    const p = document.createElement("p");
    p.textContent = text;
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const ok = document.createElement("button");
    ok.textContent = ja.ok;
    ok.dataset["auto"] = "dialog.ok";
    buttons.append(ok);
    body.append(p, buttons);
    box.append(head, body);
    overlay.append(box);
    const previous = document.activeElement as HTMLElement | null;
    document.body.append(overlay);
    ok.focus();

    const entry: OpenMessage = {
      title,
      text,
      buttons: [ja.ok],
      press: (b) => {
        if (b !== ja.ok && b.toLowerCase() !== "ok") throw new Error(`ボタンがありません: ${b}`);
        finish();
      },
    };
    openMessages.push(entry);
    function finish(): void {
      overlay.remove();
      const i = openMessages.indexOf(entry);
      if (i >= 0) openMessages.splice(i, 1);
      previous?.focus?.();
      resolve();
    }
    ok.addEventListener("click", finish);
    box.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        finish();
      }
    });
  });
}
