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
 * http・https なら既定のブラウザで開く。後ろの画面も操作できる。
 *
 * 「戻る」ボタンと文書の名前の表示は置かない（#219）。メニューから開いた文書（Read me かショートカット一覧。「元の文書」）から
 * リンクで別の文書へ移ったときは、本文の先頭に「← 元の文書に戻る」のリンクを出し、押すと元の文書の、離れたときの位置へ戻る。
 */
export class HelpViewer {
  private frame: DialogFrame | null = null;
  private content: HTMLElement | null = null;
  /** 開いている文書のパス（画面には出さない。自動操作の `help.doc` で読む）。 */
  private label: HTMLElement | null = null;
  /** メニューから開いた文書（元の文書）と、そこを離れたときの本文の位置。 */
  private home: string | null = null;
  private homeScroll = 0;
  private current: Page | null = null;

  constructor(private readonly docs: DocSource) {}

  /** メニューから文書を開く（開いていれば同じ窓で切り替える）。この文書が元の文書になる。 */
  open(path: string, anchor: string | null = null): void {
    if (!this.frame) this.build();
    this.home = path;
    this.homeScroll = 0;
    this.show({ path, anchor });
  }

  /** 閉じる。 */
  close(): void {
    this.frame?.remove();
    this.frame = null;
    this.content = null;
    this.label = null;
    this.home = null;
    this.current = null;
  }

  /** 本文のリンクで移る。元の文書を離れるときは、その位置を覚えておく。 */
  private navigate(path: string, anchor: string | null): void {
    if (this.current && this.current.path === this.home && path !== this.home) this.homeScroll = this.content?.scrollTop ?? 0;
    this.show({ path, anchor });
  }

  /** 元の文書の、離れたときの位置へ戻る（本文の先頭の「← … に戻る」）。 */
  private returnHome(): void {
    if (!this.home) return;
    const scroll = this.homeScroll;
    this.show({ path: this.home, anchor: null });
    if (this.content) this.content.scrollTop = scroll;
  }

  private build(): void {
    const frame = createDialog({ title: ja.readMe, modal: false, className: "help-viewer", onClose: () => this.close() });
    frame.box.style.left = "80px";
    frame.box.style.top = "60px";
    const label = document.createElement("span");
    label.hidden = true;
    label.dataset["autoId"] = "help.doc";
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
    frame.body.append(label, content, buttons);
    handleDialogKeys(frame, () => this.close());
    frame.register({ title: ja.readMe, text: "", buttons: [ja.helpViewer.close], press: () => this.close() });
    this.frame = frame;
    this.content = content;
    this.label = label;
    content.focus();
  }

  /** 文書の題名（README なら「Read me」、ショートカット一覧などほかの文書は最初の見出し、無ければパス）。 */
  private titleOf(path: string): string {
    if (path === "README.md") return ja.readMe;
    const text = this.docs[path];
    if (text === undefined || !/\.md$/i.test(path)) return path;
    return renderMarkdown(text, path).headings[0]?.text ?? path;
  }

  private show(page: Page): void {
    const content = this.content;
    if (!content || !this.label) return;
    const text = this.docs[page.path];
    if (this.current?.path !== page.path) {
      if (text === undefined) content.innerHTML = `<p>${escapeHtml(ja.helpViewer.unknownDoc(page.path))}</p>`;
      else if (/\.md$/i.test(page.path)) content.innerHTML = renderMarkdown(text, page.path).html;
      else content.innerHTML = `<pre class="md-code">${escapeHtml(text)}</pre>`;
      if (this.home && page.path !== this.home) content.prepend(this.homeLink(this.home));
      const titleText = this.frame?.titleBar.querySelector("span");
      if (titleText) titleText.textContent = this.titleOf(page.path);
      // 自動操作から押せるよう、リンクに行き先の ID を付ける
      for (const a of content.querySelectorAll<HTMLElement>("a[data-link]")) a.dataset["autoId"] = `help.link:${a.dataset["link"]}`;
    }
    this.current = page;
    this.label.textContent = page.path;
    const target = page.anchor ? content.querySelector<HTMLElement>(`#${CSS.escape(page.anchor)}`) : null;
    // 本文の枠は position: relative なので、見出しの offsetTop は枠の中の位置
    content.scrollTop = target ? target.offsetTop : 0;
  }

  /** 本文の先頭に置く「← 元の文書に戻る」。 */
  private homeLink(home: string): HTMLElement {
    const p = document.createElement("p");
    p.className = "help-home";
    const a = document.createElement("a");
    a.href = "#";
    a.textContent = ja.helpViewer.returnTo(this.titleOf(home));
    a.dataset["autoId"] = "help.home";
    a.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.returnHome();
    });
    p.append(a);
    return p;
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
    this.navigate(path, anchor);
  }
}
