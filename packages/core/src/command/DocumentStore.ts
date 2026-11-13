import type { FlyPosition } from "../fly/types.js";
import type { BlockGrid } from "../map/BlockGrid.js";
import type { MapId } from "../map/types.js";
import type { MapDocument } from "../model/MapDocument.js";
import { isWorkMapId, type WorkMapInfo } from "../model/WorkMap.js";
import { hasMapName } from "../name/MapNameTable.js";
import { TextCodec } from "../name/TextCodec.js";
import type { TilesetDocument, TilesetRef } from "../tileset/TilesetDocument.js";
import type { DocumentContext } from "./DocumentContext.js";

/** DocumentStore に渡す、元のデータ（ROM・maps\）への問い合わせ。どれも省略できる。 */
export interface DocumentStoreSource {
  /** 文字列の変換器（省略時は同梱の ND の表）。 */
  readonly textCodec?: TextCodec;
  /** 編集していない地名番号のマップ名。 */
  baseMapName?(regionId: number): Uint8Array | null;
  /** 元からあるマップか（ROM か maps\ の JSON）。 */
  mapExists?(id: MapId): boolean;
  /** 元からあるマップのバンクごとの数。 */
  baseBankCounts?(): number[];
  /** タイルセットとして指せるか（省略時は 0 以外なら可）。 */
  tilesetExists?(pointer: number): boolean;
  /** AdvanceMap のタイルセット番号のポインタ値（省略時は番号を使えない）。 */
  tilesetPointer?(index: number): number | null;
  /** ポインタ値の AdvanceMap のタイルセット番号。 */
  tilesetIndex?(pointer: number): number | null;
}

/**
 * 編集中のマップとタイルセットを持つ DocumentContext。ROM だけを開いたときや、テストで使う。
 * CfruProject もこれを使ってマップを持つ。
 */
export class DocumentStore implements DocumentContext {
  /** 読み込み済み・追加したマップ（キーは `バンク.マップ`）。 */
  readonly documents = new Map<string, MapDocument>();
  /** 読み込み済みのタイルセット（キーは `ポインタ:0|1`）。 */
  readonly tilesets = new Map<string, TilesetDocument>();
  /** addMap で加えたマップ。 */
  readonly addedMaps = new Set<string>();
  /** addMap で加えた後に removeMap で除いたマップ（保存済みなら JSON を消す）。 */
  readonly removedMaps = new Set<string>();
  /** 作業用のマップ（バンク -1）の名前とパス。 */
  readonly workMaps = new Map<string, WorkMapInfo>();
  /** このセッションで変えたマップ名。 */
  readonly mapNameEdits = new Map<number, Uint8Array>();
  /** 編集中のフライトポジションの表（CfruProject が ROM の表を写し、maps\regionmap.json があれば重ねる）。 */
  readonly flyPositions: FlyPosition[] = [];
  /** 読み込んだマップが持っていた名前（地名番号ごとに最初のもの）。 */
  private readonly loadedNames = new Map<number, Uint8Array>();
  readonly textCodec: TextCodec;

  constructor(private readonly source: DocumentStoreSource = {}) {
    this.textCodec = source.textCodec ?? TextCodec.japanese;
  }

  /** マップを持たせる（読み込んだとき）。 */
  put(doc: MapDocument): void {
    this.documents.set(mapKey(doc.id), doc);
    const region = doc.header.regionMapSectionId;
    if (doc.mapName && !this.loadedNames.has(region)) this.loadedNames.set(region, doc.mapName.slice());
    const edit = this.mapNameEdits.get(region);
    if (edit && hasMapName(region)) doc.mapName = edit.slice();
  }

  /** タイルセットを持たせる。 */
  putTileset(tileset: TilesetDocument): void {
    this.tilesets.set(tilesetKey(tileset.ref), tileset);
  }

  /** 読み込み済みのマップ。無ければ undefined。 */
  find(id: MapId): MapDocument | undefined {
    return this.documents.get(mapKey(id));
  }

  /** 読み込み済みのタイルセット。無ければ undefined。 */
  findTileset(ref: TilesetRef): TilesetDocument | undefined {
    return this.tilesets.get(tilesetKey(ref));
  }

  grid(id: MapId): BlockGrid {
    return this.document(id).grid;
  }

  border(id: MapId): BlockGrid {
    return this.document(id).border;
  }

  document(id: MapId): MapDocument {
    const doc = this.find(id);
    if (!doc) throw new Error(`マップ ${mapKey(id)} は読み込まれていません`);
    return doc;
  }

  tileset(ref: TilesetRef): TilesetDocument {
    const t = this.findTileset(ref);
    if (!t) throw new Error(`タイルセット 0x${(ref.pointer >>> 0).toString(16)} は読み込まれていません`);
    return t;
  }

  tilesetExists(pointer: number): boolean {
    return this.source.tilesetExists ? this.source.tilesetExists(pointer) : pointer !== 0;
  }

  mapName(regionId: number): Uint8Array | null {
    if (!hasMapName(regionId)) return null;
    return this.mapNameEdits.get(regionId) ?? this.loadedNames.get(regionId) ?? this.source.baseMapName?.(regionId) ?? null;
  }

  mapNameEdit(regionId: number): Uint8Array | null {
    return this.mapNameEdits.get(regionId) ?? null;
  }

  setMapNameEdit(regionId: number, name: Uint8Array | null): void {
    if (name) this.mapNameEdits.set(regionId, name.slice());
    else this.mapNameEdits.delete(regionId);
    const value = this.mapName(regionId);
    for (const doc of this.documents.values()) {
      if (doc.header.regionMapSectionId === regionId) doc.mapName = value ? value.slice() : null;
    }
  }

  hasMap(id: MapId): boolean {
    return this.documents.has(mapKey(id)) || (this.source.mapExists?.(id) ?? false);
  }

  bankCounts(): number[] {
    const counts = this.source.baseBankCounts?.() ?? [];
    for (const doc of this.documents.values()) {
      const { bank, map } = doc.id;
      if (isWorkMapId(doc.id)) continue;
      while (counts.length <= bank) counts.push(0);
      counts[bank] = Math.max(counts[bank]!, map + 1);
    }
    return counts;
  }

  addMap(doc: MapDocument): void {
    const k = mapKey(doc.id);
    if (this.hasMap(doc.id)) throw new Error(`マップ ${k} は既にあります`);
    this.put(doc);
    this.addedMaps.add(k);
    this.removedMaps.delete(k);
  }

  tilesetPointer(index: number): number | null {
    return this.source.tilesetPointer?.(index) ?? null;
  }

  tilesetIndex(pointer: number): number | null {
    return this.source.tilesetIndex?.(pointer) ?? null;
  }

  putWorkMap(doc: MapDocument, info: WorkMapInfo): void {
    const k = mapKey(doc.id);
    if (!isWorkMapId(doc.id)) throw new Error(`マップ ${k} は作業用のマップの番号ではありません`);
    if (this.documents.has(k)) throw new Error(`マップ ${k} は既にあります`);
    this.put(doc);
    this.workMaps.set(k, { ...info });
  }

  removeWorkMap(id: MapId): void {
    const k = mapKey(id);
    if (!this.workMaps.has(k)) throw new Error(`マップ ${k} は作業用のマップではありません`);
    this.documents.delete(k);
    this.workMaps.delete(k);
  }

  workMapInfo(id: MapId): WorkMapInfo | null {
    return this.workMaps.get(mapKey(id)) ?? null;
  }

  setWorkMapInfo(id: MapId, info: WorkMapInfo): void {
    const k = mapKey(id);
    if (!this.workMaps.has(k)) throw new Error(`マップ ${k} は作業用のマップではありません`);
    this.workMaps.set(k, { ...info });
  }

  nextWorkMapNumber(): number {
    let next = 0;
    for (const doc of this.documents.values()) if (isWorkMapId(doc.id)) next = Math.max(next, doc.id.map + 1);
    return next;
  }

  removeMap(id: MapId): void {
    const k = mapKey(id);
    if (!this.addedMaps.has(k)) throw new Error(`マップ ${k} は追加したマップではありません`);
    this.documents.delete(k);
    this.addedMaps.delete(k);
    this.removedMaps.add(k);
  }
}

/** マップのキー（`バンク.マップ`）。 */
export function mapKey(id: MapId): string {
  return `${id.bank}.${id.map}`;
}

/** タイルセットのキー。 */
export function tilesetKey(ref: TilesetRef): string {
  return `${ref.pointer >>> 0}:${ref.secondary ? 1 : 0}`;
}
