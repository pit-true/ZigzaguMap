import { cloneItemBalls } from "../../../model/clone.js";
import type { ItemBall } from "../../../model/MapDocument.js";
import { isWorkMapId } from "../../../model/WorkMap.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import type { DocumentContext } from "../../DocumentContext.js";
import { EditError, EditErrorCode } from "../../EditError.js";
import { SnapshotCommand } from "../base/SnapshotCommand.js";
import { mapContent, sourceDocument, type MapContent } from "./mapCopy.js";

/** 「マップの中身を差し替える」の引数。 */
export type ReplaceMapArgs = {
  /** 差し替える先（プロジェクトの既存のマップ）。 */
  bank: number;
  map: number;
  /** 写し元（開いているマップ。作業用のマップでもよい）。 */
  sourceBank: number;
  sourceMap: number;
};

/** 控え（写す部分と、消える落とし物）。 */
interface Saved {
  content: MapContent;
  itemBalls: ItemBall[];
}

/**
 * 「マップの中身を差し替える」コマンド（マップの追加/挿入の「指定先にインポート」）。
 * 差し替え先の番号はそのままで、ヘッダー・配置・ボーダー・タイルセット・イベント・接続・マップスクリプトを写し元のものにする。
 * 野生は差し替え先のものが残る。人が入れ替わるので、差し替え先の落とし物は消える。
 */
export class ReplaceMapCommand extends SnapshotCommand<ReplaceMapArgs, Saved> {
  static readonly NAME = "replaceMap";
  readonly name = ReplaceMapCommand.NAME;

  /** JSON の引数から作る。 */
  static fromJson(args: Args): ReplaceMapCommand {
    return new ReplaceMapCommand({ ...argMapId(args), sourceBank: argInt(args, "sourceBank"), sourceMap: argInt(args, "sourceMap") });
  }

  protected capture(ctx: DocumentContext): Saved {
    const doc = this.target(ctx);
    return { content: mapContent(doc), itemBalls: cloneItemBalls(doc.itemBalls) };
  }

  protected apply(ctx: DocumentContext): void {
    const target = this.target(ctx);
    const source = sourceDocument(ctx, { bank: this.args.sourceBank, map: this.args.sourceMap });
    if (source === target) return;
    Object.assign(target, mapContent(source));
    target.itemBalls = [];
  }

  protected restore(ctx: DocumentContext, saved: Saved): void {
    const doc = ctx.document({ bank: this.args.bank, map: this.args.map });
    Object.assign(doc, mapContent(Object.assign(doc.clone(), saved.content)));
    doc.itemBalls = cloneItemBalls(saved.itemBalls);
  }

  private target(ctx: DocumentContext) {
    const id = { bank: this.args.bank, map: this.args.map };
    if (isWorkMapId(id)) throw new EditError(EditErrorCode.MapNotFound, { bank: id.bank, map: id.map });
    return sourceDocument(ctx, id);
  }
}
