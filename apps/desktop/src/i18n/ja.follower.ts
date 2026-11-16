/** 仮の主人公の連れ歩き（#476・#477）の文言。 */
export const jaFollower = {
  toggle: "連れ歩き",
  shiny: "色違い",
  female: "メス",
  /** 連れ歩きを出せない理由。 */
  reasons: {
    noProject: "連れ歩き: プロジェクトフォルダを開くと使えます。",
    noSource: "連れ歩き: このプロジェクトには src/follower_mon.c がありません。",
    disabled: "連れ歩き: src/config.h で POKEMON_FOLLOWERS が有効になっていません。",
    noDpe: "連れ歩き: DPE のフォルダ（graphics/ow と include/species.h）を読めません。",
    noSheets: "連れ歩き: DPE の graphics/ow に絵がありません。",
  },
};
