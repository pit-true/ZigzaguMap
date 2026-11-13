import type { Rom } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { OFFSETS_BY_CODE, type GameOffsets } from "./offsets.js";

/** ROM ヘッダーから読んだゲームの情報。 */
export interface GameInfo {
  /** ヘッダーのゲームタイトル（0xA0、12 文字）。 */
  readonly title: string;
  /** ゲームコード（0xAC、4 文字。例: BPRJ）。 */
  readonly code: string;
  /** メーカーコード（0xB0、2 文字）。 */
  readonly maker: string;
  /** リビジョン（0xBC）。 */
  readonly revision: number;
  /** 対応しているゲームなら、そのオフセット定義。 */
  readonly offsets: GameOffsets | null;
}

/** ヘッダーを読んでゲームを判定する。 */
export function detectGame(rom: Rom): GameInfo {
  if (!rom.inRange(0, 0xc0)) throw new RomError("ROM が小さすぎます");
  const code = rom.ascii(0xac, 4);
  return {
    title: rom.ascii(0xa0, 12),
    code,
    maker: rom.ascii(0xb0, 2),
    revision: rom.u8(0xbc),
    offsets: OFFSETS_BY_CODE[code] ?? null,
  };
}

/** 対応しているゲームならオフセット定義を返し、そうでなければ RomError を投げる。 */
export function requireSupportedGame(rom: Rom): GameInfo & { readonly offsets: GameOffsets } {
  const info = detectGame(rom);
  if (!info.offsets) throw new RomError(`対応していないゲームです: ${info.code || "(不明)"}`);
  return info as GameInfo & { readonly offsets: GameOffsets };
}
