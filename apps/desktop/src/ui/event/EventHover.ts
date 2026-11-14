import "../../styles/eventHover.css";
import { jaEventHover as t } from "../../i18n/ja.eventHover";
import type { PlacedEvent } from "../map/EventLayer";
import type { MapView } from "../map/MapView";
import type { RawCell } from "./EventMapInput";

/** 吹き出しの 1 区切り（同じマスのイベント 1 つ）。 */
export interface HoverSection {
  readonly title: string;
  readonly lines: readonly string[];
  /** 先頭に出す警告（ワープできないブロックなど。#240）。 */
  readonly warn?: string | null;
  /** 画像（ワープの行き先の周辺。#240）。 */
  readonly image?: HTMLCanvasElement | null;
}

/** 吹き出しの中身を作るもの（イベントタブ）。 */
export interface HoverSource {
  /** そのマスのイベント（上に描くものから）。 */
  eventsAt(cell: RawCell): readonly PlacedEvent[];
  /** すぐ出せる中身（見出しと、待たずに分かる行）。 */
  quick(e: PlacedEvent): HoverSection;
  /** 時間のかかる中身（スクリプトの要約など）。無ければ null。 */
  detail(e: PlacedEvent): Promise<HoverSection> | null;
  /** 出してよいか（イベントタブを表示していて、ドラッグ中・描画中でない）。 */
  enabled(): boolean;
}

/** カーソルを止めてから出すまでの時間（ミリ秒）。 */
export const HOVER_DELAY_MS = 400;

/**
 * イベントタブのイベントの上にカーソルを止めたときの吹き出し（#226）。マウスの動きは記録するだけで、止まってから
 * 0.4 秒後に中身を作る（スクリプトの要約は待たずに「読み込み中…」を出し、できたら差し替える）。
 * ボタンを押している間・マップから出たとき・ホイールでは消す。ステータスバーの文字はイベントタブがこれまでどおり出す。
 */
export class EventHover {
  readonly element: HTMLElement;
  private timer: number | null = null;
  private cell: RawCell | null = null;
  private client = { x: 0, y: 0 };
  /** 出している中身の番号（古い答えを捨てる）。 */
  private token = 0;
  private sections: HoverSection[] = [];
  private shownCell: RawCell | null = null;

  constructor(
    private readonly view: MapView,
    private readonly source: HoverSource,
  ) {
    this.element = document.createElement("div");
    this.element.className = "event-hover";
    this.element.dataset["autoId"] = "event.hover";
    this.element.hidden = true;
    document.body.append(this.element);
    const stage = view.stage;
    stage.addEventListener("pointermove", (e) => this.move(e));
    stage.addEventListener("pointerdown", () => this.hide());
    stage.addEventListener("pointerleave", () => this.hide());
    stage.addEventListener("wheel", () => this.hide(), { passive: true });
    window.addEventListener("blur", () => this.hide());
  }

  /** 出しているか。 */
  get visible(): boolean {
    return !this.element.hidden;
  }

  /** 出している中身（自動操作の `event.hover`）。 */
  get content(): { cell: RawCell | null; sections: readonly { title: string; lines: readonly string[]; warn: string | null; image: boolean }[] } {
    return {
      cell: this.shownCell,
      sections: this.sections.map((s) => ({ title: s.title, lines: s.lines, warn: s.warn ?? null, image: !!s.image })),
    };
  }

  private move(e: PointerEvent): void {
    if (e.buttons !== 0 || !this.source.enabled()) return this.hide();
    const cell = this.view.cellAt(e);
    this.client = { x: e.clientX, y: e.clientY };
    if (cell && this.cell && cell.x === this.cell.x && cell.y === this.cell.y) return;
    this.hide();
    this.cell = cell;
    if (!cell) return;
    this.timer = window.setTimeout(() => {
      this.timer = null;
      void this.showAt(cell, this.client.x, this.client.y);
    }, HOVER_DELAY_MS);
  }

  /** 消す（待っている分も止める）。 */
  hide(): void {
    if (this.timer !== null) window.clearTimeout(this.timer);
    this.timer = null;
    this.cell = null;
    this.token++;
    this.element.hidden = true;
    this.shownCell = null;
    this.sections = [];
  }

  /**
   * そのマスの吹き出しを出す（`x`・`y` は画面の位置）。イベントが無ければ出さずに false。
   * 中身ができるまで待ってから返る（自動操作でも同じ文を読めるように）。
   */
  async showAt(cell: RawCell, x: number, y: number): Promise<boolean> {
    const events = this.source.eventsAt(cell);
    if (events.length === 0 || !this.source.enabled()) return false;
    const token = ++this.token;
    this.shownCell = cell;
    this.cell = cell;
    this.sections = events.map((e) => this.source.quick(e));
    const pending = events.map((e) => this.source.detail(e));
    if (pending.some((p) => p !== null)) {
      this.sections = this.sections.map((s, i) => (pending[i] ? { ...s, lines: [...s.lines, t.loading] } : s));
    }
    this.render(x, y);
    await Promise.all(
      pending.map(async (p, i) => {
        if (!p) return;
        let section: HoverSection;
        try {
          section = await p;
        } catch (err) {
          const quick = this.source.quick(events[i]!);
          section = { ...quick, lines: [...quick.lines, t.failed(err instanceof Error ? err.message : String(err))] };
        }
        if (token !== this.token) return;
        this.sections[i] = section;
        this.render(x, y);
      }),
    );
    return token === this.token;
  }

  private render(x: number, y: number): void {
    const box = this.element;
    box.replaceChildren();
    this.sections.forEach((s, i) => {
      if (i > 0) {
        const hr = document.createElement("hr");
        hr.className = "event-hover-rule";
        box.append(hr);
      }
      const title = document.createElement("div");
      title.className = "event-hover-title";
      title.textContent = s.title;
      box.append(title);
      if (s.warn) {
        const warn = document.createElement("div");
        warn.className = "event-hover-warn";
        warn.textContent = s.warn;
        box.append(warn);
      }
      for (const line of s.lines) {
        const div = document.createElement("div");
        div.className = "event-hover-line";
        div.textContent = line;
        box.append(div);
      }
      if (s.image) {
        s.image.classList.add("event-hover-image");
        box.append(s.image);
      }
    });
    box.hidden = false;
    // カーソルの右下に出し、窓からはみ出すなら反対側へ寄せる。
    const margin = 16;
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const left = x + margin + w > window.innerWidth ? Math.max(0, x - margin - w) : x + margin;
    const top = y + margin + h > window.innerHeight ? Math.max(0, y - margin - h) : y + margin;
    box.style.left = `${left}px`;
    box.style.top = `${top}px`;
  }
}
