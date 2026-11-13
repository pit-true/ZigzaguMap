import type { MapDocument } from "../../../model/MapDocument.js";
import { EditError, EditErrorCode, checkRange } from "../../EditError.js";
import { argInt, argMapId, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { MapScriptsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { checkConditionVariable, checkScriptLimit, requireTable } from "./mapScriptChecks.js";

/** 「条件表の行を追加する」の引数。 */
export type AddMapScriptConditionArgs = MapArgs & {
  /** マップスクリプトの番号（種類 2・4）。 */
  index: number;
  /** 条件の変数（1〜0xFFFF）。 */
  variable: number;
  /** 条件の値。 */
  value: number;
  /** スクリプトのポインタ。 */
  script: number;
};

/** 「条件表の行を追加する」コマンド。終端の行の手前（末尾）に足す。 */
export class AddMapScriptConditionCommand extends MapScriptsCommand<AddMapScriptConditionArgs> {
  static readonly NAME = "addMapScriptCondition";
  readonly name = AddMapScriptConditionCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): AddMapScriptConditionCommand {
    return new AddMapScriptConditionCommand({
      ...argMapId(args),
      index: argInt(args, "index"),
      variable: argInt(args, "variable"),
      value: argInt(args, "value"),
      script: argInt(args, "script"),
    });
  }

  protected edit(doc: MapDocument): void {
    const table = requireTable(doc, this.args.index);
    const row = {
      variable: checkConditionVariable(this.args.variable),
      value: checkRange("value", this.args.value, 0, 0xffff),
      script: checkRange("script", this.args.script, 0, 0xffffffff),
    };
    checkScriptLimit(table.entries.length);
    table.entries.push(row);
  }
}

/** 「条件表の行を削除する」の引数。 */
export type RemoveMapScriptConditionArgs = MapArgs & { index: number; row: number };

/** 「条件表の行を削除する」コマンド。後ろの行が詰まる。 */
export class RemoveMapScriptConditionCommand extends MapScriptsCommand<RemoveMapScriptConditionArgs> {
  static readonly NAME = "removeMapScriptCondition";
  readonly name = RemoveMapScriptConditionCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): RemoveMapScriptConditionCommand {
    return new RemoveMapScriptConditionCommand({ ...argMapId(args), index: argInt(args, "index"), row: argInt(args, "row") });
  }

  protected edit(doc: MapDocument): void {
    const table = requireTable(doc, this.args.index);
    requireRow(table.entries.length, this.args.index, this.args.row);
    table.entries.splice(this.args.row, 1);
  }
}

/** 「条件表の行を変える」の引数。省略した項目は変えない。 */
export type SetMapScriptConditionArgs = MapArgs & { index: number; row: number; variable?: number; value?: number; script?: number };

/** 「条件表の行を変える」コマンド（フラグ・フラグの値・フラグのオフセットの欄）。 */
export class SetMapScriptConditionCommand extends MapScriptsCommand<SetMapScriptConditionArgs> {
  static readonly NAME = "setMapScriptCondition";
  readonly name = SetMapScriptConditionCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetMapScriptConditionCommand {
    return new SetMapScriptConditionCommand(
      compactArgs({
        ...argMapId(args),
        index: argInt(args, "index"),
        row: argInt(args, "row"),
        variable: argOptInt(args, "variable"),
        value: argOptInt(args, "value"),
        script: argOptInt(args, "script"),
      }) as SetMapScriptConditionArgs,
    );
  }

  protected edit(doc: MapDocument): void {
    const { index, row, variable, value, script } = this.args;
    const table = requireTable(doc, index);
    requireRow(table.entries.length, index, row);
    const entry = table.entries[row]!;
    const next = {
      variable: variable === undefined ? entry.variable : checkConditionVariable(variable),
      value: value === undefined ? entry.value : checkRange("value", value, 0, 0xffff),
      script: script === undefined ? entry.script : checkRange("script", script, 0, 0xffffffff),
    };
    table.entries[row] = next;
  }
}

function requireRow(count: number, index: number, row: number): void {
  if (!Number.isInteger(row) || row < 0 || row >= count) throw new EditError(EditErrorCode.ConditionIndexOutOfRange, { index, row, count });
}
