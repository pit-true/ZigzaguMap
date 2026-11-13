import type { MapDocument } from "../../../model/MapDocument.js";
import { argMapId, argOptInt, compactArgs, type Args } from "../../jsonArgs.js";
import { ConnectionsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { applyConnectionFields, type ConnectionFields } from "./connectionFields.js";

/** 「接続を追加する」の引数。省略した項目は 0（AdvanceMap の初期値: 方向 無し、調整 0、バンク 0、マップ 0）。 */
export type AddConnectionArgs = MapArgs & ConnectionFields;

/** 「接続を追加する」コマンド（コネクションマネージャーの「追加」）。末尾に足す。接続の表が無いマップでは表を作る。 */
export class AddConnectionCommand extends ConnectionsCommand<AddConnectionArgs> {
  static readonly NAME = "addConnection";
  readonly name = AddConnectionCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): AddConnectionCommand {
    return new AddConnectionCommand(compactArgs({ ...argMapId(args), ...readConnectionFields(args) }) as AddConnectionArgs);
  }

  protected edit(doc: MapDocument): void {
    const c = applyConnectionFields({ direction: 0, offset: 0, bank: 0, map: 0, padding: 0 }, this.args);
    (doc.connections ??= []).push(c);
  }
}

/** 接続の項目を JSON の引数から読む。 */
export function readConnectionFields(args: Args): { [K in keyof ConnectionFields]: number | undefined } {
  return {
    direction: argOptInt(args, "direction"),
    offset: argOptInt(args, "offset"),
    targetBank: argOptInt(args, "targetBank"),
    targetMap: argOptInt(args, "targetMap"),
    padding: argOptInt(args, "padding"),
  };
}
