// バイト列
export { DataError } from "./binary/DataError.js";
export { StructCodec } from "./binary/StructCodec.js";
export { decodeBase64, encodeBase64 } from "./binary/base64.js";
export { bytesEqual, concatBytes, formatHex, formatHexBytes } from "./binary/bytes.js";
export { sha256, sha256Hex } from "./binary/sha256.js";

// ROM
export { Rom, ROM_BASE } from "./rom/Rom.js";
export { RomError } from "./rom/RomError.js";
export { decompressLz77 } from "./rom/lz77.js";

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
export { TilesetTable } from "./map/TilesetTable.js";
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

// フライトポジション
export type { FlyPosition } from "./fly/types.js";
export { FLY_POSITION, FLY_POSITION_SIZE, FlyPositionCodec, FlyTable, cloneFlyPositions, findFlyPosition, flyPositionCodec } from "./fly/FlyTable.js";

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
export { CharmapTable, type CharmapEntry } from "./name/CharmapTable.js";
export { ND_CHARMAP_TBL } from "./name/charmapNd.js";
export { ITEM_ENTRY_SIZE, ITEM_NAME_BYTES, ItemNameTable } from "./name/ItemNameTable.js";
export { MAP_NAME_COUNT, MAP_NAME_FIRST_ID, MAP_NAME_MAX_BYTES, MapNameTable, hasMapName } from "./name/MapNameTable.js";
export { SPECIES_COUNT, SPECIES_NAME_BYTES, SpeciesNameTable } from "./name/SpeciesNameTable.js";

// OW（人のスプライト）
export { OverworldSprites, type OverworldGraphicsInfo } from "./sprite/OverworldSprites.js";

// 編集モデル
export { MapDocument, type ItemBall, type MapDocumentInit } from "./model/MapDocument.js";
export { RomMapSource } from "./model/RomMapSource.js";
export { cloneConnections, cloneEvents, cloneItemBalls, cloneMapScripts, cloneWild } from "./model/clone.js";

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
export { deflateZlib, type DeflateFunction } from "./project/png/deflate.js";
export { crc32, encodeIndexedPng, type IndexedImageInput } from "./project/png/PngEncoder.js";
export { HiddenItemSourceError, buildHiddenItemSource, hiddenItemBlock, itemBallLabel } from "./project/HiddenItemSource.js";
export * from "./project/paths.js";
export { CfruProject, type MapLoadResult, type SaveResult } from "./project/CfruProject.js";
export { RomLocations, toOffset, type MapLocations, type RawMapBytes } from "./project/RomLocations.js";

// タイルセットの編集
export { TilesetDocument, type TilesetDocumentInit, type TilesetRef } from "./tileset/TilesetDocument.js";
export {
  BLOCK_TILE_COUNT,
  attributeBytes,
  attributeFromBytes,
  bgr555ToRgb,
  packTileRef,
  rgbToBgr555,
  unpackBlockAttribute,
  unpackTileRef,
  type BlockAttributeFields,
  type TileRef,
} from "./tileset/blockFormat.js";
export { TILES_PER_ROW, TILE_IMAGE_WIDTH, decodeTilesPng, encodeTilesPng, paletteToPlte, tilesToPixels } from "./tileset/TileImage.js";
export { PALETTE_FILE_BYTES, PaletteFile } from "./tileset/PaletteFile.js";
export { BvdFile, type BvdData } from "./tileset/BvdFile.js";
export { decodeTileImage, encodeTilesDib, type DecodedTiles } from "./tileset/TileBitmap.js";
export { colorFromBgr555, colorFromChannels, colorFromRgb8, formatColorHex, parseColorHex, type ColorValue } from "./tileset/ColorValue.js";

// 描画
export { createImage, writeBgr555, type RgbaImage } from "./render/color.js";
export { BLOCK_PIXELS, BlockRenderer, renderBlocks } from "./render/BlockRenderer.js";
export { MapRenderer, renderMap, type RenderableMap } from "./render/MapRenderer.js";

// 操作コマンド
export type { Command, CommandRecord, EditorContext, JsonObject, JsonValue } from "./command/Command.js";
export { CommandBus, type CommandEvent, type CommandEventType, type CommandListener, type ExecuteOptions } from "./command/CommandBus.js";
export { CommandRegistry, createDefaultRegistry, type CommandFactory } from "./command/CommandRegistry.js";
export { CommandGroup, flattenCommandRecords } from "./command/CommandGroup.js";
export { GridStore, type GridSource } from "./command/GridStore.js";
export { PlaceBlockCommand, type PlaceBlockArgs } from "./command/commands/PlaceBlockCommand.js";
export { PlaceMovementCommand, type PlaceMovementArgs } from "./command/commands/PlaceMovementCommand.js";
export { PaintCellsCommand, type CellWrite } from "./command/commands/PaintCellsCommand.js";
export { PaintBlocksCommand, type PaintBlocksArgs } from "./command/commands/PaintBlocksCommand.js";
export { PaintMovementCommand, type PaintMovementArgs } from "./command/commands/PaintMovementCommand.js";
export { PaintBorderCommand, type PaintBorderArgs } from "./command/commands/PaintBorderCommand.js";

// 編集コマンド（マップ全体・タイルセット・プロジェクト）
export { EditError, EditErrorCode, checkRange, parseHexBytes, parseHexInput, parseIntInput, toHexBytes, type EditErrorParams } from "./command/EditError.js";
export { documentContext, isDocumentContext, type DocumentContext } from "./command/DocumentContext.js";
export { DocumentStore, mapKey, tilesetKey, type DocumentStoreSource } from "./command/DocumentStore.js";
export { EDIT_COMMANDS, registerEditCommands } from "./command/editCommands.js";
export { SnapshotCommand } from "./command/commands/base/SnapshotCommand.js";
export { type MapArgs } from "./command/commands/base/MapPartCommand.js";
export { type TilesetArgs } from "./command/commands/base/TilesetCommand.js";
export { EVENT_FIELD_NAMES, EVENT_KINDS, MAX_EVENTS_PER_KIND, type EventKind } from "./command/commands/event/eventFields.js";
export { AddEventCommand, type AddEventArgs } from "./command/commands/event/AddEventCommand.js";
export { RemoveEventCommand, type RemoveEventArgs } from "./command/commands/event/RemoveEventCommand.js";
export { MoveEventCommand, eventsOutsideMap, moveEventsInsideCommands, nearestInside, type MoveEventArgs } from "./command/commands/event/MoveEventCommand.js";
export { SetEventFieldsCommand, type SetEventFieldsArgs } from "./command/commands/event/SetEventFieldsCommand.js";
export { SetEventCountsCommand, type SetEventCountsArgs } from "./command/commands/event/SetEventCountsCommand.js";
export { SetItemBallCommand, newItemBallId, type SetItemBallArgs } from "./command/commands/event/SetItemBallCommand.js";
export { SetFlyPositionCommand, type SetFlyPositionArgs } from "./command/commands/fly/SetFlyPositionCommand.js";
export { HEADER_FIELD_NAMES } from "./command/commands/header/headerFields.js";
export { SetHeaderFieldsCommand, type SetHeaderFieldsArgs } from "./command/commands/header/SetHeaderFieldsCommand.js";
export { SetRawHeaderCommand, type SetRawHeaderArgs } from "./command/commands/header/SetRawHeaderCommand.js";
export { SetMapNameCommand, type SetMapNameArgs } from "./command/commands/header/SetMapNameCommand.js";
export { MAP_SIZE_LIMIT, checkMapSize, maxMapHeight, resizeGrid } from "./command/commands/layout/mapSize.js";
export { ResizeMapCommand, type ResizeMapArgs } from "./command/commands/layout/ResizeMapCommand.js";
export { SetBorderCommand, type SetBorderArgs } from "./command/commands/layout/SetBorderCommand.js";
export { SetTilesetsCommand, type SetTilesetsArgs } from "./command/commands/layout/SetTilesetsCommand.js";
export { SetRawFooterCommand, type SetRawFooterArgs } from "./command/commands/layout/SetRawFooterCommand.js";
export { AddMapScriptCommand, type AddMapScriptArgs } from "./command/commands/mapscript/AddMapScriptCommand.js";
export { RemoveMapScriptCommand, type RemoveMapScriptArgs } from "./command/commands/mapscript/RemoveMapScriptCommand.js";
export { SetMapScriptCommand, type SetMapScriptArgs } from "./command/commands/mapscript/SetMapScriptCommand.js";
export {
  AddMapScriptConditionCommand,
  RemoveMapScriptConditionCommand,
  SetMapScriptConditionCommand,
  type AddMapScriptConditionArgs,
  type RemoveMapScriptConditionArgs,
  type SetMapScriptConditionArgs,
} from "./command/commands/mapscript/MapScriptConditionCommands.js";
export { type ConnectionFields } from "./command/commands/connection/connectionFields.js";
export { AddConnectionCommand, type AddConnectionArgs } from "./command/commands/connection/AddConnectionCommand.js";
export { RemoveConnectionCommand, type RemoveConnectionArgs } from "./command/commands/connection/RemoveConnectionCommand.js";
export { SetConnectionCommand, type SetConnectionArgs } from "./command/commands/connection/SetConnectionCommand.js";
export { newWildArea } from "./command/commands/wild/wildAreas.js";
export { SetWildRateCommand, type SetWildRateArgs } from "./command/commands/wild/SetWildRateCommand.js";
export { SetWildSlotCommand, type SetWildSlotArgs } from "./command/commands/wild/SetWildSlotCommand.js";
export { SetWildAreasCommand, type SetWildAreasArgs } from "./command/commands/wild/SetWildAreasCommand.js";
export { CreateMapCommand, MAX_MAPS_PER_BANK, NEW_MAP_BORDER_SIZE, NEW_MAP_CELL, type CreateMapArgs } from "./command/commands/project/CreateMapCommand.js";
export { CreateWorkMapCommand, type CreateWorkMapArgs } from "./command/commands/project/CreateWorkMapCommand.js";
export { OpenMapFileCommand, type OpenMapFileArgs } from "./command/commands/project/OpenMapFileCommand.js";
export { InsertMapCommand, type InsertMapArgs } from "./command/commands/project/InsertMapCommand.js";
export { ReplaceMapCommand, type ReplaceMapArgs } from "./command/commands/project/ReplaceMapCommand.js";
export { WORK_MAP_BANK, isWorkMapId, type WorkMapInfo } from "./model/WorkMap.js";
export * from "./amfile/index.js";
export { SetBlockCommand, type SetBlockArgs } from "./command/commands/tileset/SetBlockCommand.js";
export { SetBlockCountCommand, type SetBlockCountArgs } from "./command/commands/tileset/SetBlockCountCommand.js";
export { SetBlockDataCommand, type SetBlockDataArgs } from "./command/commands/tileset/SetBlockDataCommand.js";
export { SetPaletteColorsCommand, type SetPaletteColorsArgs } from "./command/commands/tileset/SetPaletteColorsCommand.js";
export { SetTilesCommand, type SetTilesArgs } from "./command/commands/tileset/SetTilesCommand.js";
export { RemapBlockPalettesCommand, type RemapBlockPalettesArgs } from "./command/commands/tileset/RemapBlockPalettesCommand.js";
export { SetTilesetHeaderCommand, type SetTilesetHeaderArgs } from "./command/commands/tileset/SetTilesetHeaderCommand.js";

// タウンマップ（ワールドマップエディター）
export * from "./regionmap/index.js";

// スクリプト（Phase2。フォルダごとに index.ts から公開する）
export * from "./script/config/index.js";
export * from "./script/commands/index.js";
export * from "./script/asm/index.js";
export * from "./script/index/index.js";
export * from "./script/strings/index.js";
export * from "./script/project/index.js";
export * from "./script/disasm/index.js";
export * from "./script/edit/index.js";
export * from "./script/link/index.js";
export * from "./script/build/index.js";
export * from "./script/assist/index.js";
