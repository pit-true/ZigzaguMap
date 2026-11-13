import type { Command, EditorContext, JsonObject } from "../../Command.js";
import { documentContext, type DocumentContext } from "../../DocumentContext.js";

/**
 * 実行前に対象の部分の控えを取り、取り消しで控えを書き戻すコマンドの土台。
 * 派生クラスは `capture`（控えを取る）・`apply`（変える）・`restore`（戻す）を実装する。
 * `apply` は入力を確かめてから状態を変えること（EditError を投げたときは何も変わらない）。
 */
export abstract class SnapshotCommand<A extends JsonObject, S> implements Command<A> {
  abstract readonly name: string;
  private saved: { value: S } | null = null;

  constructor(readonly args: A) {}

  do(context: EditorContext): void {
    const ctx = documentContext(context);
    const before = this.capture(ctx);
    this.apply(ctx);
    this.saved = { value: before };
  }

  undo(context: EditorContext): void {
    if (!this.saved) return;
    this.restore(documentContext(context), this.saved.value);
  }

  /** 変える前の控えを取る。 */
  protected abstract capture(context: DocumentContext): S;
  /** 変える（入力の確認を先に行う）。 */
  protected abstract apply(context: DocumentContext): void;
  /** 控えを書き戻す。 */
  protected abstract restore(context: DocumentContext, saved: S): void;
}
