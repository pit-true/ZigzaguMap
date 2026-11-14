import { ROM_BASE } from "./Rom.js";

/** ROM の上の位置（0〜）か、ポインタの値（0x08000000〜）を、ポインタの値にする。範囲の外なら null。 */
export function toPointerValue(address: number, romSize = 0x2000000): number | null {
  if (!Number.isInteger(address) || address < 0) return null;
  const offset = address >= ROM_BASE ? address - ROM_BASE : address;
  return offset < romSize && offset < 0x2000000 ? (ROM_BASE + offset) >>> 0 : null;
}

/**
 * ROM 全体から、4 バイト境界に置かれたポインタ `value`（0x08000000 を足した値）の場所を探す（ポインタの参照元の検索。#307）。
 * `start`〜`end`（バイト。4 の倍数に丸める）だけを探す。見つかった ROM の上の位置を返す。
 */
export function findPointerRefs(bytes: Uint8Array, value: number, start = 0, end = bytes.length): number[] {
  const out: number[] = [];
  const v = value >>> 0;
  const b0 = v & 0xff;
  const b1 = (v >>> 8) & 0xff;
  const b2 = (v >>> 16) & 0xff;
  const b3 = v >>> 24;
  const from = Math.max(0, start) & ~3;
  const to = Math.min(bytes.length - 3, end);
  for (let i = from; i < to; i += 4) {
    // いちばん上のバイト（0x08 か 0x09）から比べると、ほとんどの位置で 1 回の比較で済む
    if (bytes[i + 3] === b3 && bytes[i] === b0 && bytes[i + 1] === b1 && bytes[i + 2] === b2) out.push(i);
  }
  return out;
}

/** 小分けに探すときの 1 回の大きさ（バイト。1MB で手元の PC は数 ms）。 */
export const POINTER_SCAN_CHUNK = 1 << 20;

/**
 * `findPointerRefs` を小分けにして探す（画面を止めないため。`pause` を 1 回ごとにはさむ）。
 * `progress` に探し終えたバイト数を知らせる。`cancelled` が true を返したら途中でやめて、そこまでの結果を返す。
 */
export async function findPointerRefsChunked(
  bytes: Uint8Array,
  value: number,
  options: { chunk?: number; pause?: () => Promise<void>; progress?: (done: number, total: number) => void; cancelled?: () => boolean } = {},
): Promise<number[]> {
  const chunk = Math.max(4, (options.chunk ?? POINTER_SCAN_CHUNK) & ~3);
  const out: number[] = [];
  for (let start = 0; start < bytes.length; start += chunk) {
    if (options.cancelled?.()) break;
    out.push(...findPointerRefs(bytes, value, start, start + chunk));
    options.progress?.(Math.min(bytes.length, start + chunk), bytes.length);
    if (options.pause && start + chunk < bytes.length) await options.pause();
  }
  return out;
}
