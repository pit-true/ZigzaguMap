/** 表示 > 人物を動かす（#471）の文言。 */
export const jaNpcMotion = {
  menu: "人物を動かす",
  started: (moving: number, still: number) => `人物を動かしています（動く人物 ${moving} 人、止めて見せる人物 ${still} 人）。位置は保存されません。`,
  stopped: "人物を元の位置に戻しました。",
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
