/**
 * エメラルドの属性（u16）を FR の属性（u32）に引き直す表。
 *
 * 挙動の番号はゲームごとに違うので、ゲームのソースの属性の表（エメラルドの map_attr_table.c と FR の map_attr_sym.h の
 * 名前）で同じ意味の番号を引いた。FR に同じものが無い番号（橋・秘密基地・木の実の土など）は 0（地面）にして、一覧で知らせる。
 * FR の属性の「地形」（ビット 9〜13）と「野生の出る種類」（ビット 24〜26）は、素の BPRJ の全タイルセットで
 * その挙動にいちばん多い値に合わせる。重ね方（エメラルドのビット 12〜15、0〜2）は FR のビット 29〜30 に写す。
 */

/** エメラルドの挙動 → FR の挙動（同じ番号で同じ意味のものも書く）。無い番号は FR に無い。 */
const EMERALD_TO_FR: ReadonlyMap<number, number> = new Map<number, number>([
  [0x00, 0x00], // 地面
  [0x02, 0x02], // 草
  [0x03, 0x03], // 長い草
  [0x07, 0x07], // 短い草
  [0x08, 0x08], // 地面エンカウント
  [0x0a, 0x0a], // 地面（自転車不可）
  [0x0b, 0x0b], // 地面エンカウント（屋内）
  [0x0c, 0x0c], // 岩地形
  [0x0f, 0x66], // 落とし穴
  [0x10, 0x10], // 池、湖
  [0x11, 0x1a], // 深い水域１
  [0x12, 0x12], // 深い水域２_1
  [0x13, 0x13], // 滝
  [0x14, 0x12], // 深い水域２_2 → 深い水域２_1
  [0x15, 0x15], // 海
  [0x16, 0x16], // 水たまり
  [0x17, 0x17], // 浅瀬
  [0x19, 0x19], // 浮上不可
  [0x20, 0x23], // 氷上
  [0x21, 0x21], // 砂地
  [0x22, 0x22], // 海藻
  [0x26, 0x26], // 氷（歩くとヒビが入る氷）
  [0x27, 0x27], // 氷（ヒビが入った氷）
  [0x28, 0x28], // 温泉
  [0x2a, 0x22], // 海藻（浮上不可）→ 海藻
  ...range(0x30, 0x3b).map((v) => [v, v] as [number, number]), // 移動不可・ジャンプ
  ...range(0x40, 0x4a).map((v) => [v, v] as [number, number]), // 流される・押し出される・移動不可
  ...range(0x50, 0x53).map((v) => [v, v] as [number, number]), // 海上で流される
  ...range(0x60, 0x6b).map((v) => [v, v] as [number, number]), // 出入り口・マット・落とし穴・ワープ・ドア・エスカレーター
  [0x80, 0x80], // カウンター
  [0x81, 0x81], // 本棚
  [0x83, 0x83], // パソコン
  [0x85, 0x85], // マップ
  [0x86, 0x86], // ＴＶ
  [0x88, 0x9f], // 棚
  [0x8f, 0x8f], // アンケート用紙
  [0xc0, 0x49], // 上・下方向へ移動不可
  [0xc1, 0x4a], // 右・左方向へ移動不可
  [0xe0, 0x81], // 小さい本棚 → 本棚
  [0xe1, 0x81], // 大きな本棚１ → 本棚
  [0xe2, 0x81], // 大きな本棚２ → 本棚
  [0xe4, 0x9a], // ゴミ箱
  [0xe5, 0x9f], // デパート＆ショップの棚 → 棚
  [0xe6, 0x93], // 設計図
]);

/** FR の挙動ごとの地形（ビット 9〜13）。無ければ 0。 */
const FR_TERRAIN: ReadonlyMap<number, number> = new Map([
  [0x02, 1],
  [0x03, 1],
  ...[0x10, 0x11, 0x12, 0x15, 0x1a, 0x50, 0x51, 0x52, 0x53].map((v) => [v, 2] as [number, number]),
  [0x13, 3],
]);

/** FR の挙動ごとの野生の出る種類（ビット 24〜26。1: 草むら、2: 水上）。無ければ 0。 */
const FR_ENCOUNTER: ReadonlyMap<number, number> = new Map([
  ...[0x02, 0x03, 0x08, 0x0b].map((v) => [v, 1] as [number, number]),
  ...[0x10, 0x11, 0x12, 0x13, 0x15, 0x1a, 0x1b, 0x50, 0x51, 0x52, 0x53].map((v) => [v, 2] as [number, number]),
]);

function range(from: number, to: number): number[] {
  return Array.from({ length: to - from + 1 }, (_, i) => from + i);
}

/** 引き直した結果。 */
export interface ConvertedAttribute {
  /** FR の属性（u32）。 */
  readonly value: number;
  /** 引けなかったエメラルドの挙動（引けたら null）。 */
  readonly unknownBehavior: number | null;
}

/** エメラルドの属性（u16）を FR の属性（u32）にする。 */
export function emeraldAttributeToFr(value: number): ConvertedAttribute {
  const behavior = value & 0xff;
  const layer = (value >> 12) & 0xf;
  const fr = EMERALD_TO_FR.get(behavior);
  const beh = fr ?? 0;
  const terrain = FR_TERRAIN.get(beh) ?? 0;
  const encounter = FR_ENCOUNTER.get(beh) ?? 0;
  const layerType = layer <= 2 ? layer : 0;
  return {
    value: (beh | (terrain << 9) | (encounter << 24) | (layerType << 29)) >>> 0,
    unknownBehavior: fr === undefined ? behavior : null,
  };
}
