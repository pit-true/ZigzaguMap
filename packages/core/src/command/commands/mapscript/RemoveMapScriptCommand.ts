import type { MapDocument } from "../../../model/MapDocument.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { MapScriptsCommand, type MapArgs } from "../base/MapPartCommand.js";
import { requireScript } from "./mapScriptChecks.js";

/** 「マップスクリプトを削除する」の引数。 */
export type RemoveMapScriptArgs = MapArgs & { index: number };

/** 「マップスクリプトを削除する」コマンド（「選択したスクリプト削除」）。後ろが詰まる。全部消しても空の表は残る。 */
export class RemoveMapScriptCommand extends MapScriptsCommand<RemoveMapScriptArgs> {
  static readonly NAME = "removeMapScript";
  readonly name = RemoveMapScriptCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): RemoveMapScriptCommand {
    return new RemoveMapScriptCommand({ ...argMapId(args), index: argInt(args, "index") });
  }

  protected edit(doc: MapDocument): void {
    requireScript(doc, this.args.index);
    doc.mapScripts!.splice(this.args.index, 1);
  }
}
