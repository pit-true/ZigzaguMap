import type { CommandFactory, CommandRegistry } from "./CommandRegistry.js";
import { AddConnectionCommand } from "./commands/connection/AddConnectionCommand.js";
import { RemoveConnectionCommand } from "./commands/connection/RemoveConnectionCommand.js";
import { SetConnectionCommand } from "./commands/connection/SetConnectionCommand.js";
import { AddEventCommand } from "./commands/event/AddEventCommand.js";
import { MoveEventCommand } from "./commands/event/MoveEventCommand.js";
import { RemoveEventCommand } from "./commands/event/RemoveEventCommand.js";
import { SetEventCountsCommand } from "./commands/event/SetEventCountsCommand.js";
import { SetEventFieldsCommand } from "./commands/event/SetEventFieldsCommand.js";
import { SetItemBallCommand } from "./commands/event/SetItemBallCommand.js";
import { SetFlyPositionCommand } from "./commands/fly/SetFlyPositionCommand.js";
import { SetHeaderFieldsCommand } from "./commands/header/SetHeaderFieldsCommand.js";
import { SetMapNameCommand } from "./commands/header/SetMapNameCommand.js";
import { SetRawHeaderCommand } from "./commands/header/SetRawHeaderCommand.js";
import { ResizeMapCommand } from "./commands/layout/ResizeMapCommand.js";
import { SetBorderCommand } from "./commands/layout/SetBorderCommand.js";
import { SetRawFooterCommand } from "./commands/layout/SetRawFooterCommand.js";
import { SetTilesetsCommand } from "./commands/layout/SetTilesetsCommand.js";
import { AddMapScriptCommand } from "./commands/mapscript/AddMapScriptCommand.js";
import {
  AddMapScriptConditionCommand,
  RemoveMapScriptConditionCommand,
  SetMapScriptConditionCommand,
} from "./commands/mapscript/MapScriptConditionCommands.js";
import { RemoveMapScriptCommand } from "./commands/mapscript/RemoveMapScriptCommand.js";
import { SetMapScriptCommand } from "./commands/mapscript/SetMapScriptCommand.js";
import { CreateMapCommand } from "./commands/project/CreateMapCommand.js";
import { RemapBlockPalettesCommand } from "./commands/tileset/RemapBlockPalettesCommand.js";
import { SetBlockCommand } from "./commands/tileset/SetBlockCommand.js";
import { SetBlockCountCommand } from "./commands/tileset/SetBlockCountCommand.js";
import { SetPaletteColorsCommand } from "./commands/tileset/SetPaletteColorsCommand.js";
import { SetTilesCommand } from "./commands/tileset/SetTilesCommand.js";
import { SetTilesetHeaderCommand } from "./commands/tileset/SetTilesetHeaderCommand.js";
import { SetWildAreasCommand } from "./commands/wild/SetWildAreasCommand.js";
import { SetWildRateCommand } from "./commands/wild/SetWildRateCommand.js";
import { SetWildSlotCommand } from "./commands/wild/SetWildSlotCommand.js";

/** マップ全体・タイルセット・プロジェクトを編集するコマンド（名前と作り方）。DocumentContext が要る。 */
export const EDIT_COMMANDS: readonly { readonly name: string; readonly fromJson: CommandFactory }[] = [
  // イベント
  AddEventCommand,
  RemoveEventCommand,
  MoveEventCommand,
  SetEventFieldsCommand,
  SetEventCountsCommand,
  SetItemBallCommand,
  // フライトポジション（出力しない）
  SetFlyPositionCommand,
  // ヘッダー
  SetHeaderFieldsCommand,
  SetRawHeaderCommand,
  SetMapNameCommand,
  // 配置の大きさ・ボーダー・タイルセットの参照
  ResizeMapCommand,
  SetBorderCommand,
  SetTilesetsCommand,
  SetRawFooterCommand,
  // マップスクリプト
  AddMapScriptCommand,
  RemoveMapScriptCommand,
  SetMapScriptCommand,
  AddMapScriptConditionCommand,
  RemoveMapScriptConditionCommand,
  SetMapScriptConditionCommand,
  // 接続
  AddConnectionCommand,
  RemoveConnectionCommand,
  SetConnectionCommand,
  // 野生
  SetWildRateCommand,
  SetWildSlotCommand,
  SetWildAreasCommand,
  // 新規マップ・バンク
  CreateMapCommand,
  // タイルセット
  SetBlockCommand,
  SetBlockCountCommand,
  SetPaletteColorsCommand,
  SetTilesCommand,
  RemapBlockPalettesCommand,
  SetTilesetHeaderCommand,
].map((c) => ({ name: c.NAME, fromJson: c.fromJson as CommandFactory }));

/** 編集コマンドを表に登録する。 */
export function registerEditCommands(registry: CommandRegistry): CommandRegistry {
  for (const c of EDIT_COMMANDS) registry.register(c.name, c.fromJson);
  return registry;
}
