import type { Command, CommandRecord } from "./Command.js";
import { PlaceBlockCommand } from "./commands/PlaceBlockCommand.js";
import { PlaceMovementCommand } from "./commands/PlaceMovementCommand.js";
import { registerEditCommands } from "./editCommands.js";

/** JSON の引数からコマンドを作る関数。 */
export type CommandFactory = (args: Record<string, unknown>) => Command;

/** コマンド名から作り方を引く表。操作列の再生と MCP から同じコマンドを作るのに使う。 */
export class CommandRegistry {
  private readonly factories = new Map<string, CommandFactory>();

  /** コマンドを登録する。同じ名前があれば上書きする。 */
  register(name: string, factory: CommandFactory): this {
    this.factories.set(name, factory);
    return this;
  }

  /** 登録済みのコマンド名。 */
  names(): string[] {
    return [...this.factories.keys()];
  }

  /** JSON の 1 行からコマンドを作る。知らない名前なら Error。 */
  create(record: CommandRecord | { name: string; args: Record<string, unknown> }): Command {
    const factory = this.factories.get(record.name);
    if (!factory) throw new Error(`知らないコマンドです: ${record.name}`);
    return factory(record.args);
  }
}

/** 組み込みのコマンドをすべて登録した表を作る。 */
export function createDefaultRegistry(): CommandRegistry {
  const registry = new CommandRegistry()
    .register(PlaceBlockCommand.NAME, PlaceBlockCommand.fromJson)
    .register(PlaceMovementCommand.NAME, PlaceMovementCommand.fromJson);
  return registerEditCommands(registry);
}
