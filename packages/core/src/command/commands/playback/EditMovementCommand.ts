import type { Command, JsonObject } from "../../Command.js";
import { argOptString, argString, type Args } from "../../jsonArgs.js";

/** 移動データの編集（#458）の引数。どのファイルのどのラベルを、どう変えたか（履歴の表示と操作列の記録用）。 */
export interface EditMovementArgs {
  /** 移動データのファイル。 */
  readonly path: string;
  /** 移動データのラベル。 */
  readonly label: string;
  /** 編集の種類（replace・direction・insert・delete・move・repeat）。 */
  readonly edit: string;
  /** 新しいラベルに写したときの名前。 */
  readonly newLabel?: string;
}

/**
 * タイムラインで移動データを 1 回編集したことを表すコマンド（#458）。マップのデータは変えない。
 * `.s` の本文の前後は画面の側（`ScriptLink.attachReplacements`）がこのコマンドに結び付け、取り消し・やり直しで戻す。
 * マップを持たないので、未出力の印も付かない。
 */
export class EditMovementCommand implements Command<EditMovementArgs & JsonObject> {
  static readonly NAME = "editMovement";
  readonly name = EditMovementCommand.NAME;
  readonly args: EditMovementArgs & JsonObject;

  static fromJson(args: Args): EditMovementCommand {
    const newLabel = argOptString(args, "newLabel");
    return new EditMovementCommand({ path: argString(args, "path"), label: argString(args, "label"), edit: argString(args, "edit"), ...(newLabel !== undefined ? { newLabel } : {}) });
  }

  constructor(args: EditMovementArgs) {
    this.args = { path: args.path, label: args.label, edit: args.edit, ...(args.newLabel !== undefined ? { newLabel: args.newLabel } : {}) } as EditMovementArgs & JsonObject;
  }

  do(): void {}
  undo(): void {}
}
