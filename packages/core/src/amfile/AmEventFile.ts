import { DataError } from "../binary/DataError.js";
import { concatBytes } from "../binary/bytes.js";
import { PERSON_SIZE, SIGN_SIZE, TRAP_SIZE, WARP_SIZE } from "../event/layout.js";
import { personCodec } from "../event/PersonCodec.js";
import { signCodec } from "../event/SignCodec.js";
import { trapCodec } from "../event/TrapCodec.js";
import { warpCodec } from "../event/WarpCodec.js";
import type { MapEvents } from "../event/types.js";

/** `.evt` の末尾の件数（人・ワープ・スクリプト・看板の 4 バイト）のバイト数。 */
export const AM_EVENT_COUNT_SIZE = 4;
/** 1 種類の件数の上限（件数は 1 バイト）。 */
const MAX_COUNT = 0xff;

/**
 * AdvanceMap の「作成したマップ」のイベントファイル（`.evt`）を読む。
 * 中身は ROM のイベントの一覧をそのまま並べたもの（人 24 バイト、ワープ 8 バイト、スクリプト 16 バイト、看板 12 バイトの順）と、
 * 末尾の件数 4 バイト（人・ワープ・スクリプト・看板）。長さが合わなければ DataError。
 */
export function decodeAmEvents(bytes: Uint8Array): MapEvents {
  if (bytes.length < AM_EVENT_COUNT_SIZE) throw new DataError(`AdvanceMap のイベントファイルとして読めません（${bytes.length} バイト）`);
  const tail = bytes.length - AM_EVENT_COUNT_SIZE;
  const [persons, warps, traps, signs] = [bytes[tail]!, bytes[tail + 1]!, bytes[tail + 2]!, bytes[tail + 3]!];
  const expected = persons * PERSON_SIZE + warps * WARP_SIZE + traps * TRAP_SIZE + signs * SIGN_SIZE;
  if (expected !== tail) throw new DataError(`イベントファイルの長さ（${bytes.length} バイト）が件数と合いません`);
  let at = 0;
  const take = <T>(codec: { decodeList(b: Uint8Array, n: number, o: number): T[]; size: number }, count: number): T[] => {
    const list = codec.decodeList(bytes, count, at);
    at += count * codec.size;
    return list;
  };
  return {
    persons: take(personCodec, persons),
    warps: take(warpCodec, warps),
    traps: take(trapCodec, traps),
    signs: take(signCodec, signs),
  };
}

/** `.evt` を書く（イベントが無ければ件数 0 の 4 バイトだけ）。どれかの件数が 255 を超えれば RangeError。 */
export function encodeAmEvents(events: MapEvents | null): Uint8Array {
  const e = events ?? { persons: [], warps: [], traps: [], signs: [] };
  const counts = [e.persons.length, e.warps.length, e.traps.length, e.signs.length];
  if (counts.some((n) => n > MAX_COUNT)) throw new RangeError("イベントの数が多すぎます（1 種類 255 件まで）");
  return concatBytes([
    personCodec.encodeList(e.persons),
    warpCodec.encodeList(e.warps),
    trapCodec.encodeList(e.traps),
    signCodec.encodeList(e.signs),
    Uint8Array.from(counts),
  ]);
}
