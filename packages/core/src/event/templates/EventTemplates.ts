import { formatHex } from "../../binary/bytes.js";
import type { ScriptDialect } from "../../script/config/ScriptDialect.js";
import { scriptTextLabel } from "../../script/edit/LabelNaming.js";
import { SCRIPT_TEMPLATE_TEXTS, type ScriptTemplate } from "../../script/edit/ScriptTemplates.js";
import type { EventScriptKind } from "../../script/project/eventScriptKinds.js";
import type { TrainerEntry } from "../../trainer/TrainersJson.js";

/**
 * イベントのひな形（#243・#244）。組み込みの 7 種類だけを持つ（利用者が足す仕組みは作らない。Q11）。
 *
 * ひな形 1 つは、置くイベントの種類、人の欄の既定値、要る入力、`.s` と `.string` に書く中身を決める。
 * 置くのは画面側（TemplatePlacer）で、イベントの追加・欄の値・ラベル・`.s` と `.string` の書き足しを 1 回の取り消しにまとめる。
 * スクリプトの書き方は方言で変える（ND は msgbox に漢字のポインタも書き `_k` の文字列を足す、Chronos は 1 ポインタ）。
 */

/** ひな形の種類。 */
export const EVENT_TEMPLATE_IDS = ["person", "sign", "tile", "hiddenItem", "itemGiver", "mart", "trainer"] as const;
/** ひな形の種類。 */
export type EventTemplateId = (typeof EVENT_TEMPLATE_IDS)[number];

/** ひな形が聞く入力。 */
export type TemplateNeed = "graphics" | "movement" | "flag" | "variable" | "hiddenId" | "item" | "amount" | "ball" | "martItems" | "trainer" | "sight" | "texts";

/** 文の欄 1 つ（既定の文は幅検査の 1 行 18 字・2 行に収める）。 */
export interface TemplateTextSpec {
  readonly key: string;
  /** 文字列のラベルの後ろに付ける名前（`gText_<ラベル><suffix>`）。 */
  readonly suffix: string;
  readonly text: string;
}

/** ひな形 1 つの決まり。 */
export interface EventTemplateSpec {
  readonly id: EventTemplateId;
  /** 置くイベントの種類。 */
  readonly kind: "person" | "sign" | "trap";
  readonly needs: readonly TemplateNeed[];
  readonly texts: readonly TemplateTextSpec[];
  /** eventscripts の種別（スクリプトを持たないひな形は null）。 */
  readonly labelKind: EventScriptKind | null;
  /** ラベル名の `{kind}` に入れる名前。 */
  readonly nameKind: string;
}

/** 動き方の番号（FR の MOVEMENT_TYPE_*）。 */
export const MOVEMENT_FACE_UP = 0x07;
export const MOVEMENT_FACE_DOWN = 0x08;
export const MOVEMENT_FACE_LEFT = 0x09;
export const MOVEMENT_FACE_RIGHT = 0x0a;
/** 向き → 向き固定の動き方。 */
export const FACING_MOVEMENTS: Readonly<Record<"up" | "down" | "left" | "right", number>> = {
  up: MOVEMENT_FACE_UP,
  down: MOVEMENT_FACE_DOWN,
  left: MOVEMENT_FACE_LEFT,
  right: MOVEMENT_FACE_RIGHT,
};

/** OW の見た目の番号（FR の OBJ_EVENT_GFX_*）。 */
export const GFX_YOUNGSTER = 18;
export const GFX_MIDDLE_AGED_MAN = 30;
export const GFX_CLERK = 68;
export const GFX_ITEM_BALL = 92;

/** 隠しアイテムの看板の種別（FR の BG_EVENT_HIDDEN_ITEM）。 */
export const SIGN_KIND_HIDDEN_ITEM = 7;
/** トレーナーの視界の既定（HMA と同じ）。 */
export const DEFAULT_TRAINER_SIGHT = 5;

/** ひな形の一覧（画面の並び）。 */
export const EVENT_TEMPLATES: readonly EventTemplateSpec[] = [
  {
    id: "person",
    kind: "person",
    needs: ["graphics", "texts"],
    texts: [{ key: "text", suffix: "", text: SCRIPT_TEMPLATE_TEXTS.person }],
    labelKind: "npc",
    nameKind: "Npc",
  },
  {
    id: "sign",
    kind: "sign",
    needs: ["texts"],
    texts: [{ key: "text", suffix: "", text: SCRIPT_TEMPLATE_TEXTS.sign }],
    labelKind: "sign",
    nameKind: "Sign",
  },
  {
    id: "tile",
    kind: "trap",
    needs: ["variable", "texts"],
    texts: [{ key: "text", suffix: "", text: SCRIPT_TEMPLATE_TEXTS.tile }],
    labelKind: "tile",
    nameKind: "Tile",
  },
  { id: "hiddenItem", kind: "sign", needs: ["hiddenId", "item", "amount", "ball", "flag"], texts: [], labelKind: null, nameKind: "Item" },
  {
    id: "itemGiver",
    kind: "person",
    needs: ["graphics", "flag", "item", "amount", "texts"],
    texts: [
      { key: "before", suffix: "", text: "これを　あげよう！" },
      { key: "after", suffix: "_After", text: "だいじに　つかってね" },
    ],
    labelKind: "npc",
    nameKind: "Giver",
  },
  { id: "mart", kind: "person", needs: ["graphics", "martItems"], texts: [], labelKind: "npc", nameKind: "Mart" },
  {
    id: "trainer",
    kind: "person",
    needs: ["graphics", "trainer", "sight", "movement", "texts"],
    texts: [
      { key: "intro", suffix: "_Intro", text: "めが　あったら\\nしょうぶだ！" },
      { key: "defeat", suffix: "_Defeat", text: "まけちゃった……" },
      { key: "after", suffix: "_After", text: "つぎは　まけないぞ！" },
    ],
    labelKind: "trainer",
    nameKind: "Trainer",
  },
];

/** ひな形の決まりを引く（無ければ Error）。 */
export function eventTemplate(id: string): EventTemplateSpec {
  const t = EVENT_TEMPLATES.find((x) => x.id === id);
  if (!t) throw new Error(`ひな形がありません: ${id}（${EVENT_TEMPLATE_IDS.join(" / ")}）`);
  return t;
}

/** ひな形の入力の値。省いたものは既定値。 */
export interface TemplateValues {
  graphicsId?: number;
  movementType?: number;
  /** フラグ（アイテムをくれる人。落とし物を人で置くときは人のフラグ）。 */
  flag?: number;
  /** スクリプトタイルの変数。 */
  variable?: number;
  /** 隠しアイテムの番号（フラグは 0x3E8 + 番号）。 */
  hiddenId?: number;
  item?: number;
  amount?: number;
  /** 落とし物を、看板の隠しアイテムでなく、見えるボール（人。Bochi の ItemBalls、HiddenItem.s）で置く。 */
  ball?: boolean;
  /** ショップの品物（道具の番号）。 */
  martItems?: number[];
  /** トレーナーの番号。 */
  trainerId?: number;
  /** トレーナーの視界。 */
  sight?: number;
  /**
   * 新しいトレーナー（#245）。あれば `maps\trainers.json` に足して（同じ番号なら置き換えて）、その番号で置く（`trainerId` は使わない）。
   * 形は TrainerEntry（`trainer/TrainersJson.ts`）。
   */
  newTrainer?: TrainerEntry;
  /** 文（`TemplateTextSpec.key` → 本文）。 */
  texts?: Record<string, string>;
}

/** 入力の既定値（`auto` は索引で選んだ未使用の番号）。 */
export function templateDefaults(id: EventTemplateId, auto: { flag?: number | null; variable?: number | null; hiddenId?: number | null; trainerId?: number | null } = {}): TemplateValues {
  const spec = eventTemplate(id);
  const texts = Object.fromEntries(spec.texts.map((t) => [t.key, t.text]));
  switch (id) {
    case "person":
      return { graphicsId: 0, texts };
    case "sign":
      return { texts };
    case "tile":
      return { variable: auto.variable ?? 0, texts };
    case "hiddenItem":
      return { hiddenId: auto.hiddenId ?? 1, item: 1, amount: 1, ball: false, flag: auto.flag ?? 0 };
    case "itemGiver":
      return { graphicsId: GFX_MIDDLE_AGED_MAN, flag: auto.flag ?? 0, item: 1, amount: 1, texts };
    case "mart":
      return { graphicsId: GFX_CLERK, martItems: [4, 13] };
    case "trainer":
      return { graphicsId: GFX_YOUNGSTER, movementType: MOVEMENT_FACE_DOWN, trainerId: auto.trainerId ?? 1, sight: DEFAULT_TRAINER_SIGHT, texts };
  }
}

/** 入力を確かめる（範囲の外なら Error）。 */
export function checkTemplateValues(id: EventTemplateId, v: TemplateValues): void {
  const need = (name: string, value: number | undefined, min: number, max: number): void => {
    if (value === undefined || !Number.isInteger(value) || value < min || value > max) {
      throw new Error(`${name} は ${min}〜${max} の整数で指定してください（${String(value)}）`);
    }
  };
  if (v.graphicsId !== undefined) need("graphicsId", v.graphicsId, 0, 0xff);
  if (v.movementType !== undefined) need("movementType", v.movementType, 0, 0xff);
  switch (id) {
    case "tile":
      need("variable", v.variable, 0, 0xffff);
      break;
    case "hiddenItem":
      need("item", v.item, 0, 0xffff);
      need("amount", v.amount, 1, 0x7f);
      if (v.ball) need("flag", v.flag, 1, 0xffff);
      else need("hiddenId", v.hiddenId, 0, 0xff);
      break;
    case "itemGiver":
      need("flag", v.flag, 1, 0xffff);
      need("item", v.item, 1, 0xffff);
      need("amount", v.amount, 1, 0xffff);
      break;
    case "mart":
      if (!v.martItems || v.martItems.length === 0) throw new Error("martItems に品物を 1 つ以上指定してください");
      v.martItems.forEach((x, i) => need(`martItems[${i}]`, x, 1, 0xffff));
      break;
    case "trainer":
      need("trainerId", v.newTrainer?.id ?? v.trainerId, 1, 0xffff);
      need("sight", v.sight, 0, 0xffff);
      break;
  }
}

/** 置いたあとに書く欄の値（core の SetEventFields の fields）。 */
export function templateFields(id: EventTemplateId, v: TemplateValues): Record<string, number | boolean> {
  switch (id) {
    case "person":
      return v.graphicsId ? { graphicsId: v.graphicsId } : {};
    case "sign":
      return {};
    case "tile":
      return { variable: v.variable ?? 0, value: 0 };
    case "hiddenItem":
      return v.ball
        ? { graphicsId: GFX_ITEM_BALL, flag: v.flag ?? 0 }
        : { kind: SIGN_KIND_HIDDEN_ITEM, item: v.item ?? 0, flag: v.hiddenId ?? 0, amount: v.amount ?? 1, underfoot: false };
    case "itemGiver":
      return { graphicsId: v.graphicsId ?? GFX_MIDDLE_AGED_MAN, movementType: v.movementType ?? MOVEMENT_FACE_DOWN };
    case "mart":
      return { graphicsId: v.graphicsId ?? GFX_CLERK, movementType: v.movementType ?? MOVEMENT_FACE_DOWN };
    case "trainer":
      return {
        graphicsId: v.graphicsId ?? GFX_YOUNGSTER,
        movementType: v.movementType ?? MOVEMENT_FACE_DOWN,
        trainerType: 1,
        trainerRangeOrBerryTree: v.sight ?? DEFAULT_TRAINER_SIGHT,
        flag: 0,
      };
  }
}

/** ひな形がイベントの種類を「落とし物の人」にするか（ItemBall。スクリプトは HiddenItem.s）。 */
export function templateItemBall(id: EventTemplateId, v: TemplateValues): number | null {
  return id === "hiddenItem" && v.ball ? (v.item ?? 0) : null;
}

/** スクリプトを書くひな形か（隠しアイテムの看板と落とし物の人は書かない）。 */
export function templateHasScript(id: EventTemplateId): boolean {
  return eventTemplate(id).labelKind !== null;
}

/** ラベル名の決め方。トレーナーは eventscripts の `trainer` の行に書けるよう `EventScript_` で始める（insert.py が付ける頭）。 */
export function templateLabelName(id: EventTemplateId, base: string): string {
  return id === "trainer" && !base.startsWith("EventScript_") ? `EventScript_${base}` : base;
}

/** スクリプトを書くときの指定。 */
export interface TemplateScriptOptions {
  readonly dialect: ScriptDialect;
  readonly useGlobal: boolean;
}

/**
 * ひな形の `.s` と `.string`。
 * - 人・看板・スクリプトタイル: Phase2 のひな形（文だけ入力で変えられる）。
 * - アイテムをくれる人: `checkflag` で渡したあとなら別の文。渡したら `setflag`（バッグがいっぱいなら立てない）。
 * - ショップ: `mart` と品物の表（`.hword` の並び、0 で終わる。`.align 1`）。
 * - トレーナー: `trainer 0x0 <番号> 0x0 <戦闘前> <負けたとき>` と戦闘後の `msgbox`（`trainer` は ND も 1 ポインタ。Q4）。
 */
export function templateScript(id: EventTemplateId, label: string, v: TemplateValues, options: TemplateScriptOptions): ScriptTemplate {
  const spec = eventTemplate(id);
  if (!spec.labelKind) throw new Error(`ひな形 ${id} はスクリプトを書きません`);
  const nd = options.dialect === "nd";
  const texts = new Map(spec.texts.map((t) => [t.key, v.texts?.[t.key] ?? t.text]));
  // 文字列の名前は `gText_<ラベル><suffix>`（トレーナーのラベルの頭の `EventScript_` は外す）
  const textBase = label.replace(/^EventScript_/, "");
  const textLabel = (key: string): string => scriptTextLabel(textBase + spec.texts.find((t) => t.key === key)!.suffix);
  const strings: { label: string; text: string }[] = [];
  /** 文字列を足す。`kanji` なら ND の `_k` も足す（msgbox の 2 ポインタ）。 */
  const addText = (key: string, kanji: boolean): string => {
    const name = textLabel(key);
    const text = texts.get(key)!;
    strings.push({ label: name, text });
    if (kanji && nd) strings.push({ label: scriptTextLabel(name.slice("gText_".length), true), text });
    return name;
  };
  const msg = (key: string, type: string): string => {
    const name = addText(key, true);
    return `\tmsgbox ${name} ${type}${nd ? ` ${name}_k` : ""}`;
  };
  const head = (name: string): string[] => (options.useGlobal ? [`.global ${name}`, `${name}:`] : [`${name}:`]);
  let asm: string[];
  switch (id) {
    case "person":
      asm = [...head(label), "\tlock", "\tfaceplayer", msg("text", "MSG_FACE"), "\trelease", "\tend"];
      break;
    case "sign":
      asm = [...head(label), msg("text", "MSG_SIGN"), "\tend"];
      break;
    case "tile":
      asm = [...head(label), "\tlockall", msg("text", "MSG_NORMAL"), "\treleaseall", "\tend"];
      break;
    case "itemGiver": {
      const after = `${label}_After`;
      const end = `${label}_End`;
      const flag = hex(v.flag ?? 0);
      asm = [
        ...head(label),
        "\tlock",
        "\tfaceplayer",
        `\tcheckflag ${flag}`,
        `\tif 0x1 _goto ${after}`,
        msg("before", "MSG_NORMAL"),
        // giveitem マクロは ND・Chronos とも中の setorcopyvar が無くて組めないので、同じ命令を直接書く
        `\tsetvarifnotzero 0x8000 ${hex(v.item ?? 0)}`,
        `\tsetvarifnotzero 0x8001 ${hex(v.amount ?? 1)}`,
        "\tcallstd MSG_OBTAIN",
        "\tcompare LASTRESULT 0x0",
        `\tif 0x1 _goto ${end}`,
        `\tsetflag ${flag}`,
        "\trelease",
        "\tend",
        "",
        `${after}:`,
        msg("after", "MSG_NORMAL"),
        `${end}:`,
        "\trelease",
        "\tend",
      ];
      break;
    }
    case "mart": {
      const list = `${label}_Mart1`;
      asm = [
        ...head(label),
        "\tlock",
        "\tfaceplayer",
        `\tmart ${list}`,
        "\trelease",
        "\tend",
        "",
        ".align 1",
        `${list}:`,
        ...(v.martItems ?? []).map((x) => `\t.hword ${hex(x)}`),
        "\t.hword 0x0",
      ];
      break;
    }
    case "trainer": {
      const intro = addText("intro", false);
      const defeat = addText("defeat", false);
      asm = [...head(label), `\ttrainer 0x0 ${hex(v.newTrainer?.id ?? v.trainerId ?? 0)} 0x0 ${intro} ${defeat}`, msg("after", "MSG_NORMAL"), "\tend"];
      break;
    }
    default:
      throw new Error(`ひな形 ${id} はスクリプトを書きません`);
  }
  return { label, asm, strings };
}

function hex(n: number): string {
  return `0x${formatHex(n)}`;
}
