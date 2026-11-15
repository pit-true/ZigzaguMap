import type { CommandBus } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { commandText } from "../../app/commandText";
import { jaCommands as t } from "../../i18n/ja.commands";
import "../../styles/history.css";
import { createDialog, type DialogFrame } from "../Dialog";

/** 履歴の窓の 1 行（自動操作の `editHistory.state` にも使う）。 */
export interface HistoryRow {
  /** 押したときに移る位置（その操作の後。0 は最初の状態）。 */
  readonly position: number;
  readonly text: string;
  /** 今いる位置か。 */
  readonly current: boolean;
  /** やり直せる分（今より先）か。 */
  readonly redo: boolean;
}

/** 窓の外の機能（App が渡す）。 */
export interface HistoryPanelHost {
  /** × で閉じた（表示メニューのチェックを外す）。 */
  closed(): void;
}

/**
 * 履歴の窓（Phase5 #402。Porymap の Edit History と同じ動き）。メインの画面に浮かぶ小窓に、元に戻す・やり直すの履歴を
 * 新しい順に出す。今の位置を強調し、やり直せる分は薄く出す。行を押すと、その操作の後まで戻す・進める。
 * いちばん下の「（最初の状態）」を押すと全部戻す。コマンドが積まれた・戻した・進めたとき、ROM を開き直したときに直す。
 */
export class HistoryPanel {
  private frame: DialogFrame | null = null;
  private list: HTMLElement | null = null;
  private bus: CommandBus | null = null;
  private unsubscribe: (() => void) | null = null;

  constructor(
    private readonly state: EditorState,
    private readonly host: HistoryPanelHost,
  ) {
    state.on("session", () => {
      if (this.isOpen) this.attach();
    });
  }

  get isOpen(): boolean {
    return this.frame !== null;
  }

  open(): void {
    if (!this.frame) this.build();
    this.attach();
  }

  close(): void {
    this.detach();
    this.frame?.remove();
    this.frame = null;
    this.list = null;
  }

  /** 今の行（新しい順。最後が「最初の状態」）。開いていなくても作る。 */
  rows(): HistoryRow[] {
    const bus = this.state.session?.bus;
    if (!bus) return [];
    const done = bus.history();
    const redo = bus.redoHistory();
    const current = bus.position;
    const rows: HistoryRow[] = [];
    for (let i = redo.length - 1; i >= 0; i--) rows.push({ position: current + i + 1, text: commandText(redo[i]!), current: false, redo: true });
    for (let i = done.length - 1; i >= 0; i--) rows.push({ position: i + 1, text: commandText(done[i]!), current: i + 1 === current, redo: false });
    rows.push({ position: 0, text: t.initial, current: current === 0, redo: false });
    return rows;
  }

  /** 行を押したのと同じ（その位置まで戻す・進める）。動かした回数を返す。 */
  goTo(position: number): number {
    const bus = this.state.session?.bus;
    if (!bus) return 0;
    const steps = bus.goTo(position);
    if (steps > 0) {
      const row = this.rows().find((r) => r.current);
      this.state.setStatus(!row || row.position === 0 ? t.movedInitial : t.moved(row.text));
    }
    return steps;
  }

  private build(): void {
    const frame = createDialog({ title: t.title, modal: false, className: "history-panel", onClose: () => this.closeByUser() });
    frame.box.style.right = "24px";
    frame.box.style.top = "80px";
    frame.box.dataset["autoId"] = "editHistory";
    const hint = document.createElement("div");
    hint.className = "history-hint";
    hint.textContent = t.hint;
    const list = document.createElement("div");
    list.className = "history-list";
    list.dataset["autoId"] = "editHistory.list";
    list.addEventListener("click", (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>(".history-row");
      if (row?.dataset["position"] !== undefined) this.goTo(Number(row.dataset["position"]));
    });
    frame.body.append(hint, list);
    this.frame = frame;
    this.list = list;
  }

  private attach(): void {
    this.detach();
    this.bus = this.state.session?.bus ?? null;
    this.unsubscribe = this.bus?.subscribe(() => this.render()) ?? null;
    this.render();
  }

  private detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.bus = null;
  }

  private closeByUser(): void {
    this.close();
    this.host.closed();
  }

  private render(): void {
    const list = this.list;
    if (!list) return;
    const rows = this.rows();
    const items = rows.map((r) => {
      const el = document.createElement("div");
      el.className = `history-row${r.current ? " current" : ""}${r.redo ? " redo" : ""}${r.position === 0 ? " initial" : ""}`;
      el.dataset["position"] = String(r.position);
      el.textContent = r.text;
      return el;
    });
    if (rows.length <= 1) {
      const empty = document.createElement("div");
      empty.className = "history-empty";
      empty.textContent = t.empty;
      items.unshift(empty);
    }
    list.replaceChildren(...items);
    list.querySelector(".current")?.scrollIntoView({ block: "nearest" });
  }
}
