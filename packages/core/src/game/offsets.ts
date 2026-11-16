/**
 * ゲームごとのオフセット定義。ROM 内の固定位置はすべてこのファイルに集める。
 * 値は ROM 先頭からのオフセット（0x08000000 を引いた値）。
 */
export interface GameOffsets {
  /** マップバンク表へのポインタが置かれている位置。 */
  readonly mapBankTablePointer: number;
  /** 野生ヘッダー表（昼）へのポインタが置かれている位置。 */
  readonly wildHeaderTablePointer: number;
  /** マップ名表へのポインタが置かれている位置。 */
  readonly mapNameTablePointer: number;
  /** 種族名表（gSpeciesNames）へのポインタが置かれている位置。 */
  readonly speciesNameTablePointer: number;
  /** OW の画像情報の表（gObjectEventGraphicsInfoPointers）へのポインタが置かれている位置。 */
  readonly overworldGraphicsTablePointer: number;
  /** OW のパレット表（sObjectEventSpritePalettes）へのポインタが置かれている位置。 */
  readonly overworldPaletteTablePointer: number;
  /** 歩きと停止のコマを対応させる表（EvActBootsAnimeNoStのリテラル）。 */
  readonly overworldWalkingTablePointer: number;
  readonly messageFrameTilesPointer: number;
  readonly signFrameTilesPointer: number;
  readonly textWindowPalettesPointer: number;
  readonly messageFrameWriter: number;
  readonly emotionTemplatePointer: number;
  /** フィールドエフェクトのSpriteTemplate表（FeShadeSet内のリテラル）。 */
  readonly fieldEffectTemplateTablePointer: number;
  /** CFRUのDrawBlockHookが差し込まれる位置。 */
  readonly drawBlockHook: number;
  /** ドアの表（total_door_anime_table）を指すリテラルの位置（OpenDoorCellSet の中）。 */
  readonly doorAnimationTablePointer: number;
  /** ドアを開ける手順の表（1 マス・縦 2 マス）を指すリテラルの位置。 */
  readonly doorOpenSequencePointers: readonly [number, number];
  /** ドアを閉める手順の表（1 マス・縦 2 マス）を指すリテラルの位置。 */
  readonly doorCloseSequencePointers: readonly [number, number];
  /** タイルセットヘッダー（24 バイト）が番号順に並ぶ表の位置（AdvanceMap のタイルセット番号はこの並び）。 */
  readonly tilesetHeaderTable: number;
  /** 表のタイルセットの数。 */
  readonly tilesetCount: number;
  /** フライトポジション（空を飛ぶの行き先、8 バイト）の表へのポインタが置かれている位置（AdvanceMap の FlugposHeader）。 */
  readonly flyTablePointer: number;
  /** フライトポジションの表の件数。 */
  readonly flyTableCount: number;
  /** 道具の表へのポインタが置かれている位置（AdvanceMap の ItemHeader2）。 */
  readonly itemTablePointer: number;
  /** 道具の数（0 番を含む。AdvanceMap の AnzItems + 1）。 */
  readonly itemCount: number;
  /** 天候の絵と表を指すリテラルの位置（#498。weather.c・wea_*.c の関数の中）。 */
  readonly weather: WeatherOffsets;
}

/** 天候の絵・表を指すリテラルの位置。どれも素の BPRJ の逆アセンブルで照合した。 */
export interface WeatherOffsets {
  /** 天候ごとの関数の表（sub_proc_tbl。1 件 16 バイト）。TaskWeatherWait の中。 */
  readonly functionTable: number;
  /** 共通パレット（weather_common_Palette）。WeatherInit の中。 */
  readonly commonPalette: number;
  /** パレットごとの暗くする表の種類（FadeTblTypeDefault の 32 バイト）。make_weather_fade_tbl の中。 */
  readonly fadeTypeTable: number;
  /** sin_cos_table（雪の揺れ・砂嵐）。WeatherVeryShineProc の中。 */
  readonly sineTable: number;
  /** 雲: CellData・パレット・actHeader。set_cloud_actor の中。 */
  readonly cloudCell: number;
  readonly cloudPalette: number;
  readonly cloudHeader: number;
  /** 雨: CellData（RainCellSet）・actHeader（RainActorAdd）。 */
  readonly rainCell: number;
  readonly rainHeader: number;
  /** 雪: actHeader（絵は転送の表）。add_single_snow_obj の中。 */
  readonly snowHeader: number;
  /** 霧: CellData・actHeader。add_mist_obj の中。 */
  readonly fogCell: number;
  readonly fogHeader: number;
  /** 火山灰: CellData（set_ash_cell）・actHeader（add_ash_obj）。 */
  readonly ashCell: number;
  readonly ashHeader: number;
  /** 霧2: CellData・actHeader。add_mist2_obj の中。 */
  readonly fogDiagonalCell: number;
  readonly fogDiagonalHeader: number;
  /** 砂嵐: CellData・パレット・actHeader。add_storm_obj の中。 */
  readonly sandstormCell: number;
  readonly sandstormPalette: number;
  readonly sandstormHeader: number;
  /** CFRU が砂嵐のパレットの読み込みを差し替える位置（ReplaceOWSandstormPaletteHook）。 */
  readonly sandstormPaletteHook: number;
  /** 泡: CellData（InitMarine）・actHeader（add_awa_actor）。 */
  readonly bubbleCell: number;
  readonly bubbleHeader: number;
}

/** ファイアレッド日本語版（BPRJ）。 */
export const BPRJ_OFFSETS: GameOffsets = {
  mapBankTablePointer: 0x54b0c,
  wildHeaderTablePointer: 0x8257c,
  mapNameTablePointer: 0xc1e78,
  speciesNameTablePointer: 0x144,
  overworldGraphicsTablePointer: 0x5ebb4,
  overworldPaletteTablePointer: 0x5ed98,
  overworldWalkingTablePointer: 0x62df8,
  messageFrameTilesPointer: 0x152e2c,
  signFrameTilesPointer: 0x152df8,
  textWindowPalettesPointer: 0x153514,
  messageFrameWriter: 0xf8184,
  emotionTemplatePointer: 0x82160,
  fieldEffectTemplateTablePointer: 0xdc258,
  drawBlockHook: 0x5a274,
  doorAnimationTablePointer: 0x5ab54,
  doorOpenSequencePointers: [0x5aac8, 0x5aaac],
  doorCloseSequencePointers: [0x5ab20, 0x5ab04],
  tilesetHeaderTable: 0x298b44,
  tilesetCount: 68,
  flyTablePointer: 0xc0e44,
  flyTableCount: 20,
  itemTablePointer: 0x1c8,
  itemCount: 375,
  weather: {
    functionTable: 0x794b4,
    commonPalette: 0x79430,
    fadeTypeTable: 0x7968c,
    sineTable: 0x7a4bc,
    cloudCell: 0x7ac18,
    cloudPalette: 0x7ac1c,
    cloudHeader: 0x7ac20,
    rainCell: 0x7b374,
    rainHeader: 0x7b42c,
    snowHeader: 0x7b7b8,
    fogCell: 0x7c328,
    fogHeader: 0x7c32c,
    ashCell: 0x7c568,
    ashHeader: 0x7c5dc,
    fogDiagonalCell: 0x7c964,
    fogDiagonalHeader: 0x7c968,
    sandstormCell: 0x7cdb0,
    sandstormPalette: 0x7cdb4,
    sandstormHeader: 0x7cdb8,
    sandstormPaletteHook: 0x7cd50,
    bubbleCell: 0x7d07c,
    bubbleHeader: 0x7d1c0,
  },
};

/** ゲームコードからオフセット定義を引く表。 */
export const OFFSETS_BY_CODE: Readonly<Record<string, GameOffsets>> = {
  BPRJ: BPRJ_OFFSETS,
};
