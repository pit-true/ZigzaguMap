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
