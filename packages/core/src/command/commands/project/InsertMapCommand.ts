import { MapDocument } from "../../../model/MapDocument.js";
import type { Command, EditorContext } from "../../Command.js";
import { documentContext } from "../../DocumentContext.js";
import { argInt, argMapId, type Args } from "../../jsonArgs.js";
import { checkSlot } from "./CreateMapCommand.js";
import { mapContent, sourceDocument } from "./mapCopy.js";

/** 「マップを写して加える」の引数。 */
export type InsertMapArgs = {
  /** 加える番号（既存のバンクの末尾か、最後のバンクの次の新しいバンクのマップ 0）。 */
  bank: number;
  map: number;
  /** 写し元（開いているマップ。作業用のマップ（バンク -1）でもよい）。 */
  sourceBank: number;
  sourceMap: number;
};

/**
 * 「マップを写して加える」コマンド（マップの追加/挿入の「ダミーマップ数の変更」と「バンク番号の追加」）。
 * 写し元の中身（ヘッダー、配置、ボーダー、タイルセット、イベント、接続、マップスクリプト）を新しいマップとしてプロジェクトに加える。
 * 野生と落とし物は写さない。置けるのはバンクの末尾か新しいバンクだけ（途中の番号は EditError mapSlotNotAppend / bankSkip）。
 */
export class InsertMapCommand implements Command<InsertMapArgs> {
  static readonly NAME = "insertMap";
  readonly name = InsertMapCommand.NAME;
  private created = false;

  constructor(readonly args: InsertMapArgs) {}

  /** JSON の引数から作る。 */
  static fromJson(args: Args): InsertMapCommand {
    return new InsertMapCommand({ ...argMapId(args), sourceBank: argInt(args, "sourceBank"), sourceMap: argInt(args, "sourceMap") });
  }

  do(context: EditorContext): void {
    const ctx = documentContext(context);
    const { bank, map, sourceBank, sourceMap } = this.args;
    const source = sourceDocument(ctx, { bank: sourceBank, map: sourceMap });
    checkSlot(ctx, bank, map);
    ctx.addMap(new MapDocument({ id: { bank, map }, ...mapContent(source) }));
    this.created = true;
  }

  undo(context: EditorContext): void {
    if (!this.created) return;
    documentContext(context).removeMap({ bank: this.args.bank, map: this.args.map });
    this.created = false;
  }
}
