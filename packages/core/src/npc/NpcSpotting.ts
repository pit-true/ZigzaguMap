import { preprocessC } from "../dns/cTable.js";

/**
 * 主人公を見つける人物の決め方（#472）。
 *
 * - 元の日本語版（`ev_trai.c:81` `EvTrainerSightCheck`）: イベントの「トレーナー」の値（`ev_type`）が 1（OTYPE_TRAINER）なら
 *   今の向きの 1 方向、3（OTYPE_TRAINER_EYEALL）なら 4 方向を見る。ほかの値は見ない。
 * - CFRU（ND・Chronos の `src/overworld.c` `CheckForTrainersWantingBattle`）: 値が 0 でない人物を全部見る。1 なら 1 方向、
 *   ほかの値は 4 方向（元の `GetTrainerApproachDistance` と同じ分かれ方）。スクリプトが `trainerbattle`（0x5C）で始まれば
 *   トレーナー。始まらない人物は、`src/config.h` で `NON_TRAINER_SPOTTING` が定義されているときだけ、普通の人物として主人公を
 *   見つけてスクリプトを始める（`CheckNPCSpotting`）。
 * - 距離はイベントの「視界」の値。倒したトレーナー（フラグ）や、手持ちの数による条件はエディタでは見ない。
 */

/** 見つける人物の種類。 */
export type NpcSpotterKind = "trainer" | "npc";

/** 見つけ方。 */
export interface NpcSpotter {
  readonly kind: NpcSpotterKind;
  /** 4 方向を見るか（false なら今の向きだけ）。 */
  readonly allDirections: boolean;
  /** 視界の距離（マス）。 */
  readonly range: number;
}

/** 決めるための材料。 */
export interface NpcSpottingRules {
  /** CFRU のプロジェクトか（false なら元の日本語版の規則）。 */
  readonly cfru: boolean;
  /** `NON_TRAINER_SPOTTING` が有効か。 */
  readonly nonTrainerSpotting: boolean;
}

/** `trainerbattle` の命令の番号。 */
export const TRAINERBATTLE_COMMAND = 0x5c;

/** `src/config.h` の中身から `NON_TRAINER_SPOTTING` が有効か（コメントの中の定義は数えない）。 */
export function nonTrainerSpottingEnabled(configH: string | null): boolean {
  return configH !== null && preprocessC(configH).defines.has("NON_TRAINER_SPOTTING");
}

/**
 * 人物の見つけ方。見つけない人物は null。`scriptByte` はスクリプトの最初の 1 バイト（読めなければ null。CFRU では
 * null をトレーナーとして扱う）。
 */
export function npcSpotter(person: { readonly trainerType: number; readonly trainerRangeOrBerryTree: number }, scriptByte: number | null, rules: NpcSpottingRules): NpcSpotter | null {
  const type = person.trainerType & 0xff;
  const range = person.trainerRangeOrBerryTree & 0xffff;
  if (type === 0 || range === 0) return null;
  if (!rules.cfru) return type === 1 || type === 3 ? { kind: "trainer", allDirections: type === 3, range } : null;
  const allDirections = type !== 1;
  if (scriptByte === null || scriptByte === TRAINERBATTLE_COMMAND) return { kind: "trainer", allDirections, range };
  return rules.nonTrainerSpotting ? { kind: "npc", allDirections, range } : null;
}
