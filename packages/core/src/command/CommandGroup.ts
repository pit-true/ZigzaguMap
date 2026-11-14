import type { Command, CommandRecord, EditorContext, JsonObject } from "./Command.js";

/**
 * 複数のコマンドを 1 回の操作としてまとめるコマンド（「設定の保存」など、1 回押して複数の項目を変えるボタン用）。
 * 中の 1 つが失敗したら、それまでに実行した分を戻してから例外を投げる（何も変わらない）。
 * 引数には中のコマンドの JSON と、全部が同じマップを対象にするならその bank・map を持つ（画面の再描画用）。
 * 引数の JSON から作り直せるので、操作列の再生でもまとめたまま実行できる（CommandRegistry に `group` で登録）。
 */
export class CommandGroup implements Command {
  static readonly NAME = "group";
  readonly name = CommandGroup.NAME;
  private argsValue: JsonObject;
  private readonly commands: Command[];

  constructor(commands: readonly Command[]) {
    this.commands = [...commands];
    this.argsValue = CommandGroup.argsOf(this.commands);
  }

  /** 引数（中のコマンドの JSON と、全部が同じマップならその bank・map）。まとめたあとは中身も変わる。 */
  get args(): JsonObject {
    return this.argsValue;
  }

  private static argsOf(commands: readonly Command[]): JsonObject {
    const args: JsonObject = { commands: commands.map((c) => ({ name: c.name, args: c.args })) };
    const first = commands[0]?.args;
    if (first && typeof first["bank"] === "number" && commands.every((c) => c.args["bank"] === first["bank"] && c.args["map"] === first["map"])) {
      args["bank"] = first["bank"];
      args["map"] = first["map"] as number;
    }
    return args;
  }

  /** 1 つならそのまま、2 つ以上ならまとめたコマンドを返す。 */
  static of(commands: readonly Command[]): Command {
    if (commands.length === 0) throw new Error("まとめるコマンドがありません");
    return commands.length === 1 ? commands[0]! : new CommandGroup(commands);
  }

  /** JSON の引数から作る（中のコマンドは `create` で作る）。 */
  static fromJson(args: Record<string, unknown>, create: (record: CommandRecord) => Command): CommandGroup {
    const list = args["commands"];
    if (!Array.isArray(list) || list.length === 0) throw new Error("group の commands が空です");
    return new CommandGroup(list.map((r) => create(r as CommandRecord)));
  }

  do(context: EditorContext): void {
    const done: Command[] = [];
    try {
      for (const c of this.commands) {
        c.do(context);
        done.push(c);
      }
    } catch (e) {
      for (const c of done.reverse()) c.undo(context);
      throw e;
    }
  }

  undo(context: EditorContext): void {
    for (const c of [...this.commands].reverse()) c.undo(context);
  }

  /**
   * 実行済みの `next`（まとめたものか 1 つのコマンド）を自分にまとめる（2 枚のマップにまたがるドラッグを 1 回の操作にするため。Phase3 #234）。
   * 中のコマンドごとに、同じ種類・同じマップのものへまとめ、まとめられないものは後ろに足す（取り消しでは足したものから戻す）。
   * まとめられるのは、中のコマンドが全部 `merge` を持つときだけ。
   */
  merge(next: Command): boolean {
    const incoming = next instanceof CommandGroup ? next.commands : [next];
    if (incoming.length === 0 || !this.commands.every((c) => typeof c.merge === "function") || !incoming.every((c) => typeof c.merge === "function")) return false;
    for (const c of incoming) {
      if (!this.commands.some((own) => own.merge!(c))) this.commands.push(c);
    }
    this.argsValue = CommandGroup.argsOf(this.commands);
    return true;
  }
}

/**
 * コマンドの記録と、まとめたもの（CommandGroup）の中の記録を平らに並べる（自分が先頭）。
 * 画面側が「どのコマンドが実行されたか」を見て描き直しを決めるのに使う。
 */
export function flattenCommandRecords(record: { name: string; args: unknown } | null | undefined): CommandRecord[] {
  if (!record) return [];
  const out: CommandRecord[] = [];
  const visit = (r: unknown): void => {
    const c = r as { name?: unknown; args?: unknown } | null;
    if (!c || typeof c !== "object") return;
    const args = (c.args && typeof c.args === "object" ? c.args : {}) as JsonObject;
    out.push({ name: String(c.name ?? ""), args });
    const inner = args["commands"];
    if (Array.isArray(inner)) for (const x of inner) visit(x);
  };
  visit(record);
  return out;
}
