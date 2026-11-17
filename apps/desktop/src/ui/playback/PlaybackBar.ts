import type { MovementDirection, PlayerGender } from "@zigzagumap/core";
import { jaPlayback as t } from "../../i18n/ja.playback";
import { jaPathDraw } from "../../i18n/ja.pathDraw";

export interface PlaybackBarActions {
  toggle(): void;
  stop(): void;
  seek(frame: number): void;
  step(direction: -1 | 1): void;
  speed(value: number): void;
  startState(gender: PlayerGender, facing: MovementDirection, absent: readonly number[]): void;
  /** 「道をなぞる…」（#518）。 */
  pathDraw(): void;
}

/** マップの下に置く再生の操作。時計とスクリプトの計算は持たない。 */
export class PlaybackBar {
  readonly element = document.createElement("section");
  readonly details = document.createElement("div");
  private readonly play = document.createElement("button");
  private readonly status = document.createElement("output");
  private readonly slider = document.createElement("input");
  private readonly gender = document.createElement("select");
  private readonly facing = document.createElement("select");
  private readonly people = document.createElement("details");
  private readonly absent = new Map<number, HTMLInputElement>();
  private readonly condition = document.createElement("output");

  constructor(private readonly actions: PlaybackBarActions) {
    this.element.className = "playback-bar"; this.element.dataset["autoId"] = "playback.bar";
    this.element.tabIndex = 0;
    const row = document.createElement("div"); row.className = "playback-controls";
    const button = (id: string, text: string, action: () => void): HTMLButtonElement => {
      const b = document.createElement("button"); b.textContent = text; b.dataset["autoId"] = `playback.${id}`; b.addEventListener("click", action); row.append(b); return b;
    };
    button("first", t.first, () => actions.seek(0));
    button("previous", t.previous, () => actions.step(-1));
    this.play = button("play", t.play, () => actions.toggle());
    button("next", t.next, () => actions.step(1));
    button("stop", t.stop, () => actions.stop());
    button("pathDraw", jaPathDraw.menuPlayback, () => actions.pathDraw());
    const speed = document.createElement("select"); speed.title = t.speed; speed.dataset["autoId"] = "playback.speed";
    for (const value of [0.25, 0.5, 1, 2, 4]) speed.add(new Option(`${value}×`, String(value)));
    speed.value = "1"; speed.addEventListener("change", () => actions.speed(Number(speed.value)));
    for (const value of ["male", "female"] as const) this.gender.add(new Option(t[value], value));
    this.gender.dataset["autoId"] = "playback.gender";
    for (const value of ["down", "up", "left", "right"] as const) this.facing.add(new Option(t[value], value));
    this.facing.title = t.facing; this.facing.dataset["autoId"] = "playback.facing";
    this.gender.addEventListener("change", () => this.changedStart()); this.facing.addEventListener("change", () => this.changedStart());
    this.condition.dataset["autoId"] = "playback.condition"; this.condition.className = "playback-condition"; this.condition.hidden = true;
    row.append(speed, this.gender, this.facing, this.people, this.status, this.condition);
    this.status.dataset["autoId"] = "playback.position";
    this.slider.type = "range"; this.slider.min = "0"; this.slider.step = "1"; this.slider.dataset["autoId"] = "playback.seek";
    this.slider.addEventListener("input", () => actions.seek(Number(this.slider.value)));
    this.details.className = "playback-details"; this.details.dataset["autoId"] = "playback.details";
    this.element.append(row, this.slider, this.details);
  }

  configure(last: number, gender: PlayerGender, facing: MovementDirection, people: readonly number[], absent: readonly number[], name: (localId: number) => string = String): void {
    this.slider.max = String(last); this.gender.value = gender; this.facing.value = facing;
    const summary = document.createElement("summary"); summary.textContent = t.absent;
    this.people.replaceChildren(summary); this.absent.clear();
    for (const id of people) {
      const label = document.createElement("label"), input = document.createElement("input");
      input.type = "checkbox"; input.checked = absent.includes(id); input.dataset["autoId"] = `playback.absent.${id}`;
      input.addEventListener("change", () => this.changedStart());
      label.append(input, name(id)); this.people.append(label); this.absent.set(id, input);
    }
  }

  update(frame: number, last: number, playing: boolean, message = false): void {
    this.slider.value = String(frame); this.status.textContent = t.status(frame, last);
    this.play.textContent = playing ? t.pause : message ? t.continue : t.play;
  }

  /** 踏むスクリプトの変数の条件（見ずに再生したことを知らせる）。null で隠す。 */
  setCondition(text: string | null): void { this.condition.textContent = text ?? ""; this.condition.hidden = text === null; }

  private changedStart(): void {
    this.actions.startState(this.gender.value as PlayerGender, this.facing.value as MovementDirection, [...this.absent].filter(([, input]) => input.checked).map(([id]) => id));
  }
  clear(): void { this.setCondition(null); this.details.replaceChildren(); this.people.replaceChildren(); this.absent.clear(); }
}
