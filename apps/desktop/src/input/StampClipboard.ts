import type { BlockSelection, EditorState } from "../app/EditorState";
import { jaPaint } from "../i18n/ja.paint";
import { openDialogs } from "../ui/Dialog";
import type { BlockPainter } from "./BlockPainter";

/**
 * マップタブのコピーと貼り付け（Phase3 #225。AdvanceMap には無い）。
 * - Ctrl+C: 今の選択（マップから拾った複数選択なら移動許可も）をアプリの中のクリップボードに写す。
 * - Ctrl+V: 写したものを、マウスが乗っているマス（無ければ左上）を左上にして貼る（1 回の操作）。
 * 入力欄の中と、後ろを覆うダイアログを開いている間は反応しない。OS のクリップボードは使わない。
 */
export class StampClipboard {
  private copied: BlockSelection | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly painter: BlockPainter,
  ) {
    document.addEventListener("keydown", (e) => {
      if (e.defaultPrevented || !e.ctrlKey || e.altKey || e.shiftKey || this.state.tab !== "map" || modalOpen() || isTyping(e.target)) return;
      const key = e.key.toUpperCase();
      if (key === "C") {
        e.preventDefault();
        this.copy();
      } else if (key === "V") {
        e.preventDefault();
        this.paste();
      }
    });
  }

  /** 写したもの（無ければ null）。 */
  get content(): BlockSelection | null {
    return this.copied;
  }

  /** 今の選択を写す。 */
  copy(): void {
    const s = this.state.selection;
    this.copied = { ...s, blocks: [...s.blocks], ...(s.movements ? { movements: [...s.movements] } : {}) };
    this.state.setStatus(jaPaint.copied(s.width, s.height, s.movements !== undefined));
  }

  /** 写したものを貼る。 */
  paste(): void {
    if (!this.copied || !this.state.map) {
      this.state.setStatus(jaPaint.nothingToPaste);
      return;
    }
    this.painter.paintSelection(this.painter.hoverCell ?? { x: 0, y: 0 }, this.copied);
  }
}

/** 後ろを覆うダイアログが開いているか（Grosser Block のような覆わない窓は数えない）。 */
function modalOpen(): boolean {
  return openDialogs.some((d) => d.element.parentElement?.classList.contains("dialog-overlay") === true);
}

/** 文字を入れる欄の中か（チェックボックスなどは入力欄に数えない）。 */
function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  if (el instanceof HTMLInputElement) return !["checkbox", "radio", "button"].includes(el.type);
  return el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable;
}
