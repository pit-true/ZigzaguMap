/** 表示 > 人物を動かす（#471）の文言。 */
export const jaNpcMotion = {
  menu: "人物を動かす",
  started: (moving: number, still: number) => `人物を動かしています（動く人物 ${moving} 人、止めて見せる人物 ${still} 人）。位置は保存されません。`,
  stopped: "人物を元の位置に戻しました。",
  rangesMenu: "人物の移動範囲と視界",
  rangesOn: (npc: boolean) => `移動範囲（青）とトレーナーの視界（赤）を表示しています。${npc ? "主人公を見つける普通の人物の視界は橙の点線です。" : ""}×は視界を遮るマスです。`,
  rangesOff: "移動範囲と視界の表示を終えました。",
  missing: (count: number) => `人物を動かす: 読めない画像が${count}件あります。`,
  /** 止めて見せる理由（自動操作と状態の欄）。 */
  reasons: {
    still: "動かないタイプ",
    copy: "主人公の動きをまねるタイプ（仮の主人公は歩かない）",
    hide: "隠れるタイプ（木・岩・砂の絵は描かない）",
    unsupported: "再戦の合図のアニメ（未対応）",
    unknown: "表に無いタイプ",
  },
};
