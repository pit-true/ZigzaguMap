import { formatHex } from "../binary/bytes.js";
import type { ItemBall } from "../model/MapDocument.js";

/** 生成範囲（`@ BBE-BEGIN <id>`〜`@ BBE-END <id>`）。Bochi の BuildHiddenItemSource と同じ形。 */
const BLOCK_PATTERN = /^@ BBE-BEGIN (?<id>[0-9a-fA-F]{32})\r?\n[\s\S]*?^@ BBE-END \k<id>(?:\r?\n)?/gm;
/** 生成範囲の始まりの行。 */
const BEGIN_PATTERN = /^@ BBE-BEGIN /gm;
/** 手書き部分が空のときの先頭。 */
const DEFAULT_MANUAL = ".text\n.thumb\n.align 2\n";

/** 落とし物のラベル名（Bochi と同じ `HiddenItem_BB_MM_<id>`。HiddenItem.s の生成範囲と maps\ の JSON に書く）。 */
export function itemBallLabel(bank: number, map: number, id: string): string {
  return `HiddenItem_${String(bank).padStart(2, "0")}_${String(map).padStart(2, "0")}_${id}`;
}

/** HiddenItem.s の生成範囲の終わりが見つからないときの Error。 */
export class HiddenItemSourceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HiddenItemSourceError";
  }
}

/**
 * assembly/overworld_scripts/HiddenItem.s の、落とし物（ItemBalls）の生成範囲を作り直す。
 * Bochi の MapEditor.CfruProject.cs の BuildHiddenItemSource を写したもの:
 * - 生成範囲の外（手書き部分）はそのまま残す。手書き部分が空なら `.text` などの先頭を付ける。
 * - 範囲はラベル名の順に並べる。前回の範囲があり、道具が同じならその範囲をそのまま使う。
 * - 落とし物の数・識別子・道具・ラベルが前回と同じなら、ファイルを変えない（元の文字列を返す）。
 * - 落とし物が無く、ファイルも無い（空）なら null（ファイルを作らない）。
 *
 * `previous` は前回保存したときの落とし物（識別子 → 落とし物）。maps\ の JSON に書かれていたもの。
 */
export function buildHiddenItemSource(existing: string, items: readonly ItemBall[], previous: ReadonlyMap<string, ItemBall>): string | null {
  const oldBlocks = new Map<string, string>();
  for (const m of existing.matchAll(BLOCK_PATTERN)) oldBlocks.set(m.groups!["id"]!, m[0]);
  const manualRaw = existing.replace(BLOCK_PATTERN, "");
  if ((existing.match(BEGIN_PATTERN)?.length ?? 0) !== oldBlocks.size) {
    throw new HiddenItemSourceError("HiddenItem.s の生成範囲の終端が見つかりません");
  }
  const sorted = [...items].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0));
  if (sorted.length === 0 && existing.length === 0) return null;
  const unchanged =
    sorted.length === oldBlocks.size &&
    sorted.every((i) => {
      const old = previous.get(i.id);
      return oldBlocks.has(i.id) && old !== undefined && old.itemId === i.itemId && old.label === i.label;
    });
  if (unchanged) return existing;
  const manual = manualRaw.length === 0 ? DEFAULT_MANUAL : manualRaw;
  let text = manual.replace(/[\r\n]+$/, "");
  for (const item of sorted) {
    text += "\n\n";
    const block = oldBlocks.get(item.id);
    const old = previous.get(item.id);
    if (block !== undefined && old !== undefined && old.itemId === item.itemId) {
      text += block.replace(/[\r\n]+$/, "");
      continue;
    }
    text += hiddenItemBlock(item);
  }
  return text + "\n";
}

/** 落とし物 1 つ分の生成範囲（終わりの改行なし）。拾うスクリプトは Bochi と同じバイト列。 */
export function hiddenItemBlock(item: ItemBall): string {
  return (
    `@ BBE-BEGIN ${item.id}\n` +
    `.global ${item.label}\n` +
    `${item.label}:\n` +
    `    .byte 0x1A, 0x00, 0x80, 0x${hex2(item.itemId & 0xff)}, 0x${hex2(item.itemId >> 8)}\n` +
    `    .byte 0x1A, 0x01, 0x80, 0x01, 0x00, 0x09, 0x01, 0x02\n` +
    `@ BBE-END ${item.id}`
  );
}

function hex2(v: number): string {
  return formatHex(v, 2);
}
