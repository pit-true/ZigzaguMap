import type { MapDocument } from "../../../model/MapDocument.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { ConnectionsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { requireConnection } from "./connectionFields.js";

/** 「接続を削除する」の引数。 */
export type RemoveConnectionArgs = MapArgs & { index: number };

/**
 * 「接続を削除する」コマンド（コネクションマネージャーの「削除」。確認の「コネクションNo nを削除しますか？」は画面側）。
 * 後ろが詰まる。全部消しても空の表は残る。
 */
export class RemoveConnectionCommand extends ConnectionsCommand<RemoveConnectionArgs> {
  static readonly NAME = "removeConnection";
  readonly name = RemoveConnectionCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): RemoveConnectionCommand {
    return new RemoveConnectionCommand({ ...argMapId(args), index: argInt(args, "index") });
  }

  protected edit(doc: MapDocument): void {
    requireConnection(doc, this.args.index);
    doc.connections!.splice(this.args.index, 1);
  }
}
