import { ROM_BASE, type Rom } from "../rom/Rom.js";
import type { GameOffsets } from "./offsets.js";

/** 対応しているCFRUの3層描画フック。別の改造の分岐を同じものとして扱わない。 */
export function hasTripleLayerBlocks(rom: Rom, offsets: GameOffsets): boolean {
  try {
    const at = offsets.drawBlockHook;
    if (rom.u32(at) !== 0x47084900) return false; // ldr r1, [pc]; bx r1
    const target = rom.u32(at + 4);
    if (!(target & 1) || !rom.isPointer(target & ~1)) return false;
    const code = (target & ~1) - ROM_BASE;
    return rom.u32(code) === 0x0c120412 && rom.u16(code + 4) === 0x2804;
  } catch { return false; }
}
