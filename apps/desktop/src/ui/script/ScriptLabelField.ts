import { isScriptLabelName } from "@zigzagumap/core";
import { jaScriptLabel as t } from "../../i18n/ja.scriptLabel";
import "../../styles/scriptLabel.css";

/** 欄が使う、タブ側の機能。 */
export interface ScriptLabelSource {
  /** 使えるか（プロジェクトフォルダを開いているとき）。 */
  available(): boolean;
  /** 今のラベル（無ければ null）。 */
  current(): string | null;
  /** 選べるラベル（マップの `.s` のラベル）。 */
  candidates(): Promise<readonly string[]>;
  /** ラベルを変える（null で外す）。コマンドにする。 */
  commit(label: string | null): void;
  /** 一覧の読み直しを知らせてもらう。戻り値でやめる。 */
  onCandidatesChanged(listener: () => void): () => void;
}

/** 一覧に出す数の上限。 */
const MAX_ITEMS = 200;

/**
 * スクリプトのラベルの欄（イベントタブの人・看板・スクリプトタイル、マップスクリプトのパネル）。
 * CodeMirror は使わず、入力欄と一覧で作る。入力中は、マップの `.s` のラベルのうち入力を含むものを一覧に出す
 * （↑↓ で選び、Enter か一覧のクリックで決める。Esc で元に戻す）。▼ で全部を出す。フォーカスが外れたときにも決める。
 * 空にして決めるとラベルを外す。`.s` に無いラベルは赤い字にする（ビルドで Symbol missing になるため）。
 */
export class ScriptLabelField {
  readonly element: HTMLElement;
  readonly input: HTMLInputElement;
  private readonly list: HTMLElement;
  private items: string[] = [];
  private selected = -1;
  private shown: string | null = null;
  /** 利用者が打ちかけの文字があるか（入力してから、まだ決めていない）。 */
  private typing = false;
  private all: readonly string[] = [];
  private version = 0;

  constructor(
    private readonly source: ScriptLabelSource,
    /** 自動操作の ID（`event.person.label` など）。 */
    readonly id: string,
    width = 141,
    /** `0x0816F58D` のようなアドレスも書けるか（マップスクリプトの行き先）。 */
    private readonly allowAddress = false,
  ) {
    this.element = document.createElement("div");
    this.element.className = "script-label";
    this.element.dataset["autoId"] = `${id}.box`;
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.className = "script-label-input";
    this.input.style.width = `${width}px`;
    this.input.spellcheck = false;
    this.input.placeholder = t.placeholder;
    this.input.dataset["autoId"] = id;
    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "script-label-drop";
    drop.textContent = "▼";
    drop.title = t.showAll;
    drop.tabIndex = -1;
    drop.dataset["autoId"] = `${id}.drop`;
    this.list = document.createElement("div");
    this.list.className = "script-label-list";
    this.list.hidden = true;
    this.list.dataset["autoId"] = `${id}.list`;
    this.element.append(this.input, drop, this.list);

    this.input.addEventListener("input", () => {
      this.typing = true;
      void this.openList(this.input.value);
    });
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.input.addEventListener("blur", () => {
      // 一覧のクリックは mousedown で決めるので、ここでは入力をそのまま決める
      this.closeList();
      this.commit(this.input.value);
    });
    drop.addEventListener("mousedown", (e) => {
      e.preventDefault();
      if (!this.list.hidden) return this.closeList();
      this.input.focus();
      void this.openList("");
    });
    source.onCandidatesChanged(() => void this.refreshMark());
  }

  /**
   * 今のラベルを出す（イベントを選び直したとき、F2・元に戻す・取り込み・付け直しで変わったときなど）。
   * 欄にフォーカスがあっても、打ちかけの文字が無ければ書き換える（Enter で決めたあとは打ちかけではない）。
   */
  show(): void {
    const on = this.source.available();
    this.element.hidden = !on;
    if (!on) return;
    this.shown = this.source.current();
    if (!this.typing || document.activeElement !== this.input) {
      this.typing = false;
      this.input.value = this.shown ?? "";
      this.input.classList.remove("invalid");
    }
    void this.refreshMark();
  }

  /** ラベルが付いているか。 */
  get hasLabel(): boolean {
    return this.source.available() && this.source.current() !== null;
  }

  /** 一覧（自動操作の確かめ用）。 */
  get listItems(): readonly string[] {
    return this.list.hidden ? [] : this.items;
  }

  /** 決める（自動操作からも呼ぶ）。 */
  commit(raw: string): void {
    const text = raw.trim();
    const next = text === "" ? null : text;
    if (next === this.shown) {
      this.typing = false;
      this.input.value = next ?? "";
      return;
    }
    if (next !== null && !isScriptLabelName(next) && !(this.allowAddress && /^0x[0-9A-Fa-f]{1,8}$/.test(next))) {
      this.input.classList.add("invalid");
      this.input.title = t.invalid(next);
      return;
    }
    this.input.classList.remove("invalid");
    this.typing = false;
    this.shown = next;
    this.source.commit(next);
  }

  private async refreshMark(): Promise<void> {
    const v = ++this.version;
    const label = this.shown;
    this.all = await this.source.candidates();
    if (v !== this.version) return;
    const missing = label !== null && !this.all.includes(label);
    this.input.classList.toggle("missing", missing);
    this.input.classList.remove("invalid");
    this.input.title = missing ? t.missing(label) : (label ?? "");
  }

  private async openList(filter: string): Promise<void> {
    this.all = await this.source.candidates();
    const f = filter.trim().toLowerCase();
    this.items = this.all.filter((n) => f === "" || n.toLowerCase().includes(f)).slice(0, MAX_ITEMS);
    this.selected = this.items.length > 0 && f !== "" ? 0 : -1;
    this.renderList();
  }

  private renderList(): void {
    if (this.items.length === 0 || document.activeElement !== this.input) {
      this.closeList();
      return;
    }
    this.list.replaceChildren(
      ...this.items.map((name, i) => {
        const el = document.createElement("div");
        el.className = "script-label-item";
        el.classList.toggle("selected", i === this.selected);
        el.textContent = name;
        el.dataset["autoId"] = `${this.id}.option:${name}`;
        el.addEventListener("mousedown", (e) => {
          e.preventDefault();
          this.input.value = name;
          this.closeList();
          this.commit(name);
        });
        return el;
      }),
    );
    this.list.hidden = false;
    this.list.querySelector(".selected")?.scrollIntoView({ block: "nearest" });
  }

  private closeList(): void {
    this.list.hidden = true;
    this.list.replaceChildren();
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (this.list.hidden) void this.openList(this.input.value);
      else if (this.items.length > 0) {
        const step = e.key === "ArrowDown" ? 1 : -1;
        this.selected = (this.selected + step + this.items.length) % this.items.length;
        this.renderList();
      }
      e.preventDefault();
    } else if (e.key === "Enter") {
      const pick = !this.list.hidden && this.selected >= 0 ? this.items[this.selected]! : this.input.value;
      this.input.value = pick;
      this.closeList();
      this.commit(pick);
      e.preventDefault();
    } else if (e.key === "Escape") {
      this.closeList();
      this.typing = false;
      this.input.value = this.shown ?? "";
      this.input.classList.remove("invalid");
      e.preventDefault();
    } else return;
    e.stopPropagation();
  }
}
