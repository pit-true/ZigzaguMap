/**
 * タウンマップ（ワールドマップ）の ROM 上の位置。値は ROM 先頭からのオフセット（0x08000000 を引いた値）。
 *
 * 表そのものの位置ではなく「表を指すポインタが置かれている位置（関数のリテラルプール）」を持ち、
 * 読むときにポインタをたどる（表を移した ROM でも読めるように）。根拠は FR/LG 日本語版の関数表
 * （address_map_viewer.html）と、ソース townmap2.c / flying2.c / warpdata.c の関数名。
 *
 * AdvanceMap 1.92 の AdvanceMap.ini（WeltkarteMap3 など）は英語版の命令列を探す設定で、日本語版では
 * 見つからない（「ポジションが WeltkarteMap3 見つかりませんでした」）。また世界地図を 28 マス幅
 * （WeltkarteGroesse の既定値）と見て 15×28 の表を探すが、FR の表は 15×22 なので絵と表が読めない。
 */
export interface RegionMapAddresses {
  /**
   * 地名の表（u8 [2][15][22]。[レイヤー][縦][横]）へのポインタの位置。カントー・1〜3のしま・4〜5のしま・6〜7のしま の順。
   * GetMapNo（0x080C5348）が KantoMapNoTbl / Nana1MapNoTbl / Nana2MapNoTbl / Nana3MapNoTbl を引く。
   */
  readonly layoutPointers: readonly [number, number, number, number];
  /** 地名ごとの位置の表（s16 [n][2]。MapPosTbl）へのポインタの位置。SetMapNo_and_Pos（0x080C4F24）のリテラル。 */
  readonly positionTablePointer: number;
  /** 地名ごとの大きさの表（u16 [n][2]。MapSizeTbl）へのポインタの位置。SetMapNo_and_Pos のリテラル。 */
  readonly sizeTablePointer: number;
  /** 地名の文字列の表（MapNameTbl。ポインタ 109 個）へのポインタの位置。DrawCaveName（0x080C1D94）のリテラル。 */
  readonly nameTablePointer: number;
  /** 空を飛ぶの行き先の表（u8 [108][3]。WarpPosition）へのポインタの位置。FlyDestination（0x080C6460）のリテラル。 */
  readonly flyDestinationTablePointer: number;
  /**
   * 飛び先（回復地点）の表へのポインタの位置。GetWarpPosByNo（0x080C0E80）のリテラルで、値は表の 8 バイト手前
   * （番号 1〜20 を `値 + 番号 * 8` で引くため）。1 件 8 バイト（s8 バンク, s8 マップ, s16 X, s16 Y, 2 バイトの空き）。
   */
  readonly healLocationTablePointer: number;
  /** タウンマップの BG パレット（80 色。rg_tmap_Palette）へのポインタの位置。TransTmapData（0x080C141C）のリテラル。 */
  readonly palettePointer: number;
  /** タウンマップのタイル画像（LZ77 圧縮。rg_tmap_Character）へのポインタの位置。TransTmapData のリテラル。 */
  readonly tilesPointer: number;
  /** 4 枚の地図のタイルマップ（LZ77 圧縮、30×20。rg_tmap1〜4_Screen）へのポインタの位置。TransTmapData のリテラル。 */
  readonly screenPointers: readonly [number, number, number, number];
  /** 基本レイヤーの訪問フラグ（人ID）の switch 文。GetMapState（0x080C47C0）。 */
  readonly mapFlagFunction: number;
  /** トップレイヤー（洞窟）の訪問フラグの switch 文。GetCaveState（0x080C4A5C）。 */
  readonly dungeonFlagFunction: number;
  /** EventFlagCheck（0x0806DEC4）。switch 文の中でこの関数を呼ぶ直前の r0 をフラグとみなす。 */
  readonly eventFlagCheck: number;
}

/** ファイアレッド日本語版（BPRJ）。 */
export const BPRJ_REGION_MAP: RegionMapAddresses = {
  layoutPointers: [0xc5378, 0xc5380, 0xc5388, 0xc53b0],
  positionTablePointer: 0xc4f20,
  sizeTablePointer: 0xc4f1c,
  nameTablePointer: 0xc1e78,
  flyDestinationTablePointer: 0xc648c,
  healLocationTablePointer: 0xc0e94,
  palettePointer: 0xc14d0,
  tilesPointer: 0xc1514,
  screenPointers: [0xc1540, 0xc1554, 0xc156c, 0xc1588],
  mapFlagFunction: 0xc47c0,
  dungeonFlagFunction: 0xc4a5c,
  eventFlagCheck: 0x6dec4,
};

/** ゲームコードからタウンマップの位置を引く表。 */
export const REGION_MAP_ADDRESSES: Readonly<Record<string, RegionMapAddresses>> = {
  BPRJ: BPRJ_REGION_MAP,
};
