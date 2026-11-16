/**
 * 人物の移動タイプ（イベントの movementType、0x00〜0x50）の表（#471）。
 *
 * 根拠は FRLG 日本語版のソース `evobjdat.c` の `EvObjMoveTbl`（タイプ → 関数）と `EvObjMoveLimitFlagTbl`（移動範囲の 0 を 1 に
 * 直すタイプ）、`evobjmv.c` の各タイプの段の関数。CFRU・ND・Chronos・DPE はタイプを足していない。0x0C（MV_SEED）は元の表では
 * 関数が無く（NULL）、CFRU が何もしない動きに直している。
 *
 * 0x07・0x08 の名前は `EvObjMoveTbl` のコメントでは MV_DOWN・MV_UP だが、`EvObjDefaultSiteTbl` の値（0x07 が上）と
 * コメントに合わせ、0x07 を MV_UP とする。
 */

/** 動き方の組。`NpcSimulation` がこの組ごとに段の関数を持つ。 */
export type NpcMovementFamily =
  /** 動かない（向きも変えない）。 */
  | "still"
  /** その場で向きを変える（待ちの後に表から選ぶ）。 */
  | "look"
  /** 歩き回る（待ちの後に向きを選び、通れれば 1 マス歩く）。 */
  | "wander"
  /** 一定の向きで止まる。 */
  | "face"
  /** その場で回る（48 フレームごと）。 */
  | "spin"
  /** 道の往復（範囲の端で折り返す）。 */
  | "route2"
  /** 道の周回（4 つの向きの表を順に進む）。 */
  | "route3"
  /** 主人公の動きをまねる。 */
  | "copy"
  /** 木・岩・砂に隠れる。 */
  | "hide"
  /** その場で足踏みを続ける。 */
  | "stayWalk"
  /** 見えない。 */
  | "vanish"
  /** 再戦の合図の絵のアニメ。 */
  | "revenge";

/** 待ちの表（`evobjmv.c:438`）。乱数の下位 2 ビットで選ぶ。 */
export const NPC_WAIT_NORMAL: readonly number[] = [32, 64, 96, 128];
/** 低速の待ちの表。元のソースに定義はあるが、どのタイプも使っていない（低速の歩き回りも通常の表を使う）。 */
export const NPC_WAIT_SLOW: readonly number[] = [32, 64, 128, 192];
/** 短い待ちの表（2 方向・3 方向の見回し）。 */
export const NPC_WAIT_QUICK: readonly number[] = [32, 48, 64, 80];
/** 回るタイプの待ち（`ObjDirectSpinL1`）。 */
export const NPC_SPIN_WAIT = 48;

/** 1 つの移動タイプ。 */
export interface NpcMovementType {
  readonly id: number;
  /** ソースの名前（`MV_ON` など）。 */
  readonly name: string;
  readonly family: NpcMovementFamily;
  /** 向き・表など、組の中の違い。組ごとに意味が違う（下の表を参照）。 */
  readonly table: string;
  /** 待ちの表（向き変え・歩き回り）。 */
  readonly waits: readonly number[] | null;
  /** 移動範囲の 0 を 1 に直すか（`EvObjMoveLimitFlagTbl`）。 */
  readonly limitFlag: boolean;
  /**
   * エディタで動かせるか。`full`: 段の関数どおりに動かす。`still`: 実機でも動かないか、主人公の動きが要るので、止めて見せる。
   * `unsupported`: 絵のアニメの長さがROMの絵の命令次第で、まだ再現していない（止めて理由を出す）。
   */
  readonly preview: "full" | "still" | "unsupported";
}

const NAMES = [
  "DMY", "OFF", "ON", "VON", "VOND", "HON", "HONR", "UP", "DOWN", "LEFT", "RIGHT", "HERO", "SEED", "V", "H", "UL", "UR", "DL", "DR",
  "LV", "RV", "UH", "DH", "SPINL", "SPINR", "RTU", "RTD", "RTL", "RTR", "RTURLD", "RTRLDU", "RTDURL", "RTLDUR", "RTULRD", "RTLRDU",
  "RTDULR", "RTRDUL", "RTLUDR", "RTUDRL", "RTRLUD", "RTDRLU", "RTRUDL", "RTUDLR", "RTLRUD", "RTDLRU", "RTUL", "RTDR", "RTLD", "RTRU",
  "RTUR", "RTDL", "RTLU", "RTRD", "COPYD", "COPYU", "COPYL", "COPYR", "HIDEW", "HIDER", "COPYGRASSD", "COPYGRASSU", "COPYGRASSL",
  "COPYGRASSR", "HIDES", "STAYWALK1D", "STAYWALK1U", "STAYWALK1L", "STAYWALK1R", "STAYWALK2D", "STAYWALK2U", "STAYWALK2L",
  "STAYWALK2R", "STAYWALK4D", "STAYWALK4U", "STAYWALK4L", "STAYWALK4R", "VANISH", "REVENGE", "REVENGE_JUMP", "REVENGE_SWING", "ON_SLOW",
] as const;

/** `EvObjMoveLimitFlagTbl`（0x00〜0x50）。 */
const LIMIT_FLAGS = "001111100000000000000000011111111111111111111111111111111001111000000000000000001";

/**
 * 周回の向きの表と、表の何番目まで来たら「元の位置の x（または y）に戻ったか」を見て次へ進むか（各 `ObjRouteXXXX1`）。
 * `"URLD:2x"` は表 U,R,L,D、work0 が 2 で元の x と同じなら 3 へ。
 */
const ROUTES = [
  "URLD:2x", "RLDU:1x", "DURL:1y", "LDUR:2y", "ULRD:2x", "LRDU:1x", "DULR:1y", "RDUL:2y", "LUDR:2y", "UDRL:1y", "RLUD:1x", "DRLU:2x",
  "RUDL:2y", "UDLR:1y", "LRUD:1x", "DLRU:2x", "ULDR:2y", "DRUL:2y", "LDRU:2x", "RULD:2x", "URDL:2y", "DLUR:2y", "LURD:2x", "RDLU:2x",
];

/** 見回しの表（`ObjDirect*Site4` の tbl）。 */
const LOOKS: Readonly<Record<number, string>> = {
  0x01: "DULR", 0x0d: "DU", 0x0e: "LR", 0x0f: "UL", 0x10: "UR", 0x11: "DL", 0x12: "DR", 0x13: "UDLD", 0x14: "DURD", 0x15: "ULRU", 0x16: "LRDD",
};

function build(): readonly NpcMovementType[] {
  return NAMES.map((name, id): NpcMovementType => {
    const base = { id, name: `MV_${name}`, limitFlag: LIMIT_FLAGS[id] === "1", waits: null, table: "" };
    if (id === 0x00 || id === 0x0b || id === 0x0c) return { ...base, family: "still", preview: "still" };
    if (LOOKS[id]) return { ...base, family: "look", table: LOOKS[id]!, waits: id <= 0x0e ? NPC_WAIT_NORMAL : NPC_WAIT_QUICK, preview: "full" };
    if (id === 0x02 || id === 0x50) return { ...base, family: "wander", table: "DULR", waits: NPC_WAIT_NORMAL, preview: "full" };
    if (id === 0x03 || id === 0x04) return { ...base, family: "wander", table: "DU", waits: NPC_WAIT_NORMAL, preview: "full" };
    if (id === 0x05 || id === 0x06) return { ...base, family: "wander", table: "LR", waits: NPC_WAIT_NORMAL, preview: "full" };
    if (id >= 0x07 && id <= 0x0a) return { ...base, family: "face", preview: "full" };
    if (id === 0x17) return { ...base, family: "spin", table: "L", waits: [NPC_SPIN_WAIT], preview: "full" };
    if (id === 0x18) return { ...base, family: "spin", table: "R", waits: [NPC_SPIN_WAIT], preview: "full" };
    if (id >= 0x19 && id <= 0x1c) return { ...base, family: "route2", preview: "full" };
    if (id >= 0x1d && id <= 0x34) return { ...base, family: "route3", table: ROUTES[id - 0x1d]!, preview: "full" };
    if ((id >= 0x35 && id <= 0x38) || (id >= 0x3b && id <= 0x3e)) return { ...base, family: "copy", preview: "still" };
    if (id === 0x39 || id === 0x3a || id === 0x3f) return { ...base, family: "hide", preview: "still" };
    if (id >= 0x40 && id <= 0x4b) return { ...base, family: "stayWalk", table: String([1, 2, 4][(id - 0x40) >> 2]), preview: "full" };
    if (id === 0x4c) return { ...base, family: "vanish", preview: "full" };
    return { ...base, family: "revenge", preview: "unsupported" };
  });
}

let types: readonly NpcMovementType[] | undefined;

/** 0x00〜0x50 の全部の移動タイプ。 */
export function npcMovementTypes(): readonly NpcMovementType[] {
  return (types ??= build());
}

/** 番号の移動タイプ。表の外（0x51 以上）は null。 */
export function npcMovementType(id: number): NpcMovementType | null {
  return Number.isInteger(id) && id >= 0 ? npcMovementTypes()[id] ?? null : null;
}
