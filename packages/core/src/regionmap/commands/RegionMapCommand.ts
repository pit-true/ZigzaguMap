import type { Command, EditorContext, JsonObject } from "../../command/Command.js";
import { regionMapContext, type RegionMapContext } from "../RegionMapContext.js";
import type { RegionMapSnapshot } from "../RegionMapDocument.js";

/**
 * タウンマップのコマンドの土台。実行前に表全体（数 KB）の控えを取り、取り消しで書き戻す。
 * 派生クラスの `apply` は入力を確かめてから変えること（EditError を投げたときは何も変わらない）。
 */
export abstract class RegionMapCommand<A extends JsonObject> implements Command<A> {
  abstract readonly name: string;
  private saved: RegionMapSnapshot | null = null;

  constructor(readonly args: A) {}

  do(context: EditorContext): void {
    const ctx = regionMapContext(context);
    const before = ctx.regionMap().snapshot();
    this.apply(ctx);
    this.saved = before;
  }

  undo(context: EditorContext): void {
    if (!this.saved) return;
    const ctx = regionMapContext(context);
    this.beforeRestore(ctx);
    ctx.regionMap().restore(this.saved);
  }

  /** 変える（入力の確認を先に行う）。 */
  protected abstract apply(context: RegionMapContext): void;

  /** 取り消しで表を戻す前に、表の外のもの（マップ名など）を戻す。 */
  protected beforeRestore(_context: RegionMapContext): void {}
}
