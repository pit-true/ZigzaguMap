import { asmOpName, asmTokenText, parseAsmLine } from "../asm/AsmLine.js";
import { splitAsmLines } from "../asm/lineEnding.js";
import { evaluateMacroExpression } from "../commands/macroExpression.js";
import type { ScriptCommandTable } from "../commands/ScriptCommandTable.js";
import type { UsageKind } from "../config/UsageConfig.js";
import { isVariableNumber } from "./eventUsage.js";
import type { UsageSite } from "./UsageIndex.js";

/** トレーナーの番号を書く命令（ND と Chronos の `trainer` と `trainerbattle1`〜`16`）。 */
const TRAINER_COMMAND = /^(trainer|trainerbattle[0-9]*)$/i;
/** その命令の引数のうち、戦う相手のトレーナーの番号。 */
const TRAINER_ARG = /^(index|foeindex[0-9]*)$/i;

/** `.equ` の定数の名前を数にするもの（索引の `.equ` と、命令表の xse_defines.s・asm_defines.s）。 */
export type AsmConstantResolver = (name: string) => number | null;

/**
 * `.s` 1 ファイルが使うフラグ・変数・トレーナーの番号（#227）。
 * 命令表で引数の種類（フラグ・変数）を引き、値の数か `.equ` の名前（式も）を数にする。読めない値は数えない。
 * トレーナーは `trainer`・`trainerbattle*` の相手の番号の引数。
 */
export function asmUsage(path: string, text: string, table: ScriptCommandTable, resolve: AsmConstantResolver): UsageSite[] {
  const out: UsageSite[] = [];
  let inBlock = false;
  const lines = splitAsmLines(text);
  for (let i = 0; i < lines.length; i++) {
    const line = parseAsmLine(lines[i]!, inBlock);
    inBlock = line.endsInBlockComment;
    const name = asmOpName(line);
    if (!name || name.startsWith(".")) continue;
    const command = table.get(name);
    if (!command) continue;
    const trainer = TRAINER_COMMAND.test(command.name);
    line.args.forEach((token, n) => {
      const arg = command.args[n] ?? (command.args.at(-1)?.vararg ? command.args.at(-1) : undefined);
      if (!arg) return;
      let kind: UsageKind | null = null;
      if (arg.kind === "flag") kind = "flag";
      else if (arg.kind === "variable") kind = "var";
      else if (trainer && TRAINER_ARG.test(arg.name)) kind = "trainer";
      if (!kind) return;
      const value = evaluateMacroExpression(asmTokenText(line, token), resolve);
      if (value === null || value < 0) return;
      if (kind === "var" && !isVariableNumber(value)) return;
      if (kind === "trainer" && value === 0) return;
      out.push({ kind, value, source: "asm", where: `${path}:${i + 1}`, path, line: i + 1 });
    });
  }
  return out;
}
