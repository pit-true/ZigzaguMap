import { ja } from "../i18n/ja";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "./Dialog";

/** メッセージの種類（左のアイコン）。 */
export type MessageIcon = "error" | "info" | "question" | "warning";

/** ボタンの組。 */
export type MessageButtons = "ok" | "yesNo" | "yesNoCancel";

/** 押したボタン（× は cancel、yesNo の × は no）。 */
export type MessageResult = "ok" | "yes" | "no" | "cancel";

const ICON_TEXT: Readonly<Record<MessageIcon, string>> = { error: "✕", info: "i", question: "?", warning: "!" };

/**
 * Windows 標準のメッセージボックス（題名、アイコン、本文、ボタン）の再現。画面内の HTML で出す。
 * AdvanceMap と同じく、ボタンは「OK」「はい(Y)」「いいえ(N)」「キャンセル」。
 */
export function messageBox(title: string, text: string, icon: MessageIcon = "info", buttons: MessageButtons = "ok"): Promise<MessageResult> {
  return new Promise((resolve) => {
    const defs: [string, MessageResult][] =
      buttons === "ok"
        ? [[ja.ok, "ok"]]
        : buttons === "yesNo"
          ? [
              [ja.yes, "yes"],
              [ja.no, "no"],
            ]
          : [
              [ja.yes, "yes"],
              [ja.no, "no"],
              [ja.cancelJa, "cancel"],
            ];
    const closeResult: MessageResult = buttons === "ok" ? "ok" : buttons === "yesNo" ? "no" : "cancel";
    const finish = (r: MessageResult): void => {
      frame.remove();
      resolve(r);
    };
    const frame = createDialog({ title, className: "message-box", onClose: () => finish(closeResult) });
    const row = document.createElement("div");
    row.className = "message-row";
    const mark = document.createElement("span");
    mark.className = `message-icon ${icon}`;
    mark.textContent = ICON_TEXT[icon];
    const p = document.createElement("p");
    p.className = "message-text";
    p.textContent = text;
    row.append(mark, p);
    const bar = document.createElement("div");
    bar.className = "message-buttons";
    const elements = defs.map(([label, result]) => dialogButton(label, () => finish(result)));
    bar.append(...elements);
    frame.body.append(row, bar);
    frame.box.tabIndex = -1;
    handleDialogKeys(frame, () => finish(closeResult), (e) => {
      if (buttons !== "ok" && e.key.toLowerCase() === "y") finish("yes");
      else if (buttons !== "ok" && e.key.toLowerCase() === "n") finish("no");
    });
    frame.register({ title, text, ...pressable(defs.map(([label, result]) => ({ label, aliases: [result], run: () => finish(result) }))) });
    elements[0]?.focus();
  });
}

/** エラー（題名「エラー」、OK）。 */
export function showError(text: string, title: string = ja.errorTitle): Promise<MessageResult> {
  return messageBox(title, text, "error");
}

/** 情報（題名「情報」、OK）。 */
export function showInfo(text: string, title: string = ja.information): Promise<MessageResult> {
  return messageBox(title, text, "info");
}

/** はい／いいえの質問。はいなら true。 */
export async function askYesNo(text: string, title: string = ja.question): Promise<boolean> {
  return (await messageBox(title, text, "question", "yesNo")) === "yes";
}
