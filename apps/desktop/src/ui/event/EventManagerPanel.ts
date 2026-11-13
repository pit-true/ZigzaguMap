import { ja } from "../../i18n/ja";
import { SpinEdit, formRow, pushButton } from "../form/valueControls";

/** 人・看板・ワープ・スクリプトの個数。 */
export interface EventCounts {
  readonly persons: number;
  readonly signs: number;
  readonly warps: number;
  readonly traps: number;
}

const KEYS = ["persons", "signs", "warps", "traps"] as const;

/**
 * イベントマネージャー（AdvanceMap の EventMengeFrame1）。4 つの個数（0〜255）を変えて「設定」で反映する。
 * 「設定」は、どれかが今の個数と違うときだけ押せる。確認のダイアログは出さない。
 */
export class EventManagerPanel {
  readonly element: HTMLElement;
  private readonly spins: Record<(typeof KEYS)[number], SpinEdit>;
  private readonly apply: HTMLButtonElement;
  private current: EventCounts = { persons: 0, signs: 0, warps: 0, traps: 0 };
  private wanted: Record<(typeof KEYS)[number], number> = { persons: 0, signs: 0, warps: 0, traps: 0 };

  constructor(onApply: (counts: EventCounts) => void) {
    this.element = document.createElement("fieldset");
    this.element.className = "group-box event-manager";
    const legend = document.createElement("legend");
    legend.textContent = ja.event.manager.title;
    this.element.append(legend);
    const make = (key: (typeof KEYS)[number]): SpinEdit =>
      new SpinEdit({
        id: `event.manager.${key}`,
        min: 0,
        max: 255,
        width: 37,
        onValue: (v) => {
          this.wanted[key] = v;
          this.updateButton();
        },
      });
    this.spins = { persons: make("persons"), signs: make("signs"), warps: make("warps"), traps: make("traps") };
    const m = ja.event.manager;
    const labels = { persons: m.persons, signs: m.signs, warps: m.warps, traps: m.traps };
    for (const key of KEYS) this.element.append(formRow(labels[key], 112, this.spins[key]));
    this.apply = pushButton("event.manager.apply", m.apply, () => onApply({ ...this.wanted }), "manager-apply");
    this.element.append(this.apply);
  }

  /** 今の個数を表示する。個数が変わったときか `reset` のときだけ、入力中の値を捨てる。 */
  show(counts: EventCounts, reset = false): void {
    if (!reset && KEYS.every((k) => counts[k] === this.current[k])) return;
    this.current = counts;
    this.wanted = { ...counts };
    for (const key of KEYS) this.spins[key].set(counts[key]);
    this.updateButton();
  }

  private updateButton(): void {
    this.apply.disabled = KEYS.every((k) => this.wanted[k] === this.current[k]);
  }
}
