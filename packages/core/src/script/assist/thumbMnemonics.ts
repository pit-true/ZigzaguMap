/**
 * `.s` に書かれる ARM / Thumb の命令の名前（overworld_scripts の `.s` にも `callasm` で呼ぶ関数が書かれている）。
 * 知らない命令の波線を出さないためと、色付けで命令として扱うために使う。条件の付いた分岐（`beq` など）と、
 * フラグを立てる `s` 付き（`adds` など）も入れる。大文字小文字は区別しない。
 */
const BASE = [
  "adc", "add", "adr", "and", "asr", "b", "bic", "bl", "blx", "bx", "cmn", "cmp", "eor", "ldm", "ldmia", "ldmfd",
  "ldr", "ldrb", "ldrh", "ldrsb", "ldrsh", "lsl", "lsr", "mov", "mul", "mvn", "neg", "orr", "pop", "push", "ror",
  "rsb", "sbc", "stm", "stmia", "stmfd", "stmdb", "str", "strb", "strh", "sub", "swi", "svc", "tst", "teq", "nop",
  "mla", "umull", "smull", "mrs", "msr", "ldrd", "strd", "cpy", "bkpt", "sxtb", "sxth", "uxtb", "uxth", "rev",
];
const CONDITIONS = ["eq", "ne", "cs", "hs", "cc", "lo", "mi", "pl", "vs", "vc", "hi", "ls", "ge", "lt", "gt", "le", "al"];
const FLAG_SETTING = ["adc", "add", "and", "asr", "bic", "eor", "lsl", "lsr", "mov", "mul", "mvn", "neg", "orr", "ror", "rsb", "sbc", "sub"];

const NAMES: ReadonlySet<string> = new Set([
  ...BASE,
  ...CONDITIONS.map((c) => `b${c}`),
  ...CONDITIONS.map((c) => `bx${c}`),
  ...FLAG_SETTING.map((m) => `${m}s`),
]);

/** ARM / Thumb の命令の名前か。 */
export function isThumbMnemonic(name: string): boolean {
  return NAMES.has(name.toLowerCase());
}
