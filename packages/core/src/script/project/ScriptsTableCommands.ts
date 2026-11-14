import type { Command, EditorContext, JsonObject } from "../../command/Command.js";
import type { CommandFactory, CommandRegistry } from "../../command/CommandRegistry.js";
import { EditError, EditErrorCode, checkRange } from "../../command/EditError.js";
import { argBool, argInt, argOptInt, type Args } from "../../command/jsonArgs.js";
import { defaultScriptsJsonStringsPath, type ScriptsJsonEntry } from "./ScriptsJson.js";
import { scriptsTableContext, type ScriptsTableDocument, type ScriptsTableSnapshot } from "./ScriptsTableDocument.js";

/** 新しく作る `.s` を置くフォルダ。 */
export const OVERWORLD_SCRIPTS_DIR = "assembly/overworld_scripts";
/** 新しく作る `.string` を置くフォルダ。 */
export const STRINGS_DIR = "strings";

/** コマンドの引数の 1 行（JSON の形）。`map` が null ならバンク全体、`strings` が null なら既定の名前。 */
export type ScriptsTableEntryArgs = {
  bank: number;
  map: number | null;
  name: string;
  script: string;
  strings: string | null;
};

/** パスが使えない理由。 */
export type ScriptPathProblem = "empty" | "absolute" | "parent" | "extension" | "folder" | "chars";

/** 新しく作るファイルの名前に使える字（アセンブラとビルドのスクリプトがそのまま扱える ASCII）。 */
const SAFE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]*$/;

/** パスの区切りを `/` にそろえ、前後の空白を除く。 */
export function normalizeScriptPath(path: string): string {
  return path.trim().replace(/\\/g, "/");
}

/**
 * 対応表に書ける `.s` / `.string` のパスか確かめる（プロジェクトフォルダからの相対、`..` なし、拡張子が合う）。
 * `create` なら、新しく作れる場所（`.s` は assembly/overworld_scripts、`.string` は strings の直下）と名前か。問題が無ければ null。
 */
export function scriptPathProblem(kind: "script" | "strings", path: string, create = false): ScriptPathProblem | null {
  if (path === "") return "empty";
  if (path.startsWith("/") || /^[A-Za-z]:/.test(path)) return "absolute";
  const parts = path.split("/");
  if (parts.some((p) => p === ".." || p === "." || p === "")) return "parent";
  const ext = kind === "script" ? ".s" : ".string";
  if (!path.endsWith(ext) || path.length === ext.length) return "extension";
  if (create) {
    const dir = kind === "script" ? OVERWORLD_SCRIPTS_DIR : STRINGS_DIR;
    if (parts.slice(0, -1).join("/") !== dir) return "folder";
    if (!SAFE_NAME.test(parts[parts.length - 1]!)) return "chars";
  }
  return null;
}

/** ファイル名の入力（`03_00_masara` か `03_00_masara.s`）から作る `.s` のパス。 */
export function newScriptPath(fileName: string): string {
  const name = fileName.trim().replace(/\.s$/, "");
  return `${OVERWORLD_SCRIPTS_DIR}/${name}.s`;
}

function checkPath(field: "script" | "strings", path: string, create: boolean): void {
  const reason = scriptPathProblem(field, path, create);
  if (reason) throw new EditError(EditErrorCode.InvalidScriptPath, { field, path, reason });
}

/** 引数の 1 行を確かめて、表の 1 行にする（`extra` は残すもの）。 */
function toEntry(a: ScriptsTableEntryArgs, extra: ScriptsJsonEntry["extra"], create: boolean): ScriptsJsonEntry {
  checkRange("bank", a.bank, 0, 255);
  if (a.map !== null) checkRange("map", a.map, 0, 255);
  const script = normalizeScriptPath(a.script);
  checkPath("script", script, create);
  const stringsText = a.strings === null ? "" : normalizeScriptPath(a.strings);
  const strings = stringsText === "" ? null : stringsText;
  if (strings !== null) checkPath("strings", strings, create);
  else if (create) checkPath("strings", defaultScriptsJsonStringsPath(script), true);
  return { bank: a.bank, map: a.map, name: a.name, script, strings, extra };
}

function checkIndex(doc: ScriptsTableDocument, index: number, count = doc.count - 1): void {
  if (!Number.isInteger(index) || index < 0 || index > count) {
    throw new EditError(EditErrorCode.ScriptsTableIndexOutOfRange, { index, count: doc.count });
  }
}

function readEntry(args: Args): ScriptsTableEntryArgs {
  const e = args["entry"];
  if (typeof e !== "object" || e === null || Array.isArray(e)) throw new TypeError("引数 entry はオブジェクトでなければなりません");
  const o = e as Args;
  const text = (key: string, nullable: boolean): string | null => {
    const v = o[key];
    if ((v === undefined || v === null) && nullable) return null;
    if (typeof v !== "string") throw new TypeError(`引数 entry.${key} は文字列でなければなりません`);
    return v;
  };
  const map = o["map"] === undefined || o["map"] === null ? null : argInt(o, "map");
  return { bank: argInt(o, "bank"), map, name: text("name", true) ?? "", script: text("script", false)!, strings: text("strings", true) };
}

/** 行の引数を JSON にできる形にする。 */
export function entryArgs(e: ScriptsJsonEntry): ScriptsTableEntryArgs {
  return { bank: e.bank, map: e.map, name: e.name, script: e.script, strings: e.strings };
}

/** 対応表のコマンドの土台。実行前に行の並びの控えを取り、取り消しで戻す。 */
abstract class ScriptsTableCommand<A extends JsonObject> implements Command<A> {
  abstract readonly name: string;
  private saved: ScriptsTableSnapshot | null = null;

  constructor(readonly args: A) {}

  do(context: EditorContext): void {
    const doc = scriptsTableContext(context).scriptsTable();
    const before = doc.snapshot();
    this.apply(doc);
    this.saved = before;
  }

  undo(context: EditorContext): void {
    if (this.saved) scriptsTableContext(context).scriptsTable().restore(this.saved);
  }

  /** 変える（入力の確認を先に行う。EditError を投げたときは何も変わらない）。 */
  protected abstract apply(doc: ScriptsTableDocument): void;
}

/** 「行を足す」の引数。 */
export type AddScriptsTableEntryArgs = {
  entry: ScriptsTableEntryArgs;
  /** 入れる位置（省略で末尾）。 */
  index?: number;
  /** 出力のときに `.s`（決まった先頭）と空の `.string` を作る。既にあるファイルは書き換えない。 */
  create?: boolean;
};

/** 対応表に行を足す（`create` なら、出力のときに新しい `.s` と `.string` も作る）。 */
export class AddScriptsTableEntryCommand extends ScriptsTableCommand<AddScriptsTableEntryArgs & JsonObject> {
  static readonly NAME = "addScriptsTableEntry";
  readonly name = AddScriptsTableEntryCommand.NAME;

  static fromJson(args: Args): AddScriptsTableEntryCommand {
    const out: AddScriptsTableEntryArgs = { entry: readEntry(args) };
    const index = argOptInt(args, "index");
    if (index !== undefined) out.index = index;
    if (args["create"] !== undefined) out.create = argBool(args, "create");
    return new AddScriptsTableEntryCommand(out);
  }

  constructor(args: AddScriptsTableEntryArgs) {
    super(args as AddScriptsTableEntryArgs & JsonObject);
  }

  protected apply(doc: ScriptsTableDocument): void {
    const create = this.args.create === true;
    const index = this.args.index ?? doc.count;
    checkIndex(doc, index, doc.count);
    doc.insert(index, { entry: toEntry(this.args.entry, {}, create), create });
  }
}

/** 「行を変える」の引数。 */
export type SetScriptsTableEntryArgs = { index: number; entry: ScriptsTableEntryArgs };

/** 対応表の行を書き換える（知らない項目と、新しく作るかどうかは残す）。 */
export class SetScriptsTableEntryCommand extends ScriptsTableCommand<SetScriptsTableEntryArgs & JsonObject> {
  static readonly NAME = "setScriptsTableEntry";
  readonly name = SetScriptsTableEntryCommand.NAME;

  static fromJson(args: Args): SetScriptsTableEntryCommand {
    return new SetScriptsTableEntryCommand({ index: argInt(args, "index"), entry: readEntry(args) });
  }

  constructor(args: SetScriptsTableEntryArgs) {
    super(args as SetScriptsTableEntryArgs & JsonObject);
  }

  protected apply(doc: ScriptsTableDocument): void {
    checkIndex(doc, this.args.index);
    const row = doc.rows[this.args.index]!;
    doc.replace(this.args.index, { entry: toEntry(this.args.entry, row.entry.extra, row.create), create: row.create });
  }
}

/** 「行を消す」の引数。 */
export type RemoveScriptsTableEntryArgs = { index: number };

/** 対応表の行を消す（ファイルは消さない）。 */
export class RemoveScriptsTableEntryCommand extends ScriptsTableCommand<RemoveScriptsTableEntryArgs & JsonObject> {
  static readonly NAME = "removeScriptsTableEntry";
  readonly name = RemoveScriptsTableEntryCommand.NAME;

  static fromJson(args: Args): RemoveScriptsTableEntryCommand {
    return new RemoveScriptsTableEntryCommand({ index: argInt(args, "index") });
  }

  constructor(args: RemoveScriptsTableEntryArgs) {
    super(args as RemoveScriptsTableEntryArgs & JsonObject);
  }

  protected apply(doc: ScriptsTableDocument): void {
    checkIndex(doc, this.args.index);
    doc.remove(this.args.index);
  }
}

/** 「行を動かす」の引数。 */
export type MoveScriptsTableEntryArgs = { index: number; to: number };

/** 対応表の行を動かす（同じバンク・マップの行が複数あるときは前の行が使われる）。 */
export class MoveScriptsTableEntryCommand extends ScriptsTableCommand<MoveScriptsTableEntryArgs & JsonObject> {
  static readonly NAME = "moveScriptsTableEntry";
  readonly name = MoveScriptsTableEntryCommand.NAME;

  static fromJson(args: Args): MoveScriptsTableEntryCommand {
    return new MoveScriptsTableEntryCommand({ index: argInt(args, "index"), to: argInt(args, "to") });
  }

  constructor(args: MoveScriptsTableEntryArgs) {
    super(args as MoveScriptsTableEntryArgs & JsonObject);
  }

  protected apply(doc: ScriptsTableDocument): void {
    checkIndex(doc, this.args.index);
    checkIndex(doc, this.args.to);
    doc.move(this.args.index, this.args.to);
  }
}

/** 対応表のコマンド（名前と作り方）。ScriptsTableContext が要る。 */
export const SCRIPTS_TABLE_COMMANDS: readonly { readonly name: string; readonly fromJson: CommandFactory }[] = [
  AddScriptsTableEntryCommand,
  SetScriptsTableEntryCommand,
  RemoveScriptsTableEntryCommand,
  MoveScriptsTableEntryCommand,
].map((c) => ({ name: c.NAME, fromJson: c.fromJson as CommandFactory }));

/** 対応表のコマンドを表に登録する。 */
export function registerScriptsTableCommands(registry: CommandRegistry): CommandRegistry {
  for (const c of SCRIPTS_TABLE_COMMANDS) registry.register(c.name, c.fromJson);
  return registry;
}
