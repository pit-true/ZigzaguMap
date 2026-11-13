import type { MapDocument } from "../../../model/MapDocument.js";
import { argInt, argMapId, compactArgs, type Args } from "../../jsonArgs.js";
import { ConnectionsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { readConnectionFields } from "./AddConnectionCommand.js";
import { applyConnectionFields, requireConnection, type ConnectionFields } from "./connectionFields.js";

/** 「接続を変える」の引数。省略した項目は変えない。 */
export type SetConnectionArgs = MapArgs & ConnectionFields & { index: number };

/** 「接続を変える」コマンド（コネクションマネージャーの方向・調整・バンク番号・マップ番号・不明と「保存」）。 */
export class SetConnectionCommand extends ConnectionsCommand<SetConnectionArgs> {
  static readonly NAME = "setConnection";
  readonly name = SetConnectionCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): SetConnectionCommand {
    return new SetConnectionCommand(compactArgs({ ...argMapId(args), index: argInt(args, "index"), ...readConnectionFields(args) }) as SetConnectionArgs);
  }

  protected edit(doc: MapDocument): void {
    const c = requireConnection(doc, this.args.index);
    doc.connections![this.args.index] = applyConnectionFields(c, this.args);
  }
}
