import { PARTY_FLAG_CUSTOM_MOVES, PARTY_FLAG_HAS_ITEM, type TrainerMon } from "@zigzagumap/core";
import { jaTrainer } from "../../i18n/ja.trainer";

/** 番号を `0x1A` の形にする。 */
export const hex = (n: number): string => `0x${n.toString(16).toUpperCase()}`;

/** 数の欄を読む（`0x` か `$` で 16 進、ほかは 10 進。読めなければ Error）。 */
export function parseNumber(text: string): number {
  const s = text.trim();
  const n = /^(0x|\$)[0-9a-f]+$/i.test(s) ? parseInt(s.replace(/^(0x|\$)/i, ""), 16) : /^[0-9]+$/.test(s) ? parseInt(s, 10) : NaN;
  if (!Number.isInteger(n)) throw new Error(`数ではありません: ${text}`);
  return n;
}

/** 手持ちの欄の文字（`0x10 9, 0x13 8`）。 */
export function partyText(party: readonly TrainerMon[]): string {
  return party.map((m) => `${hex(m.species)} ${m.level}`).join(", ");
}

/** 手持ちの欄を読む（1〜6 匹。読めなければ Error）。 */
export function parseParty(text: string): TrainerMon[] {
  const parts = text
    .split(/[,、]/)
    .map((x) => x.trim())
    .filter((x) => x !== "");
  const party = parts.map((part) => {
    const [species, level] = part.split(/\s+/);
    const m = { iv: 0, species: parseNumber(species ?? ""), level: parseNumber(level ?? "") };
    if (m.species < 1 || m.level < 1 || m.level > 100) throw new Error(jaTrainer.badParty(text));
    return m;
  });
  if (party.length < 1 || party.length > 6) throw new Error(jaTrainer.badParty(text));
  return party;
}

/**
 * 手持ちの欄で直した種族とレベルを、元の手持ちに重ねる。同じ並びの元のポケモンの個体値・持ち物・技は残す
 * （欄で増やした分は、形式が持ち物・技を持つなら 0 で埋める）。
 */
export function mergeParty(before: readonly TrainerMon[], edited: readonly TrainerMon[], partyFlags: number): TrainerMon[] {
  return edited.map((m, i) => {
    const old = before[i];
    const out: TrainerMon = { iv: old?.iv ?? 0, level: m.level, species: m.species };
    if (partyFlags & PARTY_FLAG_HAS_ITEM) out.heldItem = old?.heldItem ?? 0;
    if (partyFlags & PARTY_FLAG_CUSTOM_MOVES) out.moves = [...(old?.moves ?? [0, 0, 0, 0])];
    return out;
  });
}
