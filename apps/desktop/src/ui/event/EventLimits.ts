import type { EditorState } from "../../app/EditorState";
import { jaEventLimit as t } from "../../i18n/ja.eventLimit";
import { messageBox } from "../MessageBox";

/**
 * ゲームがマップに持てる人の数（Phase5 #400）。ゲームはマップに入ると人の表を数の分だけセーブデータの
 * `SvSxyObj[64]`（CFRU の `gSaveBlock1->eventObjectTemplates[64]`、0x08E0〜0x0EDF）へ写し、上限で止めない
 * （FRLG の日本語版 `fld_tool.c` の `SxyObjDataSet`、BPRJ 0x08054828）。65 個目からは後ろのフラグ（0x0EE0〜）を書きつぶす。
 * ND と Chronos のビルドした ROM でも 0x08054828 の命令は素の BPRJ と同じで、CFRU は置き換えていない。
 * 看板・スクリプトタイル・ワープはマップのデータを直接読むので、表の数（255）のほかに上限は無い。
 */
export const PERSON_LIMIT = 64;

/** 人の数が上限を超えているか。 */
export function personsOverLimit(persons: number): boolean {
  return persons > PERSON_LIMIT;
}

/**
 * ステータスバーの注意（#400）。開いているマップの人が 64 を超えたら赤い文を出す（押すと説明）。
 * 超えていなければ隠す（AdvanceMap と同じ見た目のまま）。
 */
export class EventLimitNotice {
  readonly element: HTMLButtonElement;
  private unsubscribe: (() => void) | null = null;

  constructor(private readonly state: EditorState) {
    this.element = document.createElement("button");
    this.element.type = "button";
    this.element.className = "status-panel status-warn event-limit";
    this.element.dataset["autoId"] = "status.eventLimit";
    this.element.title = t.statusHint;
    this.element.hidden = true;
    this.element.addEventListener("click", () => void messageBox(t.title, t.explain(this.persons()), "warning"));
    state.on("map", () => this.render());
    state.on("session", () => {
      this.unsubscribe?.();
      this.unsubscribe = state.session?.bus.subscribe(() => this.render()) ?? null;
      this.render();
    });
  }

  private persons(): number {
    return this.state.map?.doc.events?.persons.length ?? 0;
  }

  private render(): void {
    const n = this.persons();
    this.element.hidden = !personsOverLimit(n);
    this.element.textContent = t.status(n);
  }
}
