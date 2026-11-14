import { formatHex } from "../../binary/bytes.js";
import { ROM_BASE, type Rom } from "../../rom/Rom.js";
import type { DisasmCommandSet } from "../disasm/DisasmCommandSet.js";
import type { DisasmLine } from "../disasm/DisasmTypes.js";
import { disassembleScripts } from "../disasm/ScriptDisassembler.js";
import type { ScriptTextCodec } from "../disasm/scriptText.js";
import type { UsageKind } from "../config/UsageConfig.js";
import { isVariableNumber } from "./eventUsage.js";
import type { UsageSite } from "./UsageIndex.js";

/** 命令番号 trainerbattle。 */
const TRAINERBATTLE = 0x5c;
/** trainerbattle の引数のうち、戦う相手のトレーナーの番号（パートナーは別の表なので数えない）。 */
const TRAINER_ARG = /^(index|foeindex[0-9]*)$/i;
/** ヘッダーより前（0x08000000 を入れた「無し」も）は入口にしない。 */
const ROM_HEADER_SIZE = 0x200;

/** ポインタを ROM の中の位置にする（ROM の外・ヘッダー・0x08000000 未満なら null）。 */
export function romOffsetOf(rom: Rom, pointer: number): number | null {
  const offset = (pointer >>> 0) - ROM_BASE;
  return offset >= ROM_HEADER_SIZE && rom.inRange(offset) ? offset : null;
}

/** 逆アセンブルした 1 行が使う番号（フラグ・変数・トレーナー）。 */
export function lineUsage(line: DisasmLine): { kind: UsageKind; value: number }[] {
  const out: { kind: UsageKind; value: number }[] = [];
  const opcode = line.bytes[0];
  for (const a of line.args) {
    if (a.value === null) continue;
    if (a.kind === "flag") out.push({ kind: "flag", value: a.value });
    else if (a.kind === "variable" && isVariableNumber(a.value)) out.push({ kind: "var", value: a.value });
    else if (opcode === TRAINERBATTLE && TRAINER_ARG.test(a.name) && a.value > 0) out.push({ kind: "trainer", value: a.value });
  }
  return out;
}

/**
 * 素の ROM のスクリプトを入口からたどり、使っているフラグ・変数・トレーナーの番号を集める（#227）。
 * 逆アセンブルは Phase2 のもの（分岐・call・trainerbattle の続きもたどる）。読めない箇所は飛ばす。
 */
export function romScriptUsage(
  rom: Rom,
  entries: readonly number[],
  options: { commands: DisasmCommandSet; text?: ScriptTextCodec; where: string; map?: { bank: number; map: number } },
): UsageSite[] {
  if (entries.length === 0) return [];
  const d = disassembleScripts(rom, entries, { commands: options.commands, ...(options.text ? { text: options.text } : {}), maxStringBytes: 1 });
  const out: UsageSite[] = [];
  for (const block of d.blocks) {
    for (const line of block.lines) {
      for (const u of lineUsage(line)) {
        out.push({
          ...u,
          source: "rom",
          where: `ROM 0x${formatHex(line.offset + ROM_BASE, 8)}（${options.where}）`,
          ...(options.map ? { map: options.map } : {}),
        });
      }
    }
  }
  return out;
}
