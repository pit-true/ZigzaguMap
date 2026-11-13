// バイト列
export { DataError } from "./binary/DataError.js";
export { StructCodec } from "./binary/StructCodec.js";
export { decodeBase64, encodeBase64 } from "./binary/base64.js";
export { bytesEqual, concatBytes } from "./binary/bytes.js";

// ROM
export { Rom, ROM_BASE } from "./rom/Rom.js";
export { RomError } from "./rom/RomError.js";
export { decompressLz77, looksLikeLz77 } from "./rom/lz77.js";

// ゲーム判定とオフセット
export { detectGame, requireSupportedGame, type GameInfo } from "./game/GameInfo.js";
export { BPRJ_OFFSETS, OFFSETS_BY_CODE, type GameOffsets } from "./game/offsets.js";

// マップ
export * from "./map/constants.js";
export type { LoadedMap, MapHeader, MapId, MapLayout, Tileset, TilesetHeader } from "./map/types.js";
export { MapBankTable } from "./map/MapBankTable.js";
export { MapHeaderReader } from "./map/MapHeaderReader.js";
export { MapLayoutReader } from "./map/MapLayoutReader.js";
export { TilesetReader } from "./map/TilesetReader.js";
export { MapLoader } from "./map/MapLoader.js";
export { BlockGrid } from "./map/BlockGrid.js";

// イベント
export * from "./event/layout.js";
export type { EventHeader, MapEvents, PersonEvent, SignEvent, SignHiddenItem, SignScript, TrapEvent, WarpEvent } from "./event/types.js";
export { EventHeaderCodec, eventHeaderCodec } from "./event/EventHeaderCodec.js";
export { PersonCodec, personCodec } from "./event/PersonCodec.js";
export { WarpCodec, warpCodec } from "./event/WarpCodec.js";
export { TrapCodec, trapCodec } from "./event/TrapCodec.js";
export { SignCodec, isHiddenItemKind, signCodec } from "./event/SignCodec.js";
export { EventReader } from "./event/EventReader.js";

// 接続
export * from "./connection/layout.js";
export type { ConnectionHeader, MapConnection } from "./connection/types.js";
export { ConnectionCodec, ConnectionHeaderCodec, connectionCodec, connectionHeaderCodec } from "./connection/ConnectionCodec.js";
export { ConnectionReader } from "./connection/ConnectionReader.js";

// マップスクリプト
export * from "./mapscript/layout.js";
export type { MapScriptEntry, MapScriptTable, MapScriptTableEntry } from "./mapscript/types.js";
export {
  MapScriptCodec,
  MapScriptHeadCodec,
  MapScriptTableEntryCodec,
  emptyTableTail,
  mapScriptCodec,
  mapScriptHeadCodec,
  mapScriptTableEntryCodec,
  type MapScriptHead,
} from "./mapscript/MapScriptCodec.js";
export { MapScriptReader, type RawMapScripts } from "./mapscript/MapScriptReader.js";

// 描画
export { createImage, writeBgr555, type RgbaImage } from "./render/color.js";
export { BLOCK_PIXELS, BlockRenderer } from "./render/BlockRenderer.js";
export { MapRenderer, renderMap } from "./render/MapRenderer.js";

// 操作コマンド
export type { Command, CommandRecord, EditorContext, JsonObject, JsonValue } from "./command/Command.js";
export { CommandBus, type CommandEvent, type CommandEventType, type CommandListener } from "./command/CommandBus.js";
export { CommandRegistry, createDefaultRegistry, type CommandFactory } from "./command/CommandRegistry.js";
export { GridStore } from "./command/GridStore.js";
export { PlaceBlockCommand, type PlaceBlockArgs } from "./command/commands/PlaceBlockCommand.js";
export { PlaceMovementCommand, type PlaceMovementArgs } from "./command/commands/PlaceMovementCommand.js";
