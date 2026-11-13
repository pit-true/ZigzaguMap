import { ConnectionReader } from "../connection/ConnectionReader.js";
import { EventReader } from "../event/EventReader.js";
import type { GameOffsets } from "../game/offsets.js";
import { BlockGrid } from "../map/BlockGrid.js";
import { MapBankTable } from "../map/MapBankTable.js";
import { mapFooterCodec, mapHeaderCodec } from "../map/MapHeaderCodec.js";
import { MapLoader } from "../map/MapLoader.js";
import { MAP_HEADER_SIZE, MAP_LAYOUT_SIZE } from "../map/constants.js";
import type { MapId, Tileset } from "../map/types.js";
import { MapScriptReader } from "../mapscript/MapScriptReader.js";
import { MapNameTable } from "../name/MapNameTable.js";
import type { Rom } from "../rom/Rom.js";
import { ROM_BASE } from "../rom/Rom.js";
import { RomError } from "../rom/RomError.js";
import { WildTable } from "../wild/WildTable.js";
import { MapDocument } from "./MapDocument.js";

/** 1 マップの幅×高さの上限（Bochi と同じ 255×255）。 */
const MAX_MAP_CELLS = 255 * 255;

/**
 * ROM から MapDocument を作るクラス。バンク表・マップ名表・野生ヘッダー表は最初に使うときに読む。
 * 読み方は Bochi 改造版の `CfruMapCodec.Capture` に合わせる。
 */
export class RomMapSource {
  /** マップバンク表。 */
  readonly bankTable: MapBankTable;
  /** タイルセットの読み取りに使うローダー（キャッシュつき）。 */
  readonly loader: MapLoader;
  private readonly events: EventReader;
  private readonly connections: ConnectionReader;
  private readonly scripts: MapScriptReader;
  private nameTableCache: MapNameTable | null = null;
  private wildTableCache: WildTable | null = null;

  /** `bankCounts` を渡すとバンクごとのマップ数にそれを使い、省略すると ROM から推定する。 */
  constructor(
    readonly rom: Rom,
    readonly offsets: GameOffsets,
    bankCounts?: readonly number[],
  ) {
    this.bankTable = bankCounts
      ? MapBankTable.readWithCounts(rom, offsets.mapBankTablePointer, bankCounts)
      : MapBankTable.read(rom, offsets.mapBankTablePointer);
    this.loader = new MapLoader(rom, offsets, this.bankTable);
    this.events = new EventReader(rom);
    this.connections = new ConnectionReader(rom);
    this.scripts = new MapScriptReader(rom);
  }

  /** マップ名表。 */
  get nameTable(): MapNameTable {
    return (this.nameTableCache ??= MapNameTable.read(this.rom, this.offsets.mapNameTablePointer));
  }

  /** 野生ヘッダー表（昼）。 */
  get wildTable(): WildTable {
    return (this.wildTableCache ??= WildTable.read(this.rom, this.offsets.wildHeaderTablePointer));
  }

  /** ROM にそのマップがあるか。 */
  has(id: MapId): boolean {
    return id.map >= 0 && id.map < this.bankTable.mapCount(id.bank);
  }

  /** マップを読んで MapDocument にする。読めなければ RomError か DataError。 */
  read(id: MapId): MapDocument {
    const rom = this.rom;
    const headerAt = this.bankTable.headerOffset(id);
    const header = mapHeaderCodec.decode(rom.slice(headerAt, MAP_HEADER_SIZE));
    const footerAt = this.toOffset(header.layout, "フッター");
    const footer = mapFooterCodec.decode(rom.slice(footerAt, MAP_LAYOUT_SIZE));
    const { width, height, borderWidth, borderHeight } = footer;
    if (width === 0 || height === 0 || width * height > MAX_MAP_CELLS || borderWidth === 0 || borderHeight === 0) {
      throw new RomError(`マップ ${id.bank}.${id.map} の大きさが不正です: ${width}×${height}`);
    }
    const blocks = rom.u16Array(this.toOffset(footer.blocks, "配置"), width * height);
    const border = rom.u16Array(this.toOffset(footer.border, "ボーダー"), borderWidth * borderHeight);

    const { layout: _l, events: _e, scripts: _s, connections: _c, ...fields } = header;
    return new MapDocument({
      id,
      header: fields,
      grid: new BlockGrid(width, height, blocks),
      border: new BlockGrid(borderWidth, borderHeight, border),
      footerPadding: footer.padding,
      primaryTileset: footer.primaryTileset,
      secondaryTileset: footer.secondaryTileset,
      mapName: this.nameTable.rawName(header.regionMapSectionId)?.slice() ?? null,
      events: header.events === 0 ? null : this.events.read(this.toOffset(header.events, "イベント")),
      connections: header.connections === 0 ? null : this.connections.read(this.toOffset(header.connections, "接続")),
      mapScripts:
        header.scripts === 0
          ? null
          : // 条件表のポインタ（表の位置）も残す。場所の設定で表の位置として見せるだけで、出力では 0 にして表を書き直す
            this.scripts.read(this.toOffset(header.scripts, "マップスクリプト")),
      wild: this.wildTable.readEncounters(id.bank, id.map),
      itemBalls: [],
    });
  }

  /** タイルセットを ROM から読む（参照はそのままのポインタ値）。 */
  readTileset(pointer: number, asSecondary: boolean): Tileset {
    return this.loader.readTileset(this.toOffset(pointer, "タイルセット"), asSecondary);
  }

  private toOffset(pointer: number, what: string): number {
    if (!this.rom.isPointer(pointer)) throw new RomError(`${what}のポインタが ROM 外です: 0x${pointer.toString(16)}`);
    return pointer - ROM_BASE;
  }
}
