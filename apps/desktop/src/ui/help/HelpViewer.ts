import { ja } from "../../i18n/ja";
import "../../styles/help.css";
import { openExternal } from "../../util/externalLinks";
import { createDialog, dialogButton, handleDialogKeys, type DialogFrame } from "../Dialog";
import { escapeHtml, renderMarkdown } from "./markdown";

/** ヘルプの中で開ける文書（パスはリポジトリの根から）。本文はこのモジュールを読み込んだときに一緒に読む。 */
export type DocSource = Readonly<Record<string, string>>;

/** 1 つの画面（文書と、その中の位置）。 */
interface Page {
  readonly path: string;
  readonly anchor: string | null;
}

/**
 * ヘルプの文書の窓（Read me・ショートカット一覧）。Markdown を HTML にして出す（`markdown.ts`。本文の HTML は文字として出すので、
 * スクリプトは動かない）。リンクは、見出しへのリンクならその位置へ、docs/ などの文書ならこの窓の中で開き、
 * http・https なら既定のブラウザで開く。「戻る」で前の文書・位置へ戻る。後ろの画面も操作できる。
 */
export class HelpViewer {
  private frame: DialogFrame | null = null;
  private content: HTMLElement | null = null;
  private label: HTMLElement | null = null;
  private backButton: HTMLButtonElement | null = null;
  private history: Page[] = [];
  private current: Page | null = null;

  constructor(private readonly docs: DocSource) {}

  /** 文書を開く（開いていれば同じ窓で切り替える）。 */
  open(path: string, anchor: string | null = null): void {
    if (!this.frame) this.build();
    if (this.current) this.history.push(this.current);
    this.show({ path, anchor });
  }

  /** 閉じる。 */
  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.content = null;
    this.label = null;
    this.backButton = null;
    this.history = [];
    this.current = null;
  }

  /** 前の画面へ戻る。 */
  back(): void {
    const page = this.history.pop();
    if (page) this.show(page);
  }

  private build(): void {
    const frame = createDialog({ title: ja.readMe, modal: false, className: "help-viewer", onClose: () => this.close() });
    frame.box.style.left = "80px";
    frame.box.style.top = "60px";
    const bar = document.createElement("div");
    bar.className = "help-viewer-bar";
    const back = dialogButton(ja.helpViewer.back, () => this.back());
    back.dataset["autoId"] = "help.back";
    const label = document.createElement("span");
    label.className = "help-viewer-doc";
    label.dataset["autoId"] = "help.doc";
    bar.append(back, label);
    const content = document.createElement("div");
    content.className = "help-viewer-content md-body";
    content.dataset["autoId"] = "help.content";
    content.tabIndex = 0;
    content.addEventListener("click", (e) => this.onClick(e));
    const buttons = document.createElement("div");
    buttons.className = "help-buttons";
    const close = dialogButton(ja.helpViewer.close, () => this.close());
    close.dataset["autoId"] = "help.close";
    buttons.append(close);
    frame.body.append(bar, content, buttons);
    handleDialogKeys(frame, () => this.close());
    frame.register({ title: ja.readMe, text: "", buttons: [ja.helpViewer.close], press: () => this.close() });
    this.frame = frame;
    this.content = content;
    this.label = label;
    this.backButton = back;
    content.focus();
  }

  private show(page: Page): void {
    const content = this.content;
    if (!content || !this.label || !this.backButton) return;
    const text = this.docs[page.path];
    if (this.current?.path !== page.path) {
      // 窓の題名は、README なら「Read me」、ほかの文書は最初の見出し（無ければパス）
      let title = page.path === "README.md" ? ja.readMe : page.path;
      if (text === undefined) content.innerHTML = `<p>${escapeHtml(ja.helpViewer.unknownDoc(page.path))}</p>`;
      else if (/\.md$/i.test(page.path)) {
        const rendered = renderMarkdown(text, page.path);
        content.innerHTML = rendered.html;
        if (page.path !== "README.md") title = rendered.headings[0]?.text ?? title;
      } else content.innerHTML = `<pre class="md-code">${escapeHtml(text)}</pre>`;
      const titleText = this.frame?.titleBar.querySelector("span");
      if (titleText) titleText.textContent = title;
      // 自動操作から押せるよう、リンクに行き先の ID を付ける
      for (const a of content.querySelectorAll<HTMLElement>("a[data-link]")) a.dataset["autoId"] = `help.link:${a.dataset["link"]}`;
    }
    this.current = page;
    this.label.textContent = page.path;
    this.backButton.disabled = this.history.length === 0;
    const target = page.anchor ? content.querySelector<HTMLElement>(`#${CSS.escape(page.anchor)}`) : null;
    // 本文の枠は position: relative なので、見出しの offsetTop は枠の中の位置
    content.scrollTop = target ? target.offsetTop : 0;
  }

  private onClick(e: MouseEvent): void {
    const a = (e.target as HTMLElement).closest<HTMLElement>("a[data-link]");
    if (!a) return;
    e.preventDefault();
    const link = a.dataset["link"] ?? "";
    if (/^https?:\/\//i.test(link)) {
      void openExternal(link);
      return;
    }
    const hash = link.indexOf("#");
    const path = hash === 0 ? (this.current?.path ?? "README.md") : hash > 0 ? link.slice(0, hash) : link;
    const anchor = hash >= 0 ? link.slice(hash + 1) : null;
    this.open(path, anchor);
  }
}
