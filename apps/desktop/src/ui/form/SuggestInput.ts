import type { NameSuggest, SuggestHit } from "@zigzagumap/core";

/** 打って選ぶ欄の作り方。 */
export interface SuggestInputOptions {
  /** 欄の自動操作の ID（候補の一覧は `<id>.list`、候補は `<id>.item.<n>`、無いときの文は `<id>.none`）。 */
  readonly autoId: string;
  /** 候補の表（core の {@link NameSuggest}）。 */
  readonly suggest: NameSuggest;
  /** 候補の表記（欄にもこの文字を入れる）。 */
  label(hit: SuggestHit): string;
  /** 候補の右に薄く出す文字（番号など）。 */
  detail?(hit: SuggestHit): string;
  /** 当たる候補が無いときの文。 */
  readonly noneText: string;
  /** 決まったとき。 */
  onPick?(value: number): void;
}

/**
 * 名前を打って候補から選ぶ欄（#447）。打った文字で候補を絞り（カタカナ・ひらがな・ローマ字・番号）、
 * 候補を押すか ↑↓ と Enter で決める。欄を押すと全部の候補を出し、Esc で閉じる。
 * 名前が 1 つに決まる文字を打って Enter を押すか欄から離れると、候補を選ばなくても決まる。
 * 決まらないまま離れたら、欄の文字を今の値に戻す。
 */
export class SuggestInput {
  readonly element: HTMLDivElement;
  readonly input: HTMLInputElement;
  private readonly list: HTMLDivElement;
  private hits: SuggestHit[] = [];
  private active = -1;
  private current: SuggestHit | null = null;

  constructor(private readonly options: SuggestInputOptions) {
    this.element = document.createElement("div");
    this.element.className = "suggest-input";
    this.input = document.createElement("input");
    this.input.type = "text";
    this.input.autocomplete = "off";
    this.input.spellcheck = false;
    this.input.dataset["autoId"] = options.autoId;
    this.list = document.createElement("div");
    this.list.className = "suggest-list";
    this.list.dataset["autoId"] = `${options.autoId}.list`;
    this.list.hidden = true;
    this.element.append(this.input, this.list);

    this.input.addEventListener("click", () => {
      if (!this.list.hidden) return;
      this.input.select();
      this.show(this.options.suggest.all());
    });
    this.input.addEventListener("input", () => this.show(this.options.suggest.filter(this.input.value)));
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    this.input.addEventListener("change", () => this.commitExact());
    this.input.addEventListener("blur", () => {
      this.commitExact();
      this.close();
      this.input.value = this.current ? this.options.label(this.current) : "";
    });
    // 候補を押してもフォーカスを欄に残す（blur で閉じないように）
    this.list.addEventListener("mousedown", (e) => e.preventDefault());
  }

  /** 決まっている値（無ければ null）。 */
  get value(): number | null {
    return this.current?.value ?? null;
  }

  /** 値を入れる（onPick は呼ばない）。候補に無い値なら空にする。 */
  setValue(value: number | null): void {
    this.current = value === null ? null : (this.options.suggest.all().find((h) => h.value === value) ?? null);
    this.input.value = this.current ? this.options.label(this.current) : "";
  }

  /** 候補の一覧を出しているか。 */
  get open(): boolean {
    return !this.list.hidden;
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (this.list.hidden) this.show(this.options.suggest.filter(this.input.value));
      if (this.hits.length === 0) return;
      const step = e.key === "ArrowDown" ? 1 : -1;
      this.highlight(this.active < 0 ? (step > 0 ? 0 : this.hits.length - 1) : (this.active + step + this.hits.length) % this.hits.length);
    } else if (e.key === "Enter") {
      // 一覧を閉じているときは、決まる名前なら決めてから窓へ渡す（窓の側で検索などに使う）
      if (this.list.hidden) {
        this.commitExact();
        return;
      }
      const hit = this.active >= 0 ? this.hits[this.active] : this.options.suggest.exact(this.input.value);
      if (hit) {
        e.preventDefault();
        e.stopPropagation();
        this.pick(hit);
      } else {
        e.preventDefault();
        e.stopPropagation();
      }
    } else if (e.key === "Escape" && !this.list.hidden) {
      e.preventDefault();
      e.stopPropagation();
      this.close();
    }
  }

  /** 打った文字が 1 つに決まる名前なら決める。 */
  private commitExact(): void {
    const hit = this.options.suggest.exact(this.input.value);
    if (hit && hit.value !== this.current?.value) this.pick(hit);
    else if (hit) this.input.value = this.options.label(hit);
  }

  private pick(hit: SuggestHit): void {
    this.current = hit;
    this.input.value = this.options.label(hit);
    this.close();
    this.options.onPick?.(hit.value);
  }

  private show(hits: SuggestHit[]): void {
    this.hits = hits;
    this.active = -1;
    const id = this.options.autoId;
    if (hits.length === 0) {
      const none = document.createElement("div");
      none.className = "suggest-none";
      none.dataset["autoId"] = `${id}.none`;
      none.textContent = this.options.noneText;
      this.list.replaceChildren(none);
    } else {
      const fragment = document.createDocumentFragment();
      hits.forEach((hit, i) => {
        const item = document.createElement("div");
        item.className = "suggest-item";
        item.dataset["autoId"] = `${id}.item.${i}`;
        const name = document.createElement("span");
        name.textContent = this.options.label(hit);
        item.append(name);
        const detail = this.options.detail?.(hit);
        if (detail) {
          const d = document.createElement("span");
          d.className = "suggest-detail";
          d.textContent = detail;
          item.append(d);
        }
        if (hit.value === this.current?.value) item.classList.add("current");
        item.addEventListener("click", () => this.pick(hit));
        fragment.append(item);
      });
      this.list.replaceChildren(fragment);
    }
    this.list.hidden = false;
    this.list.scrollTop = 0;
  }

  private highlight(index: number): void {
    this.list.children[this.active]?.classList.remove("active");
    this.active = index;
    const el = this.list.children[index] as HTMLElement | undefined;
    el?.classList.add("active");
    el?.scrollIntoView({ block: "nearest" });
  }

  private close(): void {
    this.list.hidden = true;
    this.list.replaceChildren();
    this.hits = [];
    this.active = -1;
  }
}
