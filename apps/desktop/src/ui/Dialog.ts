/**
 * 画面内に出すダイアログの土台（題名の帯と × ボタン、中身、モーダルなら後ろを覆う）。
 * Windows のネイティブのダイアログを使わないのは、自動操作のときに画面を奪わず、テストから押せるようにするため。
 * 開いているダイアログは `openDialogs` に積まれ、自動操作の `dialog` 命令から読んで押せる。
 */

/** 自動操作から見えるダイアログ。 */
export interface DialogHandle {
  readonly title: string;
  /** 本文（入力ダイアログなら説明の文）。 */
  readonly text: string;
  /** 押せるボタンの文字列。 */
  readonly buttons: readonly string[];
  /** ボタンを押す（文字列で指定。無ければ Error）。 */
  press(button: string): void;
  /** 入力欄があれば値を入れる。 */
  setInput?(value: string): void;
  /** 入力欄の値。 */
  input?(): string;
  /** 閉じる（× と同じ）。 */
  close(): void;
  readonly element: HTMLElement;
}

/** 開いているダイアログ（後に開いたものが末尾）。 */
export const openDialogs: DialogHandle[] = [];

/** ダイアログの作り方。 */
export interface DialogOptions {
  readonly title: string;
  /** 外枠の幅（px）。 */
  readonly width?: number;
  readonly className?: string;
  /** 後ろを覆って操作できなくする（既定 true）。 */
  readonly modal?: boolean;
  /** × を押したとき。 */
  readonly onClose: () => void;
}

/** 作ったダイアログの部品。 */
export interface DialogFrame {
  readonly root: HTMLElement;
  readonly box: HTMLElement;
  readonly titleBar: HTMLElement;
  readonly body: HTMLElement;
  /** 取り除く（openDialogs からも外す）。 */
  remove(): void;
  /** 自動操作に見せる。 */
  register(handle: Omit<DialogHandle, "element" | "close">): void;
}

/** ダイアログの枠を作って画面に出す。 */
export function createDialog(options: DialogOptions): DialogFrame {
  const modal = options.modal ?? true;
  const box = document.createElement("div");
  box.className = `dialog ${options.className ?? ""}`.trim();
  box.setAttribute("role", "dialog");
  if (options.width) box.style.width = `${options.width}px`;
  const titleBar = document.createElement("div");
  titleBar.className = "dialog-title";
  const titleText = document.createElement("span");
  titleText.textContent = options.title;
  const close = document.createElement("button");
  close.className = "dialog-close";
  close.type = "button";
  close.textContent = "✕";
  close.tabIndex = -1;
  close.addEventListener("click", () => options.onClose());
  titleBar.append(titleText, close);
  const body = document.createElement("div");
  body.className = "dialog-body";
  box.append(titleBar, body);

  let root: HTMLElement = box;
  if (modal) {
    root = document.createElement("div");
    root.className = "dialog-overlay";
    root.append(box);
  } else {
    box.classList.add("floating");
  }
  document.body.append(root);
  makeDraggable(box, titleBar, modal);

  let handle: DialogHandle | null = null;
  return {
    root,
    box,
    titleBar,
    body,
    remove() {
      root.remove();
      if (handle) {
        const i = openDialogs.indexOf(handle);
        if (i >= 0) openDialogs.splice(i, 1);
      }
    },
    register(h) {
      handle = { ...h, element: box, close: options.onClose };
      openDialogs.push(handle);
    },
  };
}

/** 自動操作から押せるボタン 1 つ（`label` か `aliases` の文字列で押す）。 */
export interface PressableButton {
  readonly label: string;
  readonly aliases?: readonly string[];
  readonly run: () => void;
}

/**
 * ボタンの表から、`DialogFrame.register` に渡す `buttons` と `press` を作る。
 * 表に無い文字列を押そうとしたら Error（どのダイアログでも同じ文言）。
 */
export function pressable(defs: readonly PressableButton[]): { buttons: string[]; press: (button: string) => void } {
  return {
    buttons: defs.map((d) => d.label),
    press: (button) => {
      const def = defs.find((d) => d.label === button || d.aliases?.includes(button));
      if (!def) throw new Error(`ボタンがありません: ${button}`);
      def.run();
    },
  };
}

/**
 * ダイアログの中のキー操作を受ける（メインのショートカットへ届かないよう止めてから `handler` を呼ぶ）。
 * Esc で `onEscape` を呼ぶ。ほかのキーは `handler` へ渡す。
 */
export function handleDialogKeys(frame: DialogFrame, onEscape: (() => void) | null, handler?: (e: KeyboardEvent) => void): void {
  frame.box.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape" && onEscape) onEscape();
    else handler?.(e);
  });
}

/** ボタンを作る。 */
export function dialogButton(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = text;
  b.addEventListener("click", onClick);
  return b;
}

/** 題名の帯をつかんで動かせるようにする。 */
function makeDraggable(box: HTMLElement, bar: HTMLElement, centered: boolean): void {
  bar.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    const rect = box.getBoundingClientRect();
    const dx = e.clientX - rect.left;
    const dy = e.clientY - rect.top;
    bar.setPointerCapture(e.pointerId);
    const move = (m: PointerEvent): void => {
      if (centered) box.style.position = "fixed";
      box.style.right = "";
      box.style.bottom = "";
      box.style.left = `${Math.max(0, m.clientX - dx)}px`;
      box.style.top = `${Math.max(0, m.clientY - dy)}px`;
    };
    const up = (): void => {
      bar.removeEventListener("pointermove", move);
      bar.removeEventListener("pointerup", up);
    };
    bar.addEventListener("pointermove", move);
    bar.addEventListener("pointerup", up);
  });
}
