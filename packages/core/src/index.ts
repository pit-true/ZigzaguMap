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
export {
  MAP_FOOTER,
  MAP_HEADER,
  MapFooterCodec,
  MapHeaderCodec,
  mapFooterCodec,
  mapHeaderCodec,
  type MapHeaderFields,
  type RawMapFooter,
  type RawMapHeader,
} from "./map/MapHeaderCodec.js";

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

// 野生
export * from "./wild/layout.js";
export type { WildArea, WildEncounters, WildHeader, WildInfo, WildSlot } from "./wild/types.js";
export { WildHeaderCodec, WildInfoCodec, WildSlotCodec, wildHeaderCodec, wildInfoCodec, wildSlotCodec } from "./wild/WildCodec.js";
export { WildTable, type WildTableEntry } from "./wild/WildTable.js";

// マップ名
export { JP_CHARSET, JP_SPACE, JP_TERMINATOR } from "./name/charsetJapanese.js";
export { TextCodec } from "./name/TextCodec.js";
export { MAP_NAME_COUNT, MAP_NAME_FIRST_ID, MAP_NAME_MAX_BYTES, MapNameTable, hasMapName } from "./name/MapNameTable.js";

// 編集モデル
export { MapDocument, type ItemBall, type MapDocumentInit } from "./model/MapDocument.js";
export { RomMapSource } from "./model/RomMapSource.js";

// maps\ の形式
export { BOCHI_NEWLINE, writeCompactJson, writeIndentedJson, type BochiJsonValue } from "./project/BochiJson.js";
export { ProjectFormatError } from "./project/ProjectFormatError.js";
export {
  MAP_SOURCE_FORMAT,
  MapSourceJson,
  type CfruMapSource,
  type ItemBallSource,
  type MapScriptListSource,
  type WildAreaSource,
  type WildTimeSource,
} from "./project/MapSourceJson.js";
export { MapSourceConverter } from "./project/MapSourceConverter.js";
export { PROJECT_MANIFEST_FORMAT, ProjectManifestJson, type ProjectManifest } from "./project/ProjectManifest.js";
export { MemoryProjectFs, type ProjectFs } from "./project/ProjectFs.js";
export { TILESET_SOURCE_FORMAT, TilesetSourceJson, pixelsToTiles, type TilesetSource } from "./project/TilesetSource.js";
export { decodeIndexedPng, type IndexedImage } from "./project/png/PngDecoder.js";
export { inflateRaw, inflateZlib, type InflateFunction } from "./project/png/inflate.js";
export * from "./project/paths.js";
export { CfruProject, type MapLoadResult, type SaveResult } from "./project/CfruProject.js";

// 描画
export { createImage, writeBgr555, type RgbaImage } from "./render/color.js";
export { BLOCK_PIXELS, BlockRenderer } from "./render/BlockRenderer.js";
export { MapRenderer, renderMap, type RenderableMap } from "./render/MapRenderer.js";

// 操作コマンド
export type { Command, CommandRecord, EditorContext, JsonObject, JsonValue } from "./command/Command.js";
export { CommandBus, type CommandEvent, type CommandEventType, type CommandListener } from "./command/CommandBus.js";
export { CommandRegistry, createDefaultRegistry, type CommandFactory } from "./command/CommandRegistry.js";
export { GridStore, type GridSource } from "./command/GridStore.js";
export { PlaceBlockCommand, type PlaceBlockArgs } from "./command/commands/PlaceBlockCommand.js";
export { PlaceMovementCommand, type PlaceMovementArgs } from "./command/commands/PlaceMovementCommand.js";
