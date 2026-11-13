import type { GameOffsets } from "../game/offsets.js";
import type { Rom } from "../rom/Rom.js";
import { MapBankTable } from "./MapBankTable.js";
import { MapHeaderReader } from "./MapHeaderReader.js";
import { MapLayoutReader } from "./MapLayoutReader.js";
import { TilesetReader } from "./TilesetReader.js";
import type { LoadedMap, MapHeader, MapId, MapLayout, Tileset } from "./types.js";

/** バンク表からマップ一式（ヘッダー、レイアウト、タイルセット）を読むクラス。タイルセットはキャッシュする。 */
export class MapLoader {
  /** マップバンク表。 */
  readonly bankTable: MapBankTable;
  private readonly headers: MapHeaderReader;
  private readonly layouts: MapLayoutReader;
  private readonly tilesets: TilesetReader;
  private readonly tilesetCache = new Map<string, Tileset>();

  constructor(rom: Rom, offsets: GameOffsets) {
    this.bankTable = MapBankTable.read(rom, offsets.mapBankTablePointer);
    this.headers = new MapHeaderReader(rom);
    this.layouts = new MapLayoutReader(rom);
    this.tilesets = new TilesetReader(rom);
  }

  /** マップヘッダーを読む。 */
  readHeader(id: MapId): MapHeader {
    return this.headers.read(this.bankTable.headerOffset(id));
  }

  /** マップのレイアウト（配置とボーダー）を読む。 */
  readLayout(id: MapId): MapLayout {
    return this.layouts.read(this.readHeader(id).layoutOffset);
  }

  /** タイルセットを読む（同じ位置・同じ側なら使い回す）。 */
  readTileset(offset: number, asSecondary: boolean): Tileset {
    const key = `${offset}:${asSecondary ? 1 : 0}`;
    let tileset = this.tilesetCache.get(key);
    if (!tileset) {
      tileset = this.tilesets.read(offset, asSecondary);
      this.tilesetCache.set(key, tileset);
    }
    return tileset;
  }

  /** マップ 1 枚の描画・編集に要るデータ一式を読む。 */
  load(id: MapId): LoadedMap {
    const header = this.readHeader(id);
    const layout = this.layouts.read(header.layoutOffset);
    return {
      id,
      header,
      layout,
      primary: this.readTileset(layout.primaryTilesetOffset, false),
      secondary: this.readTileset(layout.secondaryTilesetOffset, true),
    };
  }
}
