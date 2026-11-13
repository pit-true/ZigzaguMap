import type { MapConnection } from "../connection/types.js";
import type { MapEvents } from "../event/types.js";
import { BlockGrid } from "../map/BlockGrid.js";
import type { MapHeaderFields } from "../map/MapHeaderCodec.js";
import type { MapId, Tileset } from "../map/types.js";
import type { MapScriptEntry } from "../mapscript/types.js";
import { TextCodec } from "../name/TextCodec.js";
import { hasMapName } from "../name/MapNameTable.js";
import type { RenderableMap } from "../render/MapRenderer.js";
import type { WildEncounters } from "../wild/types.js";
import type { RomMapSource } from "./RomMapSource.js";

/** 落とし物（Bochi の ItemBalls）。人のスクリプトはビルド時に作られる。 */
export interface ItemBall {
  /** 識別子（32 桁の 16 進）。 */
  id: string;
  /** 何番目の人か。 */
  personIndex: number;
  /** 道具番号。 */
  itemId: number;
  /** HiddenItem.s のラベル名。 */
  label: string;
}

/** MapDocument を作るときに渡す中身。 */
export interface MapDocumentInit {
  id: MapId;
  header: MapHeaderFields;
  grid: BlockGrid;
  border: BlockGrid;
  /** フッターの 0x1A〜0x1B（未使用）。 */
  footerPadding?: number;
  primaryTileset: number;
  secondaryTileset: number;
  mapName?: Uint8Array | null;
  events?: MapEvents | null;
  connections?: MapConnection[] | null;
  mapScripts?: MapScriptEntry[] | null;
  wild?: WildEncounters[];
  itemBalls?: ItemBall[];
}

/**
 * 1 マップ分の編集状態。ヘッダー、配置、ボーダー、イベント、接続、マップスクリプト、
 * 野生、マップ名、タイルセットの参照を持つ。ROM や maps\ の JSON からは独立したコピー。
 *
 * - `null` の項目（events / connections / mapScripts）は「その表自体が無い」ことを表す。
 * - タイルセットは参照（そのままのポインタ値。maps\tilesets の ID も同じ形）だけを持つ。
 * - 条件表を持つマップスクリプトの件は、`pointer` を 0 にして表だけを持つ。
 */
export class MapDocument {
  id: MapId;
  header: MapHeaderFields;
  /** ブロック配置（編集はここに対して行う）。 */
  grid: BlockGrid;
  /** ボーダー。 */
  border: BlockGrid;
  footerPadding: number;
  /** 主タイルセットの参照（0x08000000 起点のポインタ値）。 */
  primaryTileset: number;
  /** 副タイルセットの参照。 */
  secondaryTileset: number;
  /** マップ名の元のバイト列（終端 0xFF を含む）。地名番号が名前表の範囲外なら null。 */
  mapName: Uint8Array | null;
  events: MapEvents | null;
  connections: MapConnection[] | null;
  mapScripts: MapScriptEntry[] | null;
  wild: WildEncounters[];
  itemBalls: ItemBall[];

  constructor(init: MapDocumentInit) {
    this.id = { ...init.id };
    this.header = init.header;
    this.grid = init.grid;
    this.border = init.border;
    this.footerPadding = init.footerPadding ?? 0;
    this.primaryTileset = init.primaryTileset;
    this.secondaryTileset = init.secondaryTileset;
    this.mapName = init.mapName ?? null;
    this.events = init.events ?? null;
    this.connections = init.connections ?? null;
    this.mapScripts = init.mapScripts ?? null;
    this.wild = init.wild ?? [];
    this.itemBalls = init.itemBalls ?? [];
  }

  /** ROM からマップを読んで作る。読めなければ RomError か DataError。 */
  static fromRom(source: RomMapSource, id: MapId): MapDocument {
    return source.read(id);
  }

  /** 幅（ブロック数）。 */
  get width(): number {
    return this.grid.width;
  }

  /** 高さ（ブロック数）。 */
  get height(): number {
    return this.grid.height;
  }

  /** マップ名の文字列。無ければ null。 */
  mapNameText(codec: TextCodec = TextCodec.japanese): string | null {
    return this.mapName ? codec.decode(this.mapName) : null;
  }

  /**
   * マップ名を文字列で設定する。地名番号が名前表の範囲外なら Error。
   * 同じ地名番号を使う他のマップの名前も変わる点に注意（名前は地名番号ごと）。
   */
  setMapNameText(text: string, codec: TextCodec = TextCodec.japanese): void {
    if (!hasMapName(this.header.regionMapSectionId)) {
      throw new Error(`地名番号 0x${this.header.regionMapSectionId.toString(16)} にはマップ名がありません`);
    }
    this.mapName = codec.encode(text);
  }

  /** 描画用の形にする（配置は編集中のものを使う）。 */
  toRenderable(primary: Tileset, secondary: Tileset): RenderableMap {
    return { layout: { width: this.width, height: this.height, blocks: this.grid.cells }, primary, secondary };
  }

  /** 深いコピーを作る。 */
  clone(): MapDocument {
    return new MapDocument({
      id: this.id,
      header: { ...this.header },
      grid: new BlockGrid(this.grid.width, this.grid.height, this.grid.cells),
      border: new BlockGrid(this.border.width, this.border.height, this.border.cells),
      footerPadding: this.footerPadding,
      primaryTileset: this.primaryTileset,
      secondaryTileset: this.secondaryTileset,
      mapName: this.mapName ? this.mapName.slice() : null,
      events: this.events
        ? {
            persons: this.events.persons.map((p) => ({ ...p })),
            warps: this.events.warps.map((w) => ({ ...w })),
            traps: this.events.traps.map((t) => ({ ...t })),
            signs: this.events.signs.map((s) => ({ ...s, content: { ...s.content } })),
          }
        : null,
      connections: this.connections ? this.connections.map((c) => ({ ...c })) : null,
      mapScripts: this.mapScripts
        ? this.mapScripts.map((e) => ({
            ...e,
            table: e.table ? { entries: e.table.entries.map((t) => ({ ...t })), tail: e.table.tail.slice() } : null,
          }))
        : null,
      wild: this.wild.map((w) => ({ time: w.time, areas: w.areas.map((a) => ({ rate: a.rate, slots: a.slots.map((s) => ({ ...s })) })) })),
      itemBalls: this.itemBalls.map((i) => ({ ...i })),
    });
  }
}
