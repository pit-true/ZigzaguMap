import { sha1 } from "../binary/sha1.js";
import { formatHex } from "../binary/bytes.js";
import type { AutoPenTilesetInfo, PrimaryRef } from "./types.js";

/**
 * ブロックのデータ（1 ブロック 16 バイト × `blockCount`）から識別子を作る（SHA-1 の先頭 8 バイトの 16 進）。
 * Bochi の mapassist と同じ値なので、Bochi の txt とも中身で当たる。同じタイルセットを別の ROM へ移しても同じになる。
 */
export function blockFingerprint(blocks: Uint16Array, blockCount: number): string {
  const n = Math.max(0, Math.min(blockCount * 8, blocks.length));
  const bytes = new Uint8Array(n * 2);
  for (let i = 0; i < n; i++) {
    bytes[i * 2] = blocks[i]! & 0xff;
    bytes[i * 2 + 1] = (blocks[i]! >>> 8) & 0xff;
  }
  const hash = sha1(bytes);
  let hex = "";
  for (let i = 0; i < 8; i++) hex += hash[i]!.toString(16).padStart(2, "0");
  return hex;
}

/** タイルセットの見分け方を作る。 */
export function tilesetInfoOf(options: {
  secondary: boolean;
  game: string;
  headerAddress: number;
  blocks: Uint16Array;
  blockCount: number;
}): AutoPenTilesetInfo {
  const { secondary, game, headerAddress, blocks, blockCount } = options;
  return {
    secondary,
    game,
    headerAddress,
    fingerprint: blockFingerprint(blocks, blockCount),
    blockCount,
    name: `${game} TS${secondary ? 2 : 1} 0x${formatHex(headerAddress, 6)}`,
  };
}

/** 同じ ROM の同じ場所のタイルセットか（ブロックを編集しても変わらない）。 */
export function samePlace(a: AutoPenTilesetInfo, b: AutoPenTilesetInfo): boolean {
  return a.secondary === b.secondary && a.headerAddress >= 0 && a.headerAddress === b.headerAddress && a.game === b.game;
}

/** 中身が同じタイルセットか（別の ROM へ移したものも当たる）。 */
export function sameContent(a: AutoPenTilesetInfo, b: AutoPenTilesetInfo): boolean {
  return a.secondary === b.secondary && a.fingerprint.length > 0 && a.fingerprint.toLowerCase() === b.fingerprint.toLowerCase();
}

/**
 * ファイルの見出しがタイルセットにどれだけ合うか（大きいほどよい。0 は合わない）。
 * 3: 識別子と場所の両方、2: 識別子だけ（別の ROM へ移したもの）、1: 場所だけ（ブロックを編集したあと）。
 */
export function matchScore(file: AutoPenTilesetInfo, target: AutoPenTilesetInfo): number {
  const content = sameContent(file, target);
  const place = samePlace(file, target);
  return content && place ? 3 : content ? 2 : place ? 1 : 0;
}

/** 主タイルセットの見分け（副のファイルに入るパーツに付ける）。 */
export function primaryRefOf(info: AutoPenTilesetInfo): PrimaryRef {
  return { fingerprint: info.fingerprint, game: info.game, headerAddress: info.headerAddress };
}

/** パーツの主タイルセットの見分けが、その主タイルセットに合うか。 */
export function primaryRefMatches(ref: PrimaryRef, primary: AutoPenTilesetInfo): boolean {
  if (ref.fingerprint.length > 0 && ref.fingerprint.toLowerCase() === primary.fingerprint.toLowerCase()) return true;
  return ref.headerAddress >= 0 && ref.headerAddress === primary.headerAddress && ref.game === primary.game;
}
