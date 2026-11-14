import type { Command, EditorContext, JsonObject, JsonValue } from "../../command/Command.js";
import type { CommandFactory, CommandRegistry } from "../../command/CommandRegistry.js";
import { argEnum, argInt, argOptInt, argString, type Args } from "../../command/jsonArgs.js";
import { isScriptLabelName } from "../edit/LabelNaming.js";
import { isMapScriptTableType, isMapScriptTarget, type MapScriptTableModel } from "../edit/MapScriptTableText.js";
import { parseEventScriptKind, type EventScriptKind } from "../project/eventScriptKinds.js";
import { EVENT_LABEL_TARGETS, type EventLabelSnapshot, type EventLabelStore, type EventLabelTarget, type EventPositions } from "./EventLabelStore.js";

/** ラベルを編集するコマンドが使う入口。 */
export interface EventLabelContext extends EditorContext {
  /** イベントのラベル。プロジェクトフォルダが無いときは Error。 */
  eventLabels(): EventLabelStore;
  /** マップの今のイベントの座標（照合用）。 */
  eventPositions?(bank: number, map: number): EventPositions;
}

/** EditorContext が EventLabelContext か。 */
export function isEventLabelContext(context: EditorContext): context is EventLabelContext {
  return typeof (context as Partial<EventLabelContext>).eventLabels === "function";
}

/** EditorContext を EventLabelContext として使う。違えば Error。 */
export function eventLabelContext(context: EditorContext): EventLabelContext {
  if (!isEventLabelContext(context)) throw new Error("このコマンドにはイベントのラベル（eventLabels()）が必要です");
  return context;
}

/** 既存の入口に `eventLabels()`（と `eventPositions()`）を足したものを作る（withScriptsTable と同じ作り）。 */
export function withEventLabels<T extends EditorContext>(
  base: T,
  get: () => EventLabelStore,
  positions?: (bank: number, map: number) => EventPositions,
): T & EventLabelContext {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "eventLabels") return get;
      if (prop === "eventPositions" && positions) return positions;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    has(target, prop) {
      return prop === "eventLabels" || (prop === "eventPositions" && !!positions) || Reflect.has(target, prop);
    },
  }) as T & EventLabelContext;
}

/** ラベルの名前が使えないとき。 */
export class EventLabelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventLabelError";
  }
}

function checkLabel(label: string): void {
  if (!isScriptLabelName(label)) throw new EventLabelError(`ラベルに使えない名前です: "${label}"（半角の英字・数字・_ . $ で、数字で始めない）`);
}

/** ラベルを変えるコマンドの土台。実行前に控えを取り、取り消しで戻す。 */
abstract class EventLabelCommand<A extends JsonObject> implements Command<A> {
  abstract readonly name: string;
  private saved: EventLabelSnapshot | null = null;

  constructor(readonly args: A) {}

  do(context: EditorContext): void {
    const ctx = eventLabelContext(context);
    const store = ctx.eventLabels();
    const before = store.snapshot();
    try {
      this.apply(store, ctx);
    } catch (e) {
      store.restore(before);
      throw e;
    }
    this.saved = before;
  }

  undo(context: EditorContext): void {
    if (this.saved) eventLabelContext(context).eventLabels().restore(this.saved);
  }

  protected abstract apply(store: EventLabelStore, context: EventLabelContext): void;
}

/** 「イベントのラベルを変える」の引数。`target` が `map` ならマップスクリプトの表のラベル（番号は使わない）。 */
export type SetEventLabelArgs = {
  bank: number;
  map: number;
  target: EventLabelTarget | "map";
  index?: number;
  /** null でラベルを外す（eventscripts の行を消す）。 */
  label: string | null;
  /** 人の eventscripts の種別（`npc` / `trainer` / `item`。省略で今の種別か `npc`）。 */
  kind?: EventScriptKind;
};

const LABEL_TARGETS = [...EVENT_LABEL_TARGETS, "map"] as const;
const PERSON_KINDS: readonly EventScriptKind[] = ["npc", "trainer", "item"];

/** イベントのスクリプトのラベルを変える（出力のときに scripts_MM.json と eventscripts に書く）。 */
export class SetEventLabelCommand extends EventLabelCommand<SetEventLabelArgs & JsonObject> {
  static readonly NAME = "setEventLabel";
  readonly name = SetEventLabelCommand.NAME;

  static fromJson(args: Args): SetEventLabelCommand {
    const label = args["label"];
    if (label !== null && typeof label !== "string") throw new TypeError("引数 label は文字列か null でなければなりません");
    const out: SetEventLabelArgs = { bank: argInt(args, "bank"), map: argInt(args, "map"), target: argEnum(args, "target", LABEL_TARGETS), label };
    const index = argOptInt(args, "index");
    if (index !== undefined) out.index = index;
    if (args["kind"] !== undefined) out.kind = argEnum(args, "kind", PERSON_KINDS as EventScriptKind[]);
    return new SetEventLabelCommand(out);
  }

  constructor(args: SetEventLabelArgs) {
    super(args as SetEventLabelArgs & JsonObject);
  }

  protected apply(store: EventLabelStore): void {
    const { bank, map, target, label } = this.args;
    if (label !== null) checkLabel(label);
    if (target === "map") return store.setMapScripts(bank, map, label);
    const index = this.args.index ?? 0;
    if (!Number.isInteger(index) || index < 0 || index > 255) throw new EventLabelError(`番号が不正です: ${index}`);
    if (label === null) return store.set(bank, map, target, index, null);
    const old = store.label(bank, map, target, index);
    const kind = target === "person" ? (this.args.kind ?? (old && PERSON_KINDS.includes(old.kind) ? old.kind : "npc")) : target;
    if (parseEventScriptKind(kind) === null) throw new EventLabelError(`種別が不正です: ${kind}`);
    store.set(bank, map, target, index, { label, kind });
  }
}

/** 「新しいイベントにラベルを付ける」の引数（ひな形を書くときに使う。`events` の順に付ける）。 */
export type AssignEventLabelsArgs = {
  bank: number;
  map: number;
  events: { target: EventLabelTarget; index: number; label: string }[];
  /** ひな形を `.s` に書くか（書くのはメインウィンドウ。コマンドはラベルだけを変える）。 */
  template?: boolean;
};

/** 新しいイベントにラベルをまとめて付ける（`.s` を新しく作ったあと、置いたイベントにひな形を書くとき）。 */
export class AssignEventLabelsCommand extends EventLabelCommand<AssignEventLabelsArgs & JsonObject> {
  static readonly NAME = "assignEventLabels";
  readonly name = AssignEventLabelsCommand.NAME;

  static fromJson(args: Args): AssignEventLabelsCommand {
    const list = args["events"];
    if (!Array.isArray(list)) throw new TypeError("引数 events は配列でなければなりません");
    const events = list.map((e) => {
      const o = e as Args;
      return { target: argEnum(o, "target", EVENT_LABEL_TARGETS), index: argInt(o, "index"), label: argString(o, "label") };
    });
    return new AssignEventLabelsCommand({ bank: argInt(args, "bank"), map: argInt(args, "map"), events, template: args["template"] === true });
  }

  constructor(args: AssignEventLabelsArgs) {
    super(args as AssignEventLabelsArgs & JsonObject);
  }

  protected apply(store: EventLabelStore): void {
    for (const e of this.args.events) {
      checkLabel(e.label);
      store.set(this.args.bank, this.args.map, e.target, e.index, { label: e.label, kind: e.target === "person" ? "npc" : e.target });
    }
  }
}

/** 「ラベル名を変える」の引数。 */
export type RenameEventLabelArgs = { from: string; to: string };

/**
 * ラベル名の変更（エディタで定義の名前を変えたとき）を、すべてのイベントとマップスクリプトの表に反映する。
 * `.s` の本文はエディタが書き換える（このコマンドは eventscripts とイベントの側だけを変える）。
 */
export class RenameEventLabelCommand extends EventLabelCommand<RenameEventLabelArgs & JsonObject> {
  static readonly NAME = "renameEventLabel";
  readonly name = RenameEventLabelCommand.NAME;

  static fromJson(args: Args): RenameEventLabelCommand {
    return new RenameEventLabelCommand({ from: argString(args, "from"), to: argString(args, "to") });
  }

  constructor(args: RenameEventLabelArgs) {
    super(args as RenameEventLabelArgs & JsonObject);
  }

  protected apply(store: EventLabelStore): void {
    checkLabel(this.args.to);
    store.rename(this.args.from, this.args.to);
  }
}

/** 「マップスクリプトの表を変える」の引数（`table` が null なら表をやめる）。 */
export type SetMapScriptTableArgs = { bank: number; map: number; table: JsonValue };

/** ZigzaguMap が `.s` に書くマップスクリプトの表を変える（出力のときに `.s` の表と eventscripts の `map` の行を書く）。 */
export class SetMapScriptTableCommand extends EventLabelCommand<SetMapScriptTableArgs & JsonObject> {
  static readonly NAME = "setMapScriptTable";
  readonly name = SetMapScriptTableCommand.NAME;

  static fromJson(args: Args): SetMapScriptTableCommand {
    return new SetMapScriptTableCommand({ bank: argInt(args, "bank"), map: argInt(args, "map"), table: (args["table"] ?? null) as JsonValue });
  }

  constructor(args: SetMapScriptTableArgs) {
    super(args as SetMapScriptTableArgs & JsonObject);
  }

  protected apply(store: EventLabelStore): void {
    store.setTable(this.args.bank, this.args.map, readTable(this.args.table));
  }
}

/** 表の JSON（`{ label, items: [{ type, script, conditions: [{ variable, value, script }] }] }`）を確かめて読む。 */
export function readTable(value: JsonValue): MapScriptTableModel | null {
  if (value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) throw new TypeError("引数 table はオブジェクトか null でなければなりません");
  const label = value["label"];
  if (typeof label !== "string") throw new TypeError("table.label は文字列でなければなりません");
  checkLabel(label);
  const items = value["items"];
  if (!Array.isArray(items)) throw new TypeError("table.items は配列でなければなりません");
  const seen = new Set<number>();
  return {
    label,
    items: items.map((raw, i) => {
      const o = raw as Args;
      const type = argInt(o, "type");
      if (type < 1 || type > 7) throw new EventLabelError(`${i + 1} 件目の種類は 1〜7 でなければなりません: ${type}`);
      if (seen.has(type)) throw new EventLabelError(`同じ種類が 2 つあります: ${type}`);
      seen.add(type);
      if (!isMapScriptTableType(type)) {
        const script = argString(o, "script");
        if (!isMapScriptTarget(script)) throw new EventLabelError(`${i + 1} 件目の行き先が不正です: "${script}"`);
        return { type, script, conditions: [] };
      }
      const conditions = o["conditions"];
      if (!Array.isArray(conditions)) throw new TypeError(`${i + 1} 件目の conditions は配列でなければなりません`);
      return {
        type,
        script: "",
        conditions: conditions.map((c, j) => {
          const r = c as Args;
          const variable = argInt(r, "variable");
          const v = argInt(r, "value");
          const script = argString(r, "script");
          if (variable <= 0 || variable > 0xffff) throw new EventLabelError(`${i + 1} 件目の ${j + 1} 行目の変数は 1〜0xFFFF です: ${variable}`);
          if (v < 0 || v > 0xffff) throw new EventLabelError(`${i + 1} 件目の ${j + 1} 行目の値は 0〜0xFFFF です: ${v}`);
          if (!isMapScriptTarget(script)) throw new EventLabelError(`${i + 1} 件目の ${j + 1} 行目の行き先が不正です: "${script}"`);
          return { variable, value: v, script };
        }),
      };
    }),
  };
}

/** 表を JSON の形にする（コマンドの引数用）。 */
export function tableArgs(table: MapScriptTableModel | null): JsonValue {
  if (!table) return null;
  return {
    label: table.label,
    items: table.items.map((i) => ({ type: i.type, script: i.script, conditions: i.conditions.map((c) => ({ variable: c.variable, value: c.value, script: c.script })) })),
  };
}

/** 「座標でラベルを付け直す」の引数。 */
export type RealignEventLabelsArgs = { bank: number; map: number };

/** scripts_MM.json に書いた座標と合わないラベルを、その座標にあるイベントへ付け替える（Bochi で順を変えたとき）。 */
export class RealignEventLabelsCommand extends EventLabelCommand<RealignEventLabelsArgs & JsonObject> {
  static readonly NAME = "realignEventLabels";
  readonly name = RealignEventLabelsCommand.NAME;

  static fromJson(args: Args): RealignEventLabelsCommand {
    return new RealignEventLabelsCommand({ bank: argInt(args, "bank"), map: argInt(args, "map") });
  }

  constructor(args: RealignEventLabelsArgs) {
    super(args as RealignEventLabelsArgs & JsonObject);
  }

  protected apply(store: EventLabelStore, context: EventLabelContext): void {
    if (!context.eventPositions) throw new Error("イベントの座標が読めません");
    store.realign(this.args.bank, this.args.map, context.eventPositions(this.args.bank, this.args.map));
  }
}

/** ラベルのコマンド（名前と作り方）。EventLabelContext が要る。 */
export const EVENT_LABEL_COMMANDS: readonly { readonly name: string; readonly fromJson: CommandFactory }[] = [
  SetEventLabelCommand,
  AssignEventLabelsCommand,
  RenameEventLabelCommand,
  SetMapScriptTableCommand,
  RealignEventLabelsCommand,
].map((c) => ({ name: c.NAME, fromJson: c.fromJson as CommandFactory }));

/** ラベルのコマンドを表に登録する。 */
export function registerEventLabelCommands(registry: CommandRegistry): CommandRegistry {
  for (const c of EVENT_LABEL_COMMANDS) registry.register(c.name, c.fromJson);
  return registry;
}
