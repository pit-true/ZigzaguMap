import { FileDialogs, type FileDialogRequest } from "../FileDialogs";
import { openDialogs, type DialogHandle } from "../../ui/Dialog";
import { optStr, settle, type AutomationRequest, type CommandTable } from "./registry";

/**
 * 開いているダイアログ（`dialogs` / `dialog` / `queuePath`）。メインと別ウィンドウで共通。
 *
 * - アプリ内のダイアログ（メッセージ・入力・ヘルプ・コネクションマネージャーなど。`openDialogs`）と、
 *   Windows 標準のファイル・フォルダを選ぶダイアログの両方を、開いた順に並べる。
 * - 自動操作のときは Windows のダイアログは出さない。積んだパス（`queuePath`）が無ければ、代わりのダイアログ（`kind: "native"`）を
 *   一覧に出して答えを待つ。`dialog {input, press}` で入力して押すか、`queuePath {path}` で答える（どちらも同じ）。
 */

/** 自動操作の代わりのファイル・フォルダのダイアログ。 */
interface NativeDialog {
  readonly order: number;
  readonly request: FileDialogRequest;
  input: string;
  resolve(path: string | null): void;
}

const natives: NativeDialog[] = [];
let order = 0;
/** アプリ内のダイアログを開いた順（初めて見たときの番号）。 */
const seen = new WeakMap<DialogHandle, number>();

/** Windows のファイル・フォルダのダイアログを、代わりのダイアログにする（自動操作の入口を始めるときに呼ぶ）。 */
export function installNativeDialogs(): void {
  FileDialogs.substitute = (request) =>
    new Promise((resolve) => {
      const d: NativeDialog = {
        order: ++order,
        request,
        input: request.fileName ?? "",
        resolve: (path) => {
          const i = natives.indexOf(d);
          if (i >= 0) natives.splice(i, 1);
          resolve(path);
        },
      };
      natives.push(d);
    });
}

const NATIVE_OK: Readonly<Record<FileDialogRequest["type"], string>> = { open: "開く", rom: "開く", save: "保存", folder: "フォルダーの選択" };

function orderOf(d: DialogHandle): number {
  let n = seen.get(d);
  if (n === undefined) seen.set(d, (n = ++order));
  return n;
}

type Entry = { order: number; app: DialogHandle; native?: undefined } | { order: number; native: NativeDialog; app?: undefined };

function entries(): Entry[] {
  const list: Entry[] = [...openDialogs.map((d) => ({ order: orderOf(d), app: d })), ...natives.map((n) => ({ order: n.order, native: n }))];
  return list.sort((a, b) => a.order - b.order);
}

function describe(e: Entry): Record<string, unknown> {
  if (e.app) {
    const d = e.app;
    return { kind: "app", title: d.title, text: d.text, buttons: d.buttons, input: d.input?.() ?? null, modal: d.element.closest(".dialog-overlay") !== null };
  }
  const r = e.native.request;
  return {
    kind: "native",
    type: r.type,
    title: r.title,
    text: "",
    buttons: [NATIVE_OK[r.type], "キャンセル"],
    input: e.native.input,
    filters: r.filters,
    directory: r.directory,
  };
}

/** 開いているダイアログの一覧（開いた順。最後が手前）。 */
export function listDialogs(): Record<string, unknown>[] {
  return entries().map(describe);
}

/** `dialog`: 手前のダイアログ（`title` を渡すとその題名のもの）に入力して、ボタンを押す。 */
export async function operateDialog(req: AutomationRequest): Promise<unknown> {
  const press = optStr(req, "press") ?? optStr(req, "button");
  const input = optStr(req, "input");
  const title = optStr(req, "title");
  const all = entries();
  const target = title === null ? all[all.length - 1] : [...all].reverse().find((e) => (e.app?.title ?? e.native?.request.title) === title);
  if (!target) {
    if (press !== null || input !== null) throw new Error(title === null ? "ダイアログが開いていません" : `題名 ${title} のダイアログがありません`);
    return { dialogs: [] };
  }
  const before = listDialogs();
  if (target.app) {
    if (input !== null) {
      if (!target.app.setInput) throw new Error("入力欄がありません");
      target.app.setInput(input);
    }
    if (press !== null) {
      if (press === "close") target.app.close();
      else target.app.press(press);
    }
  } else {
    const n = target.native;
    if (input !== null) n.input = input;
    if (press !== null) {
      const ok = press === "ok" || press === "open" || press === "save" || press === NATIVE_OK[n.request.type];
      const cancel = press === "cancel" || press === "close" || press === "キャンセル";
      if (!ok && !cancel) throw new Error(`ボタンがありません: ${press}`);
      n.resolve(ok ? n.input : null);
    }
  }
  if (press === null) return { dialogs: listDialogs() };
  await settle();
  return { pressed: press, before, dialogs: listDialogs() };
}

/** `queuePath`: 開いている代わりのダイアログがあればそれに答え、無ければ次のダイアログの答えとして積む。 */
export function queuePath(files: FileDialogs, path: string | null): { answered: boolean } {
  const pending = natives[0];
  if (pending) {
    pending.resolve(path);
    return { answered: true };
  }
  files.queue(path);
  return { answered: false };
}

export const dialogCommands: CommandTable = {
  dialogs: () => ({ dialogs: listDialogs() }),
  dialog: (_app, req) => operateDialog(req),
  queuePath: async (app, req) => {
    const r = queuePath(app.files, typeof req["path"] === "string" ? req["path"] : null);
    await settle();
    return r;
  },
};
