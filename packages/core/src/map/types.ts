/** マップの番号（バンク.マップ）。 */
export interface MapId {
  readonly bank: number;
  readonly map: number;
}

/** マップヘッダー（28 バイト）。オフセットは ROM 先頭からの値。 */
export interface MapHeader {
  /** ヘッダー自身の位置。 */
  readonly offset: number;
  /** フッター（レイアウト）の位置。 */
  readonly layoutOffset: number;
  /** イベントの位置。無ければ null。 */
  readonly eventsOffset: number | null;
  /** マップスクリプトの位置。無ければ null。 */
  readonly scriptsOffset: number | null;
  /** 接続の位置。無ければ null。 */
  readonly connectionsOffset: number | null;
  /** 曲番号。 */
  readonly music: number;
  /** レイアウト番号。 */
  readonly layoutId: number;
  /** 地名（タウンマップの区画）番号。 */
  readonly regionMapSectionId: number;
  /** 洞窟（フラッシュ）。 */
  readonly cave: number;
  /** 天気。 */
  readonly weather: number;
  /** マップの種類。 */
  readonly mapType: number;
  /** 自転車に乗れるか。 */
  readonly bikingAllowed: number;
  /** 0x19 のフラグ（bit0 あなぬけ、bit1 走る、bit2〜 地名表示）。 */
  readonly flags: number;
  /** 階数。 */
  readonly floorNum: number;
  /** 戦闘の背景の種類。 */
  readonly battleType: number;
}

/** フッター（レイアウト、28 バイト）と、そこから読んだ配置データ。 */
export interface MapLayout {
  /** フッター自身の位置。 */
  readonly offset: number;
  /** 幅（ブロック数）。 */
  readonly width: number;
  /** 高さ（ブロック数）。 */
  readonly height: number;
  /** ボーダーの位置。 */
  readonly borderOffset: number;
  /** ブロック配置の位置。 */
  readonly blocksOffset: number;
  /** 主タイルセットのヘッダー位置。 */
  readonly primaryTilesetOffset: number;
  /** 副タイルセットのヘッダー位置。 */
  readonly secondaryTilesetOffset: number;
  /** ボーダーの幅。 */
  readonly borderWidth: number;
  /** ボーダーの高さ。 */
  readonly borderHeight: number;
  /** ブロック配置（幅×高さ。下位 10 ビットがブロック番号、上位 6 ビットが移動許可）。 */
  readonly blocks: Uint16Array;
  /** ボーダー（ボーダー幅×高さ）。 */
  readonly border: Uint16Array;
}

/** タイルセットヘッダー（24 バイト）。 */
export interface TilesetHeader {
  /** ヘッダー自身の位置。 */
  readonly offset: number;
  /** タイル画像が LZ77 圧縮か。 */
  readonly isCompressed: boolean;
  /** 副タイルセットか。 */
  readonly isSecondary: boolean;
  /** タイル画像の位置。 */
  readonly tilesOffset: number;
  /** パレットの位置（16 色 × 16 本）。 */
  readonly palettesOffset: number;
  /** ブロック定義の位置。 */
  readonly blocksOffset: number;
  /** アニメーション処理の関数ポインタ（そのままの値。無ければ 0）。 */
  readonly callback: number;
  /** ブロック属性の位置。 */
  readonly attributesOffset: number;
}

/** タイルセットの中身。 */
export interface Tileset {
  readonly header: TilesetHeader;
  /** 4bpp タイル画像（展開済み、1 枚 32 バイト）。 */
  readonly tiles: Uint8Array;
  /** パレット（BGR555、16 本 × 16 色）。 */
  readonly palettes: Uint16Array;
  /** ブロック定義（1 ブロック 8 個の u16。前半 4 個が下層、後半 4 個が上層）。 */
  readonly blocks: Uint16Array;
  /** ブロック属性（1 ブロック 1 個の u32）。 */
  readonly attributes: Uint32Array;
}

/** マップ 1 枚を描画・編集するのに要るデータ一式。 */
export interface LoadedMap {
  readonly id: MapId;
  readonly header: MapHeader;
  readonly layout: MapLayout;
  readonly primary: Tileset;
  readonly secondary: Tileset;
}
