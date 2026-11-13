import { ROM_BASE, type Rom } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";

/** 1 つの分岐をたどる命令数の上限。 */
const STEP_LIMIT = 40;

/**
 * 地名番号ごとの訪問フラグ（AdvanceMap の「人ID」）を、タウンマップの switch 文から読む。
 *
 * FR/LG の GetMapState / GetCaveState は `switch (地名番号) { case T01: return EventFlagCheck(SYS_T001_ARRIVE) ... }`
 * で、表ではなく命令に埋め込まれている（AdvanceMap が「ルーチンの変更」で表引きの命令に書き換えるのはこのため）。
 * ここでは ROM を書き換えず、命令を読んで各 case の EventFlagCheck の引数を取り出す。
 *
 * 読む形（agbcc の出力）:
 * `subs r0, #最初の値` → `cmp r0, #件数-1` → `bls` → `b 既定` → `lsls r0, #2` → `ldr r1, [pc, #]`（ジャンプ表）→ `mov pc, r0`。
 * 各 case は `movs`/`lsls`/`adds`/`ldr [pc]` で r0 を作り、`b` で共通の `bl EventFlagCheck` へ飛ぶ。
 */
export class FlagSwitchReader {
  constructor(
    private readonly rom: Rom,
    /** EventFlagCheck の位置（ROM 先頭から）。 */
    private readonly eventFlagCheck: number,
  ) {}

  /** switch 文の関数を読み、地名番号 → フラグ（無い case は含めない）を返す。形が違えば RomError。 */
  read(functionOffset: number): Map<number, number> {
    const rom = this.rom;
    let base: number | null = null;
    let last: number | null = null;
    let table: number | null = null;
    for (let pc = functionOffset; pc < functionOffset + 48; pc += 2) {
      const op = rom.u16(pc);
      if (base === null && (op & 0xff00) === 0x3800) base = op & 0xff;
      else if (base !== null && last === null && (op & 0xff00) === 0x2800) last = op & 0xff;
      else if (last !== null && (op & 0xff00) === 0x4900) {
        table = rom.pointer(((pc + 4) & ~3) + (op & 0xff) * 4);
        break;
      }
    }
    if (base === null || last === null || table === null) {
      throw new RomError(`訪問フラグの switch 文が読めません (0x${(functionOffset + ROM_BASE).toString(16)})`);
    }
    const out = new Map<number, number>();
    for (let i = 0; i <= last; i++) {
      const target = (rom.u32(table + i * 4) & ~1) - ROM_BASE;
      if (!rom.inRange(target, 2)) continue;
      const flag = this.follow(target, null, new Set());
      if (flag !== null) out.set(base + i, flag);
    }
    return out;
  }

  /** 命令をたどり、EventFlagCheck を呼ぶ直前の r0 を返す。見つからなければ null。条件分岐は両方をたどる。 */
  private follow(start: number, r0Start: number | null, seen: Set<number>): number | null {
    const rom = this.rom;
    let pc = start;
    let r0 = r0Start;
    for (let step = 0; step < STEP_LIMIT; step++) {
      if (seen.has(pc) || !rom.inRange(pc, 2)) return null;
      seen.add(pc);
      const op = rom.u16(pc);
      if ((op & 0xff00) === 0x2000) r0 = op & 0xff; // movs r0, #imm
      else if ((op & 0xf83f) === 0x0000 && op !== 0) r0 = r0 === null ? null : (r0 << ((op >> 6) & 31)) >>> 0; // lsls r0, r0, #n
      else if ((op & 0xff00) === 0x3000) r0 = r0 === null ? null : r0 + (op & 0xff); // adds r0, #imm
      else if ((op & 0xff00) === 0x3800) r0 = r0 === null ? null : r0 - (op & 0xff); // subs r0, #imm
      else if ((op & 0xff00) === 0x4800) r0 = rom.u32(((pc + 4) & ~3) + (op & 0xff) * 4); // ldr r0, [pc, #]
      else if ((op & 0xf800) === 0xe000) {
        // b
        pc = pc + 4 + signExtend(op & 0x7ff, 11) * 2;
        continue;
      } else if ((op & 0xf000) === 0xd000 && (op & 0x0f00) < 0x0e00) {
        // 条件分岐: 飛ばない側を先に、だめなら飛ぶ側をたどる。
        const taken = pc + 4 + signExtend(op & 0xff, 8) * 2;
        const fall = this.follow(pc + 2, r0, new Set(seen));
        return fall ?? this.follow(taken, r0, new Set(seen));
      } else if ((op & 0xf800) === 0xf000) {
        // bl
        const lo = rom.u16(pc + 2);
        const target = pc + 4 + signExtend(((op & 0x7ff) << 12) | ((lo & 0x7ff) << 1), 23);
        if (target === this.eventFlagCheck) return r0;
        r0 = null;
        pc += 4;
        continue;
      } else if ((op & 0xff00) === 0xbd00 || (op & 0xff87) === 0x4700 || (op & 0xff87) === 0x4687) {
        return null; // pop {pc} / bx / mov pc
      } else if (writesR0(op)) r0 = null;
      pc += 2;
    }
    return null;
  }
}

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1);
  return (value & (sign - 1)) - (value & sign);
}

/** r0 を書き換える（値を追わない）命令か。 */
function writesR0(op: number): boolean {
  if (op >> 13 === 0 && (op & 7) === 0) return true; // シフト・加減算（rd = r0）
  if ((op & 0xfc00) === 0x4000 && (op & 7) === 0) return ((op >> 6) & 0xf) !== 0x8 && ((op >> 6) & 0xf) !== 0xa && ((op >> 6) & 0xf) !== 0xb; // ALU（tst/cmp/cmn 以外）
  if ((op & 0xf000) === 0x6000 || (op & 0xf000) === 0x8000 || (op & 0xf000) === 0x5000) return (op & 0x0800) !== 0 && (op & 7) === 0; // ldr 系
  return false;
}
