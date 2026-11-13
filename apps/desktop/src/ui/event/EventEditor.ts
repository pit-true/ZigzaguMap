import { EditError, type Command, type CommandBus } from "@zigzagumap/core";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { invalidIntegerText } from "../form/controls";
import { showError } from "../MessageBox";

/**
 * イベントタブの編集を CommandBus で実行する窓口。
 *
 * AdvanceMap は入力のたびに値を反映する。1 文字ごとに履歴を積むとアンドゥが細かくなりすぎるので、
 * 同じ `key`（同じ欄への続けての入力、1 回のドラッグ）の 2 回目以降は、直前の自分のコマンドを取り消してから実行し直す。
 * こうすると 1 回のアンドゥで入力を始める前の値に戻る。
 */
export class EventEditor {
  private bus: CommandBus | null = null;
  private unsubscribe: (() => void) | null = null;
  private key: string | null = null;
  /** 直前に自分が実行し、まだ履歴の先頭にあるコマンド。 */
  private top: Command | null = null;
  private running = false;

  constructor(private readonly state: EditorState) {}

  /** ROM を開き直したときに呼ぶ。 */
  attach(bus: CommandBus | null): void {
    this.unsubscribe?.();
    this.bus = bus;
    this.top = null;
    this.key = null;
    this.unsubscribe =
      bus?.subscribe(() => {
        if (!this.running) this.top = null;
      }) ?? null;
  }

  /**
   * コマンドを実行する。`key` が直前と同じなら、直前のコマンドの実行をやり直す形にする。
   * 入力エラー（EditError）はステータスバーに出して false を返す（何も変わらない）。
   */
  run(command: Command, key: string | null = null): boolean {
    const bus = this.bus;
    if (!bus) return false;
    const replace = key !== null && key === this.key && this.top !== null;
    this.running = true;
    try {
      if (replace) bus.undo();
      try {
        bus.execute(command);
      } catch (e) {
        if (replace) bus.redo();
        throw e;
      }
      this.top = command;
      this.key = key;
      return true;
    } catch (e) {
      this.report(e);
      return false;
    } finally {
      this.running = false;
    }
  }

  /** 続けての入力を区切る（欄からフォーカスが外れた、ドラッグを離した）。 */
  endSession(): void {
    this.key = null;
    this.top = null;
  }

  /** 読めない入力のダイアログ（AdvanceMap と同じく入力のたびに出る）。 */
  inputError(error: EditError): void {
    void showError(invalidIntegerText(error, ja.event.invalidInteger), ja.appTitle);
  }

  private report(e: unknown): void {
    if (e instanceof EditError) this.state.setStatus(ja.error(e.message), undefined, true);
    else this.state.setStatus(ja.error(e instanceof Error ? e.message : String(e)), undefined, true);
  }
}
