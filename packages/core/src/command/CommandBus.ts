import type { Command, CommandRecord, EditorContext } from "./Command.js";

/** CommandBus が知らせる出来事の種類。 */
export type CommandEventType = "execute" | "undo" | "redo" | "clear";

/** CommandBus が購読者へ渡す出来事。 */
export interface CommandEvent {
  readonly type: CommandEventType;
  /** 対象のコマンド（clear のときは null）。 */
  readonly command: Command | null;
}

/** 購読者。 */
export type CommandListener = (event: CommandEvent) => void;

/** コマンドを実行し、アンドゥ・リドゥの履歴を持つクラス。 */
export class CommandBus {
  private readonly done: Command[] = [];
  private readonly undone: Command[] = [];
  private readonly listeners = new Set<CommandListener>();

  constructor(private readonly context: EditorContext) {}

  /** コマンドを実行して履歴に積む。リドゥの履歴は消える。 */
  execute(command: Command): void {
    command.do(this.context);
    this.done.push(command);
    this.undone.length = 0;
    this.emit({ type: "execute", command });
  }

  /** 直前のコマンドを取り消す。取り消すものが無ければ false。 */
  undo(): boolean {
    const command = this.done.pop();
    if (!command) return false;
    command.undo(this.context);
    this.undone.push(command);
    this.emit({ type: "undo", command });
    return true;
  }

  /** 取り消したコマンドをやり直す。やり直すものが無ければ false。 */
  redo(): boolean {
    const command = this.undone.pop();
    if (!command) return false;
    command.do(this.context);
    this.done.push(command);
    this.emit({ type: "redo", command });
    return true;
  }

  /** アンドゥできるか。 */
  get canUndo(): boolean {
    return this.done.length > 0;
  }

  /** リドゥできるか。 */
  get canRedo(): boolean {
    return this.undone.length > 0;
  }

  /** 実行済み（取り消していない）コマンドの一覧を、古い順に JSON の形で返す。 */
  history(): CommandRecord[] {
    return this.done.map((c) => ({ name: c.name, args: c.args }));
  }

  /** 履歴を空にする（ROM を開き直したときなど）。 */
  clear(): void {
    this.done.length = 0;
    this.undone.length = 0;
    this.emit({ type: "clear", command: null });
  }

  /** 出来事を購読する。戻り値の関数で購読をやめる。 */
  subscribe(listener: CommandListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: CommandEvent): void {
    for (const listener of this.listeners) listener(event);
  }
}
