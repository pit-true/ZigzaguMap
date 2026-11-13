import { DataError } from "../binary/DataError.js";
import { connectionCodec, connectionHeaderCodec } from "../connection/ConnectionCodec.js";
import { eventHeaderCodec } from "../event/EventHeaderCodec.js";
import { personCodec } from "../event/PersonCodec.js";
import { signCodec } from "../event/SignCodec.js";
import { trapCodec } from "../event/TrapCodec.js";
import { warpCodec } from "../event/WarpCodec.js";
import { EVENT_HEADER_SIZE } from "../event/layout.js";
import type { MapEvents } from "../event/types.js";
import { BlockGrid } from "../map/BlockGrid.js";
import { mapFooterCodec, mapHeaderCodec } from "../map/MapHeaderCodec.js";
import { mapScriptCodec } from "../mapscript/MapScriptCodec.js";
import { MAP_SCRIPT_ENTRY, MAP_SCRIPT_ENTRY_SIZE } from "../mapscript/layout.js";
import type { MapScriptEntry } from "../mapscript/types.js";
import { MapDocument } from "../model/MapDocument.js";
import { wildSlotCodec } from "../wild/WildCodec.js";
import { CONNECTION_HEADER_SIZE } from "../connection/layout.js";
import { MAP_SOURCE_FORMAT, type CfruMapSource } from "./MapSourceJson.js";
import { ProjectFormatError } from "./ProjectFormatError.js";

/** MapDocument と CfruMapSource（maps\BB\MM.json の中身）の相互変換。 */
export class MapSourceConverter {
  /** MapDocument を JSON に書く形にする。ポインタは Bochi と同じ位置を 0 にする。 */
  static toSource(doc: MapDocument): CfruMapSource {
    const events = doc.events;
    const scripts = doc.mapScripts;
    return {
      format: MAP_SOURCE_FORMAT,
      bank: doc.id.bank,
      number: doc.id.map,
      header: mapHeaderCodec.encode({ ...doc.header, layout: 0, events: 0, scripts: 0, connections: 0 }),
      footer: mapFooterCodec.encode({
        width: doc.width,
        height: doc.height,
        border: 0,
        blocks: 0,
        primaryTileset: 0,
        secondaryTileset: 0,
        borderWidth: doc.border.width,
        borderHeight: doc.border.height,
        padding: doc.footerPadding,
      }),
      layout: cellsToBytes(doc.grid.cells),
      border: cellsToBytes(doc.border.cells),
      primaryTileset: doc.primaryTileset,
      secondaryTileset: doc.secondaryTileset,
      mapName: doc.mapName ? doc.mapName.slice() : new Uint8Array(0),
      eventHeader: events
        ? eventHeaderCodec.encode({
            personCount: events.persons.length,
            warpCount: events.warps.length,
            trapCount: events.traps.length,
            signCount: events.signs.length,
            persons: 0,
            warps: 0,
            traps: 0,
            signs: 0,
          })
        : new Uint8Array(0),
      persons: events ? personCodec.encodeList(events.persons) : new Uint8Array(0),
      warps: events ? warpCodec.encodeList(events.warps) : new Uint8Array(0),
      traps: events ? trapCodec.encodeList(events.traps) : new Uint8Array(0),
      signs: events ? signCodec.encodeList(events.signs) : new Uint8Array(0),
      connectionsHeader: doc.connections
        ? connectionHeaderCodec.encode({ count: doc.connections.length, connections: 0 })
        : new Uint8Array(0),
      connections: doc.connections ? connectionCodec.encodeList(doc.connections) : new Uint8Array(0),
      mapScripts: scripts
        ? mapScriptCodec.encodeList(scripts.map((e) => ({ type: e.type, pointer: e.table ? 0 : e.pointer })))
        : new Uint8Array(0),
      mapScriptLists: scripts
        ? scripts.flatMap((e, i) =>
            e.table ? [{ tableOffset: i * MAP_SCRIPT_ENTRY_SIZE + MAP_SCRIPT_ENTRY.pointer, data: mapScriptCodec.encodeTable(e.table) }] : [],
          )
        : [],
      itemBalls: doc.itemBalls.map((i) => ({ ...i })),
      wild: doc.wild.map((w) => ({
        time: w.time,
        areas: w.areas.map((a) => ({ rate: a.rate, slots: wildSlotCodec.encodeList(a.slots) })),
      })),
    };
  }

  /** JSON の中身から MapDocument を作る。件数と長さが合わなければ ProjectFormatError。 */
  static fromSource(source: CfruMapSource, path: string | null = null): MapDocument {
    try {
      return MapSourceConverter.build(source, path);
    } catch (e) {
      if (e instanceof DataError) throw new ProjectFormatError(e.message, path);
      throw e;
    }
  }

  private static build(source: CfruMapSource, path: string | null): MapDocument {
    const fail = (message: string) => new ProjectFormatError(`マップ ${source.bank}.${source.number}: ${message}`, path);
    const header = mapHeaderCodec.decode(source.header);
    const footer = mapFooterCodec.decode(source.footer);
    if (source.layout.length !== footer.width * footer.height * 2) throw fail("Layout の長さが幅×高さと合いません");
    if (source.border.length !== footer.borderWidth * footer.borderHeight * 2) throw fail("Border の長さが合いません");
    const { layout: _l, events: _e, scripts: _s, connections: _c, ...fields } = header;

    let events: MapEvents | null = null;
    if (source.eventHeader.length !== 0) {
      if (source.eventHeader.length !== EVENT_HEADER_SIZE) throw fail("EventHeader は 20 バイトでなければなりません");
      const h = eventHeaderCodec.decode(source.eventHeader);
      const list = <T>(bytes: Uint8Array, count: number, codec: { size: number; decodeAll(b: Uint8Array): T[] }, key: string) => {
        if (bytes.length !== count * codec.size) throw fail(`${key} の件数が EventHeader と合いません`);
        return codec.decodeAll(bytes);
      };
      events = {
        persons: list(source.persons, h.personCount, personCodec, "Persons"),
        warps: list(source.warps, h.warpCount, warpCodec, "Warps"),
        traps: list(source.traps, h.trapCount, trapCodec, "Traps"),
        signs: list(source.signs, h.signCount, signCodec, "Signs"),
      };
    } else if (source.persons.length + source.warps.length + source.traps.length + source.signs.length !== 0) {
      throw fail("EventHeader が空なのにイベントがあります");
    }

    let connections = null;
    if (source.connectionsHeader.length !== 0) {
      if (source.connectionsHeader.length !== CONNECTION_HEADER_SIZE) throw fail("ConnectionsHeader は 8 バイトでなければなりません");
      const h = connectionHeaderCodec.decode(source.connectionsHeader);
      connections = connectionCodec.decodeAll(source.connections);
      if (connections.length !== h.count) throw fail("Connections の件数が ConnectionsHeader と合いません");
    } else if (source.connections.length !== 0) {
      throw fail("ConnectionsHeader が空なのに接続があります");
    }

    let mapScripts: MapScriptEntry[] | null = null;
    if (source.mapScripts.length !== 0) {
      const heads = mapScriptCodec.decodeList(source.mapScripts);
      mapScripts = heads.map((h) => ({ type: h.type, pointer: h.pointer, table: null }));
      for (const list of source.mapScriptLists) {
        const index = (list.tableOffset - MAP_SCRIPT_ENTRY.pointer) / MAP_SCRIPT_ENTRY_SIZE;
        const entry = Number.isInteger(index) ? mapScripts[index] : undefined;
        if (!entry) throw fail(`MapScriptLists の TableOffset ${list.tableOffset} が一覧の件を指していません`);
        if (entry.table) throw fail(`MapScriptLists の TableOffset ${list.tableOffset} が重複しています`);
        entry.table = mapScriptCodec.decodeTable(list.data);
      }
    } else if (source.mapScriptLists.length !== 0) {
      throw fail("MapScripts が空なのに MapScriptLists があります");
    }

    return new MapDocument({
      id: { bank: source.bank, map: source.number },
      header: fields,
      grid: new BlockGrid(footer.width, footer.height, bytesToCells(source.layout)),
      border: new BlockGrid(footer.borderWidth, footer.borderHeight, bytesToCells(source.border)),
      footerPadding: footer.padding,
      primaryTileset: source.primaryTileset,
      secondaryTileset: source.secondaryTileset,
      mapName: source.mapName.length === 0 ? null : source.mapName.slice(),
      events,
      connections,
      mapScripts,
      wild: source.wild.map((w) => ({
        time: w.time,
        areas: w.areas.map((a) => ({ rate: a.rate, slots: wildSlotCodec.decodeAll(a.slots) })),
      })),
      itemBalls: source.itemBalls.map((i) => ({ ...i })),
    });
  }
}

function cellsToBytes(cells: Uint16Array): Uint8Array {
  const out = new Uint8Array(cells.length * 2);
  cells.forEach((c, i) => {
    out[i * 2] = c & 0xff;
    out[i * 2 + 1] = c >> 8;
  });
  return out;
}

function bytesToCells(bytes: Uint8Array): Uint16Array {
  const out = new Uint16Array(bytes.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = bytes[i * 2]! | (bytes[i * 2 + 1]! << 8);
  return out;
}
