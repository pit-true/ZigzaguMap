import type { TrainerData, TrainerEntry } from "@zigzagumap/core";
import { jaTrainer as t } from "../../i18n/ja.trainer";
import "../../styles/template.css";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";
import { autoId } from "../form/controls";
import { showError } from "../MessageBox";
import { hex, mergeParty, parseNumber, parseParty, partyText } from "./trainerText";

/** トレーナーの窓に渡すもの。 */
export interface TrainerEditInput {
  /** 今の値（trainers.json にあればそちら、無ければ ROM の表）。 */
  readonly current: TrainerData | TrainerEntry;
  /** trainers.json にあるか（「ROM の値に戻す」を出す）。 */
  readonly edited: boolean;
  /** ROM の表にある番号か（無ければ「ROM の値に戻す」は「trainers.json から消す」の意味になる）。 */
  readonly inRom: boolean;
  /** クラス名（番号の順）。 */
  readonly classes: readonly string[];
  /** 種族名（手持ちの欄の下に出す）。 */
  speciesName(species: number): string;
}

/** 窓の答え。`set` は直した値、`revert` は trainers.json から消して ROM の値に戻す。 */
export type TrainerEditResult = { readonly kind: "set"; readonly trainer: TrainerEntry } | { readonly kind: "revert" };

/**
 * トレーナーをあとから直す窓（#274）。名前・クラス・絵・BGM・女性・持ち物 4 つ・ダブルバトル・AI・手持ち（種族とレベル）を直す。
 * 手持ちの個体値・持ち物・技（形式が持つとき）は、同じ並びの元の値を残す。書くのは呼んだ側（`setTrainer` / `removeTrainer`）。
 * 自動操作からは部品の ID（`trainerEdit.name` など）で入れ、`dialog` の `ok` で決める。
 */
export function openTrainerEditDialog(input: TrainerEditInput): Promise<TrainerEditResult | null> {
  const cur = input.current;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: TrainerEditResult | null): void => {
      if (done) return;
      done = true;
      frame.remove();
      resolve(value);
    };
    const title = t.editTitle(cur.id);
    const frame = createDialog({ title, className: "template-dialog", onClose: () => finish(null) });
    const intro = document.createElement("p");
    intro.textContent = input.edited ? t.editIntroEdited : t.editIntroRom;
    const form = document.createElement("div");
    form.className = "tp-form";
    const row = (caption: string, control: HTMLElement, ...extra: HTMLElement[]): void => {
      const label = document.createElement("label");
      label.textContent = caption;
      const cell = document.createElement("div");
      cell.className = "tp-cell";
      cell.append(control, ...extra);
      form.append(label, cell);
    };
    const text = (id: string, value: string): HTMLInputElement => {
      const el = autoId(document.createElement("input"), `trainerEdit.${id}`);
      el.type = "text";
      el.spellcheck = false;
      el.value = value;
      return el;
    };
    const check = (id: string, value: boolean): HTMLInputElement => {
      const el = autoId(document.createElement("input"), `trainerEdit.${id}`);
      el.type = "checkbox";
      el.checked = value;
      return el;
    };

    const name = text("name", cur.name);
    const cls = autoId(document.createElement("select"), "trainerEdit.class");
    input.classes.forEach((c, i) => {
      const o = document.createElement("option");
      o.value = String(i);
      o.textContent = `${hex(i)} ${c}`;
      cls.append(o);
    });
    cls.value = String(cur.trainerClass);
    const pic = text("pic", String(cur.pic));
    const music = text("music", String(cur.music));
    const female = check("female", cur.female);
    const items = [0, 1, 2, 3].map((i) => text(`item.${i}`, hex(cur.items[i] ?? 0)));
    const itemBox = document.createElement("div");
    itemBox.className = "tp-items";
    itemBox.append(...items);
    const double = check("double", cur.doubleBattle);
    const ai = text("ai", hex(cur.aiFlags >>> 0));
    const party = text("party", partyText(cur.party));
    party.placeholder = t.partyHint;
    const names = document.createElement("div");
    names.className = "tp-note";
    names.dataset["autoId"] = "trainerEdit.partyNames";
    const showNames = (): void => {
      try {
        names.textContent = parseParty(party.value)
          .map((m) => `${input.speciesName(m.species)} Lv${m.level}`)
          .join("、");
      } catch {
        names.textContent = "";
      }
    };
    party.addEventListener("input", showNames);
    showNames();

    row(t.name, name);
    row(t.trainerClass, cls);
    row(t.pic, pic);
    row(t.music, music);
    row(t.female, female);
    row(t.items, itemBox);
    row(t.doubleBattle, double);
    row(t.aiFlags, ai);
    row(t.party, party);
    form.append(document.createElement("span"), names);

    const read = (): TrainerEntry => {
      const edited = parseParty(party.value);
      const out: TrainerEntry = {
        ...cur,
        name: name.value,
        trainerClass: Number(cls.value),
        pic: parseNumber(pic.value),
        music: parseNumber(music.value),
        female: female.checked,
        items: items.map((el) => parseNumber(el.value)),
        doubleBattle: double.checked,
        aiFlags: parseNumber(ai.value) >>> 0,
        party: mergeParty(cur.party, edited, cur.partyFlags),
      };
      return out;
    };
    const ok = (): void => {
      try {
        finish({ kind: "set", trainer: read() });
      } catch (e) {
        void showError(e instanceof Error ? e.message : String(e));
      }
    };
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    const revertLabel = input.inRom ? t.revert : t.removeEntry;
    if (input.edited) buttons.append(autoId(dialogButton(revertLabel, () => finish({ kind: "revert" })), "trainerEdit.revert"));
    buttons.append(autoId(dialogButton(t.ok, ok), "trainerEdit.ok"), autoId(dialogButton(t.cancel, () => finish(null)), "trainerEdit.cancel"));
    frame.body.append(intro, form, buttons);
    handleDialogKeys(frame, () => finish(null));
    frame.register({
      title,
      text: intro.textContent,
      ...pressable([
        { label: t.ok, aliases: ["ok"], run: ok },
        { label: t.cancel, aliases: ["cancel"], run: () => finish(null) },
        ...(input.edited ? [{ label: revertLabel, aliases: ["revert"], run: () => finish({ kind: "revert" as const }) }] : []),
      ]),
    });
    name.focus();
  });
}
