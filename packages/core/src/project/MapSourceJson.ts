import type { BochiJsonValue } from "./BochiJson.js";
import { writeIndentedJson } from "./BochiJson.js";
import { ProjectFormatError } from "./ProjectFormatError.js";
import { asRecord, parseJsonObject, readArray, readBytes, readInt, readString } from "./jsonRead.js";

/** maps\BB\MM.json の Format の値。 */
export const MAP_SOURCE_FORMAT = 1;

/** マップスクリプトの条件表（Bochi の CfruMapScriptList）。 */
export interface MapScriptListSource {
  /** MapScripts の中の、ポインタを書く位置（種類のバイトの次）。 */
  tableOffset: number;
  /** 条件表のバイト列（終端の 8 バイトを含む）。 */
  data: Uint8Array;
}

/** 落とし物（Bochi の CfruItemBall）。 */
export interface ItemBallSource {
  id: string;
  personIndex: number;
  itemId: number;
  label: string;
}

/** 野生のエリア（Bochi の CfruWildArea）。 */
export interface WildAreaSource {
  rate: number;
  /** スロットのバイト列（空ならエリア無し）。 */
  slots: Uint8Array;
}

/** 野生の時間帯 1 つ分（Bochi の CfruWildTime）。 */
export interface WildTimeSource {
  time: number;
  areas: WildAreaSource[];
}

/**
 * maps\BB\MM.json の中身（Bochi の CfruMapSource と同じ並び）。
 * 構造体どうしをつなぐポインタは 0 にしてある（ビルド時に作り直す）。
 * - Header: 0x00〜0x0F（フッター・イベント・スクリプト・接続のポインタ）が 0。
 * - Footer: 0x08〜0x17（ボーダー・配置・主・副タイルセットのポインタ）が 0。タイルセットは PrimaryTileset / SecondaryTileset に別に持つ。
 * - EventHeader: 0x04〜0x13（4 つの一覧のポインタ）が 0。表が無ければ空。
 * - ConnectionsHeader: 0x04〜0x07 が 0。表が無ければ空。
 * - MapScripts: 種類 2・4 で条件表を持つ件のポインタが 0（表は MapScriptLists）。
 * - Persons: 落とし物の人のスクリプトのポインタが 0（ItemBalls から作る）。
 */
export interface CfruMapSource {
  format: number;
  bank: number;
  number: number;
  header: Uint8Array;
  footer: Uint8Array;
  layout: Uint8Array;
  border: Uint8Array;
  primaryTileset: number;
  secondaryTileset: number;
  mapName: Uint8Array;
  eventHeader: Uint8Array;
  persons: Uint8Array;
  warps: Uint8Array;
  traps: Uint8Array;
  signs: Uint8Array;
  connectionsHeader: Uint8Array;
  connections: Uint8Array;
  mapScripts: Uint8Array;
  mapScriptLists: MapScriptListSource[];
  itemBalls: ItemBallSource[];
  wild: WildTimeSource[];
}

/** maps\BB\MM.json の文字列と CfruMapSource の相互変換。 */
export class MapSourceJson {
  /** JSON を読む。形式が不正なら ProjectFormatError。 */
  static parse(text: string, path: string | null = null): CfruMapSource {
    const o = parseJsonObject(text, path);
    const source: CfruMapSource = {
      format: readInt(o, "Format", path, MAP_SOURCE_FORMAT),
      bank: readInt(o, "Bank", path),
      number: readInt(o, "Number", path),
      header: readBytes(o, "Header", path),
      footer: readBytes(o, "Footer", path),
      layout: readBytes(o, "Layout", path),
      border: readBytes(o, "Border", path),
      primaryTileset: readInt(o, "PrimaryTileset", path, 0),
      secondaryTileset: readInt(o, "SecondaryTileset", path, 0),
      mapName: readBytes(o, "MapName", path),
      eventHeader: readBytes(o, "EventHeader", path),
      persons: readBytes(o, "Persons", path),
      warps: readBytes(o, "Warps", path),
      traps: readBytes(o, "Traps", path),
      signs: readBytes(o, "Signs", path),
      connectionsHeader: readBytes(o, "ConnectionsHeader", path),
      connections: readBytes(o, "Connections", path),
      mapScripts: readBytes(o, "MapScripts", path),
      mapScriptLists: readArray(o, "MapScriptLists", path).map((v) => {
        const e = asRecord(v, "MapScriptLists の要素", path);
        return { tableOffset: readInt(e, "TableOffset", path), data: readBytes(e, "Data", path) };
      }),
      itemBalls: readArray(o, "ItemBalls", path).map((v) => {
        const e = asRecord(v, "ItemBalls の要素", path);
        return {
          id: readString(e, "Id", path),
          personIndex: readInt(e, "PersonIndex", path),
          itemId: readInt(e, "ItemId", path),
          label: readString(e, "Label", path),
        };
      }),
      wild: readArray(o, "Wild", path).map((v) => {
        const e = asRecord(v, "Wild の要素", path);
        return {
          time: readInt(e, "Time", path),
          areas: readArray(e, "Areas", path).map((a) => {
            const area = asRecord(a, "Areas の要素", path);
            return { rate: readInt(area, "Rate", path, 0), slots: readBytes(area, "Slots", path) };
          }),
        };
      }),
    };
    MapSourceJson.validate(source, path);
    return source;
  }

  /** Bochi と同じ整形で JSON にする（CRLF、末尾の改行つき）。 */
  static stringify(source: CfruMapSource): string {
    const value: { [key: string]: BochiJsonValue } = {
      Format: source.format,
      Bank: source.bank,
      Number: source.number,
      Header: source.header,
      Footer: source.footer,
      Layout: source.layout,
      Border: source.border,
      PrimaryTileset: source.primaryTileset,
      SecondaryTileset: source.secondaryTileset,
      MapName: source.mapName,
      EventHeader: source.eventHeader,
      Persons: source.persons,
      Warps: source.warps,
      Traps: source.traps,
      Signs: source.signs,
      ConnectionsHeader: source.connectionsHeader,
      Connections: source.connections,
      MapScripts: source.mapScripts,
      MapScriptLists: source.mapScriptLists.map((l) => ({ TableOffset: l.tableOffset, Data: l.data })),
      ItemBalls: source.itemBalls.map((i) => ({ Id: i.id, PersonIndex: i.personIndex, ItemId: i.itemId, Label: i.label })),
      Wild: source.wild.map((w) => ({ Time: w.time, Areas: w.areas.map((a) => ({ Rate: a.rate, Slots: a.slots })) })),
    };
    return writeIndentedJson(value);
  }

  /** Bochi の `CfruMapCodec.Read` と同じ最低限の確認。 */
  private static validate(source: CfruMapSource, path: string | null): void {
    if (source.format !== MAP_SOURCE_FORMAT) throw new ProjectFormatError(`対応していない Format です: ${source.format}`, path);
    if (source.bank < 0 || source.bank > 255 || source.number < 0 || source.number > 254) {
      throw new ProjectFormatError(`マップ番号が範囲外です: ${source.bank}.${source.number}`, path);
    }
    if (source.header.length !== 28 || source.footer.length !== 28) {
      throw new ProjectFormatError("Header と Footer は 28 バイトでなければなりません", path);
    }
  }
}
