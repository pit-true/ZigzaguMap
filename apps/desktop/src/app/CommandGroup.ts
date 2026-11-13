import type { Command, EditorContext, JsonObject } from "@zigzagumap/core";

/**
 * 複数のコマンドを 1 回の操作としてまとめるコマンド（「設定の保存」など、1 回押して複数の項目を変えるボタン用）。
 * 中の 1 つが失敗したら、それまでに実行した分を戻してから例外を投げる（何も変わらない）。
 * 引数には中のコマンドの JSON と、全部が同じマップを対象にするならその bank・map を持つ（画面の再描画用）。
 */
export class CommandGroup implements Command {
  static readonly NAME = "group";
  readonly name = CommandGroup.NAME;
  readonly args: JsonObject;

  constructor(private readonly commands: readonly Command[]) {
    const args: JsonObject = { commands: commands.map((c) => ({ name: c.name, args: c.args })) };
    const first = commands[0]?.args;
    if (first && typeof first["bank"] === "number" && commands.every((c) => c.args["bank"] === first["bank"] && c.args["map"] === first["map"])) {
      args["bank"] = first["bank"];
      args["map"] = first["map"] as number;
    }
    this.args = args;
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
}
