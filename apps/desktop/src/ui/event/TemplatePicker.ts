import {
  EVENT_TEMPLATES,
  FACING_MOVEMENTS,
  ItemNameTable,
  eventTemplate,
  templateDefaults,
  type EventTemplateId,
  type TemplateNeed,
  type TemplateValues,
  type TrainerData,
  type TrainerMon,
} from "@zigzagumap/core";
import type { App } from "../../app/App";
import { jaTemplate as t } from "../../i18n/ja.template";
import { jaTrainer } from "../../i18n/ja.trainer";
import "../../styles/template.css";
import { createDialog, dialogButton, handleDialogKeys, pressable } from "../Dialog";
import { autoId } from "../form/controls";
import { showError } from "../MessageBox";
import { hex, parseNumber, parseParty, partyText } from "../trainer/trainerText";
import type { TemplatePlaceRequest } from "./TemplatePlacer";

/** トレーナーの選択肢（#244。TrainerTable から作る）。 */
export interface TrainerChoice {
  readonly id: number;
  readonly text: string;
}

/** ひな形の窓が使うもの。 */
export interface TemplatePickerSource {
  /** 範囲の中で使われていない最小の番号。 */
  unused(kind: "flag" | "var" | "hiddenItem" | "trainer", skip?: ReadonlySet<number>): Promise<number | null>;
  /** トレーナーの一覧（無ければトレーナーのひな形を出さない）。 */
  trainers?(): Promise<readonly TrainerChoice[]>;
  /** 「新しいトレーナーを作る」（#245）。無ければ欄を出さない。 */
  newTrainer?: NewTrainerSource;
}

/** 「新しいトレーナーを作る」の欄が使うもの。 */
export interface NewTrainerSource {
  /** 既定の番号（使われていない既存の枠の最小）。 */
  nextId(): Promise<number | null>;
  /** 見本にするトレーナー（クラス・絵・BGM・AI を写す）。 */
  base(id: number): TrainerData | null;
  /** クラス名（番号の順）。 */
  classes(): readonly string[];
  /** チームの自動生成（このマップと隣の野生から）。 */
  generate(seed: number): Promise<{ party: TrainerMon[]; note: string }>;
  /** 種族名（手持ちの欄の下に出す）。 */
  speciesName(species: number): string;
}

/**
 * 「ここにひな形を置く」の窓（#243）。種類を選び、要る入力（見た目・フラグ・アイテム・品物・トレーナー・文）を聞いて「置く」。
 * フラグ・変数・隠しアイテムの番号は、索引（#227）の未使用の最小を既定に入れる。置くのは TemplatePlacer。
 * 自動操作からは部品の ID（`template.kind`、`template.flag` など）で入力し、`dialog` の「置く」で置ける。
 */
export function openTemplatePicker(app: App, x: number, y: number, source: TemplatePickerSource, initial: EventTemplateId = "person"): Promise<TemplatePlaceRequest | null> {
  const session = app.state.session;
  if (!session) return Promise.resolve(null);
  const p = session.project;
  const items = ItemNameTable.read(p.rom, p.game.offsets.itemTablePointer, p.game.offsets.itemCount, p.textCodec).names;
  return new Promise((resolve) => {
    let done = false;
    const finish = (value: TemplatePlaceRequest | null): void => {
      if (done) return;
      done = true;
      frame.remove();
      resolve(value);
    };
    const frame = createDialog({ title: t.title, className: "template-dialog", onClose: () => finish(null) });
    const intro = document.createElement("p");
    intro.textContent = t.intro(x, y);
    const kindRow = document.createElement("div");
    kindRow.className = "tp-form";
    const kindLabel = document.createElement("label");
    kindLabel.textContent = t.kindLabel;
    const kindSelect = autoId(document.createElement("select"), "template.kind");
    kindRow.append(kindLabel, kindSelect);
    const form = document.createElement("div");
    form.className = "tp-form";
    let kind: EventTemplateId = initial;
    let read: () => TemplateValues = () => ({});

    const kinds = EVENT_TEMPLATES.filter((s) => s.id !== "trainer" || source.trainers);
    for (const s of kinds) {
      const o = document.createElement("option");
      o.value = s.id;
      o.textContent = t.kinds[s.id] ?? s.id;
      kindSelect.append(o);
    }
    kindSelect.value = kind;
    kindSelect.addEventListener("change", () => {
      kind = kindSelect.value as EventTemplateId;
      void build();
    });

    const row = (caption: string, control: HTMLElement, ...extra: HTMLElement[]): void => {
      const label = document.createElement("label");
      label.textContent = caption;
      const cell = document.createElement("div");
      cell.className = "tp-cell";
      cell.append(control, ...extra);
      form.append(label, cell);
    };
    const input = (id: string, value: string): HTMLInputElement => {
      const el = autoId(document.createElement("input"), `template.${id}`);
      el.type = "text";
      el.spellcheck = false;
      el.value = value;
      return el;
    };
    const unusedButton = (target: HTMLInputElement, what: "flag" | "var" | "hiddenItem" | "trainer", id: string): HTMLButtonElement => {
      const b = autoId(dialogButton(t.pickUnused, () => void source.unused(what).then((v) => v !== null && (target.value = hex(v)))), `template.${id}Unused`);
      b.className = "tp-small";
      return b;
    };
    const itemSelect = (id: string, value: number, multiple = false, selected: readonly number[] = []): HTMLSelectElement => {
      const el = autoId(document.createElement("select"), `template.${id}`);
      el.multiple = multiple;
      if (multiple) el.size = 8;
      items.forEach((name, i) => {
        if (i === 0) return;
        const o = document.createElement("option");
        o.value = String(i);
        o.textContent = `${hex(i)} ${name}`;
        o.selected = multiple ? selected.includes(i) : i === value;
        el.append(o);
      });
      return el;
    };

    const build = async (): Promise<void> => {
      const spec = eventTemplate(kind);
      const needs = new Set<TemplateNeed>(spec.needs);
      form.textContent = "";
      const auto = {
        flag: needs.has("flag") ? await source.unused("flag") : null,
        variable: needs.has("variable") ? await source.unused("var") : null,
        hiddenId: needs.has("hiddenId") ? await source.unused("hiddenItem") : null,
      };
      if (kind !== kindSelect.value) return; // 待っている間に種類を変えた
      const v = templateDefaults(kind, auto);
      const readers: ((out: TemplateValues) => void)[] = [];
      if (needs.has("graphics")) {
        const el = input("graphics", String(v.graphicsId ?? 0));
        row(t.graphics, el);
        readers.push((o) => (o.graphicsId = parseNumber(el.value)));
      }
      if (needs.has("trainer") && source.trainers) {
        const el = autoId(document.createElement("select"), "template.trainer");
        for (const c of await source.trainers()) {
          const o = document.createElement("option");
          o.value = String(c.id);
          o.textContent = c.text;
          el.append(o);
        }
        el.value = String(v.trainerId ?? 1);
        row(t.trainer, el);
        readers.push((o) => (o.trainerId = Number(el.value)));
        const nt = source.newTrainer;
        if (nt) {
          // 新しいトレーナー（#245）: 選んだトレーナーを見本にし、番号・名前・クラス・絵・手持ちを入れて trainers.json に書く
          const on = autoId(document.createElement("input"), "template.newTrainer");
          on.type = "checkbox";
          row(jaTrainer.newTrainer, on);
          const id = input("newTrainer.id", hex((await nt.nextId()) ?? 1));
          const name = input("newTrainer.name", jaTrainer.defaultName);
          const cls = autoId(document.createElement("select"), "template.newTrainer.class");
          nt.classes().forEach((c, i) => {
            const o = document.createElement("option");
            o.value = String(i);
            o.textContent = `${hex(i)} ${c}`;
            cls.append(o);
          });
          const pic = input("newTrainer.pic", "0");
          const party = input("newTrainer.party", "");
          party.placeholder = jaTrainer.partyHint;
          const names = document.createElement("div");
          names.className = "tp-note";
          const showNames = (): void => {
            try {
              names.textContent = parseParty(party.value).map((m) => `${nt.speciesName(m.species)} Lv${m.level}`).join("、");
            } catch {
              names.textContent = "";
            }
          };
          party.addEventListener("input", showNames);
          const seed = input("newTrainer.seed", String(1 + Math.floor(Math.random() * 99999)));
          const gen = autoId(
            dialogButton(jaTrainer.generate, () =>
              void nt.generate(parseNumber(seed.value)).then((g) => {
                party.value = partyText(g.party);
                names.textContent = g.note;
                showNames();
                if (g.party.length === 0) names.textContent = g.note;
              }),
            ),
            "template.newTrainer.generate",
          );
          gen.className = "tp-small";
          const copyBase = (): void => {
            const b = nt.base(Number(el.value));
            if (!b) return;
            cls.value = String(b.trainerClass);
            pic.value = String(b.pic);
          };
          el.addEventListener("change", copyBase);
          copyBase();
          row(jaTrainer.id, id);
          row(jaTrainer.name, name);
          row(jaTrainer.trainerClass, cls);
          row(jaTrainer.pic, pic);
          row(jaTrainer.seed, seed, gen);
          row(jaTrainer.party, party);
          form.append(document.createElement("span"), names);
          const sync = (): void => {
            for (const x of [id, name, cls, pic, party, seed, gen]) x.disabled = !on.checked;
          };
          on.addEventListener("change", sync);
          sync();
          readers.push((o) => {
            if (!on.checked) return;
            const b = nt.base(Number(el.value));
            o.newTrainer = {
              id: parseNumber(id.value),
              partyFlags: 0,
              trainerClass: Number(cls.value),
              music: b?.music ?? 0,
              female: b?.female ?? false,
              pic: parseNumber(pic.value),
              name: name.value,
              items: [0, 0, 0, 0],
              doubleBattle: false,
              aiFlags: b?.aiFlags ?? 0,
              party: parseParty(party.value),
            };
          });
        }
      }
      if (needs.has("sight")) {
        const el = input("sight", String(v.sight ?? 5));
        row(t.sight, el);
        readers.push((o) => (o.sight = parseNumber(el.value)));
      }
      if (needs.has("movement")) {
        const el = autoId(document.createElement("select"), "template.facing");
        for (const [key, movement] of Object.entries(FACING_MOVEMENTS)) {
          const o = document.createElement("option");
          o.value = String(movement);
          o.textContent = t.facings[key] ?? key;
          el.append(o);
        }
        el.value = String(v.movementType ?? FACING_MOVEMENTS.down);
        row(t.movement, el);
        readers.push((o) => (o.movementType = Number(el.value)));
      }
      if (needs.has("variable")) {
        const el = input("variable", hex(v.variable ?? 0));
        row(t.variable, el, unusedButton(el, "var", "variable"));
        readers.push((o) => (o.variable = parseNumber(el.value)));
      }
      let ball: HTMLInputElement | null = null;
      if (needs.has("ball")) {
        ball = autoId(document.createElement("input"), "template.ball");
        ball.type = "checkbox";
        ball.checked = v.ball ?? false;
        row(t.ball, ball);
        const b = ball;
        readers.push((o) => (o.ball = b.checked));
      }
      if (needs.has("hiddenId")) {
        const el = input("hiddenId", hex(v.hiddenId ?? 1));
        row(t.hiddenId, el, unusedButton(el, "hiddenItem", "hiddenId"));
        readers.push((o) => (o.hiddenId = parseNumber(el.value)));
      }
      if (needs.has("flag")) {
        const el = input("flag", hex(v.flag ?? 0));
        row(t.flag, el, unusedButton(el, "flag", "flag"));
        readers.push((o) => (o.flag = parseNumber(el.value)));
        if (ball) {
          // 落とし物のフラグは、見えるボール（人）で置くときだけ使う
          const b = ball;
          const sync = (): void => void (el.disabled = !b.checked);
          b.addEventListener("change", sync);
          sync();
        }
      }
      if (needs.has("item")) {
        const el = itemSelect("item", v.item ?? 1);
        row(t.item, el);
        readers.push((o) => (o.item = Number(el.value)));
      }
      if (needs.has("amount")) {
        const el = input("amount", String(v.amount ?? 1));
        row(t.amount, el);
        readers.push((o) => (o.amount = parseNumber(el.value)));
      }
      if (needs.has("martItems")) {
        const el = itemSelect("martItems", 0, true, v.martItems ?? []);
        row(t.martItems, el);
        readers.push((o) => (o.martItems = [...el.selectedOptions].map((x) => Number(x.value))));
      }
      if (needs.has("texts")) {
        const texts: Record<string, () => string> = {};
        for (const x of spec.texts) {
          const el = autoId(document.createElement("textarea"), `template.text.${x.key}`);
          el.rows = 2;
          el.spellcheck = false;
          el.value = v.texts?.[x.key] ?? x.text;
          row(kind === "trainer" && x.key === "after" ? t.trainerAfter : (t.texts[x.key] ?? x.key), el);
          texts[x.key] = () => el.value;
        }
        readers.push((o) => (o.texts = Object.fromEntries(Object.entries(texts).map(([k, f]) => [k, f()]))));
      }
      read = () => {
        const out: TemplateValues = { ...v };
        for (const r of readers) r(out);
        return out;
      };
    };

    const ok = (): void => {
      try {
        finish({ kind, x, y, values: read() });
      } catch (e) {
        void showError(e instanceof Error ? e.message : String(e));
      }
    };
    const buttons = document.createElement("div");
    buttons.className = "dialog-buttons";
    buttons.append(autoId(dialogButton(t.place, ok), "template.place"), autoId(dialogButton(t.cancel, () => finish(null)), "template.cancel"));
    frame.body.append(intro, kindRow, form, buttons);
    handleDialogKeys(frame, () => finish(null));
    frame.register({
      title: t.title,
      text: intro.textContent,
      ...pressable([
        { label: t.place, aliases: ["ok"], run: ok },
        { label: t.cancel, aliases: ["cancel"], run: () => finish(null) },
      ]),
    });
    void build();
    kindSelect.focus();
  });
}
