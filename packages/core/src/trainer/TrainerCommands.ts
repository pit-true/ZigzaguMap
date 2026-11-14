import type { Command, EditorContext, JsonObject } from "../command/Command.js";
import type { CommandFactory, CommandRegistry } from "../command/CommandRegistry.js";
import { argInt, type Args } from "../command/jsonArgs.js";
import { cloneTrainer, type TrainerEntry, type TrainersProject } from "../project/TrainersJson.js";
import type { TrainerMon } from "./TrainerTable.js";

/** トレーナーを編集するコマンドが使う入口。 */
export interface TrainersContext extends EditorContext {
  /** `maps\trainers.json`。プロジェクトフォルダが無いときは Error。 */
  trainers(): TrainersProject;
}

/** 既存の入口に `trainers()` を足したものを作る（withRomErase と同じ作り）。 */
export function withTrainers<T extends EditorContext>(base: T, get: () => TrainersProject): T & TrainersContext {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === "trainers") return get;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
    has(target, prop) {
      return prop === "trainers" || Reflect.has(target, prop);
    },
  }) as T & TrainersContext;
}

function trainersOf(context: EditorContext): TrainersProject {
  const get = (context as Partial<TrainersContext>).trainers;
  if (typeof get !== "function") throw new Error("このコマンドにはトレーナー（trainers()）が必要です");
  return get.call(context);
}

/** JSON の引数からトレーナー 1 件を読む（形は trainers.json の 1 件を小文字で始めた名前。`trainer.list` の返事と同じ）。 */
export function trainerFromArgs(o: Args): TrainerEntry {
  const party = o["party"];
  if (!Array.isArray(party)) throw new TypeError("引数 trainer.party は配列でなければなりません");
  const t: TrainerEntry = {
    id: argInt(o, "id"),
    partyFlags: typeof o["partyFlags"] === "number" ? o["partyFlags"] : 0,
    trainerClass: argInt(o, "trainerClass"),
    music: typeof o["music"] === "number" ? o["music"] : 0,
    female: o["female"] === true,
    pic: argInt(o, "pic"),
    name: typeof o["name"] === "string" ? o["name"] : "",
    items: Array.isArray(o["items"]) ? (o["items"] as number[]) : [0, 0, 0, 0],
    doubleBattle: o["doubleBattle"] === true,
    aiFlags: typeof o["aiFlags"] === "number" ? o["aiFlags"] : 0,
    party: party.map((p) => {
      const m = p as Args;
      const mon: TrainerMon = { iv: typeof m["iv"] === "number" ? m["iv"] : 0, level: argInt(m, "level"), species: argInt(m, "species") };
      if (typeof m["heldItem"] === "number") mon.heldItem = m["heldItem"];
      if (Array.isArray(m["moves"])) mon.moves = m["moves"] as number[];
      return mon;
    }),
  };
  if (typeof o["label"] === "string") t.label = o["label"];
  return t;
}

/**
 * 「トレーナーを足す・変える」の引数。`bank`・`map` は置いたマップ（ひな形と同じ CommandGroup にまとめたとき、
 * 画面がそのマップを描き直して未出力の印を付けるため。trainers.json には書かない）。
 */
export type SetTrainerArgs = { trainer: TrainerEntry; bank?: number; map?: number };

/** trainers.json にトレーナーを足すか置き換える（`SetTrainer`。同じ番号が無ければ足す）。取り消すと前に戻る。 */
export class SetTrainerCommand implements Command<SetTrainerArgs & JsonObject> {
  static readonly NAME = "setTrainer";
  readonly name = SetTrainerCommand.NAME;
  readonly args: SetTrainerArgs & JsonObject;
  private before: TrainerEntry | undefined | null = null;

  static fromJson(args: Args): SetTrainerCommand {
    const out: SetTrainerArgs = { trainer: trainerFromArgs(args["trainer"] as Args) };
    if (typeof args["bank"] === "number" && typeof args["map"] === "number") Object.assign(out, { bank: args["bank"], map: args["map"] });
    return new SetTrainerCommand(out);
  }

  constructor(args: SetTrainerArgs) {
    this.args = { ...args, trainer: cloneTrainer(args.trainer) } as unknown as SetTrainerArgs & JsonObject;
  }

  do(context: EditorContext): void {
    const p = trainersOf(context);
    const old = p.get(this.args.trainer.id);
    p.set(this.args.trainer);
    this.before = old ? cloneTrainer(old) : undefined;
  }

  undo(context: EditorContext): void {
    const p = trainersOf(context);
    if (this.before === null) return;
    if (this.before === undefined) p.remove(this.args.trainer.id);
    else p.set(this.before);
  }
}

/** 「トレーナーを消す」の引数。 */
export type RemoveTrainerArgs = { id: number };

/** trainers.json からトレーナーを消す（ROM の元の表に戻る）。取り消すと戻る。 */
export class RemoveTrainerCommand implements Command<RemoveTrainerArgs & JsonObject> {
  static readonly NAME = "removeTrainer";
  readonly name = RemoveTrainerCommand.NAME;
  readonly args: RemoveTrainerArgs & JsonObject;
  private before: TrainerEntry | null = null;

  static fromJson(args: Args): RemoveTrainerCommand {
    return new RemoveTrainerCommand({ id: argInt(args, "id") });
  }

  constructor(args: RemoveTrainerArgs) {
    this.args = { ...args } as RemoveTrainerArgs & JsonObject;
  }

  do(context: EditorContext): void {
    const p = trainersOf(context);
    const old = p.get(this.args.id);
    if (!old) throw new Error(`trainers.json にトレーナー ${this.args.id} はありません`);
    this.before = cloneTrainer(old);
    p.remove(this.args.id);
  }

  undo(context: EditorContext): void {
    if (this.before) trainersOf(context).set(this.before);
  }
}

/** トレーナーのコマンドを表に登録する（`AddTrainer` は `setTrainer` で同じ番号が無いとき）。 */
export function registerTrainerCommands(registry: CommandRegistry): CommandRegistry {
  registry.register(SetTrainerCommand.NAME, SetTrainerCommand.fromJson as CommandFactory);
  registry.register(RemoveTrainerCommand.NAME, RemoveTrainerCommand.fromJson as CommandFactory);
  return registry;
}
