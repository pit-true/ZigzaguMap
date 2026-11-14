import { CommandGroup, EditError, type Command, type CommandBus, type MapId } from "@zigzagumap/core";
import { cloneSyncFor, reportClones } from "../../app/cloneSync";
import type { EditorState } from "../../app/EditorState";
import { ja } from "../../i18n/ja";
import { showEditError } from "../form/inputErrors";
import { errorText } from "../../util/errors";

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
  /** `key` の無い操作にクローンを足すときの、仮の key の番号。 */
  private cloneKeys = 0;

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

  /**
   * 人を置く・動かす・欄を変えるコマンドを実行し、そのあと隣のマップのクローンを合わせる（#242）。
   * クローンを合わせるコマンドは、同じ `key` で元のコマンドと 1 つにして実行し直す（1 回の取り消しで両方戻る）。
   */
  runWithClones(command: Command, id: MapId, key: string | null = null): boolean {
    const k = key ?? `clones.${++this.cloneKeys}`;
    if (!this.run(command, k)) return false;
    void this.syncClones(command, id);
    return true;
  }

  /**
   * 直前に実行した `command` に、クローンを合わせるコマンドを足して実行し直す（履歴の 1 件を置き換える）。
   * そのあいだにほかの操作をしていたら（`command` が履歴の先頭でなければ）何もしない。続けての入力の途中なら、
   * 次の入力はまとめたものを置き換える。
   */
  async syncClones(command: Command, id: MapId): Promise<void> {
    const sync = await cloneSyncFor(this.state, id);
    const bus = this.bus;
    if (!sync || !bus || bus.last !== command || bus.canRedo) return;
    const group = CommandGroup.of([command, sync]);
    this.running = true;
    try {
      bus.undo();
      try {
        bus.execute(group);
      } catch (e) {
        bus.redo();
        throw e;
      }
    } catch (e) {
      this.report(e);
      return;
    } finally {
      this.running = false;
    }
    if (this.top === command) this.top = group;
    reportClones(this.state, sync.changes);
  }

  /** 続けての入力を区切る（欄からフォーカスが外れた、ドラッグを離した）。 */
  endSession(): void {
    this.key = null;
    this.top = null;
  }

  /** 読めない入力のダイアログ（AdvanceMap と同じく入力のたびに出る）。 */
  inputError(error: EditError): void {
    void showEditError(error);
  }

  private report(e: unknown): void {
    if (e instanceof EditError) this.state.setStatus(ja.error(e.message), undefined, true);
    else this.state.setStatus(ja.error(errorText(e)), undefined, true);
  }
}
