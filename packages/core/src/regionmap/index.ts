import type { CommandFactory, CommandRegistry } from "../command/CommandRegistry.js";
import { SetRegionCellsCommand } from "./commands/SetRegionCellsCommand.js";
import { SetRegionFlagCommand } from "./commands/SetRegionFlagCommand.js";
import { SetRegionSectionCommand } from "./commands/SetRegionSectionCommand.js";

export { BPRJ_REGION_MAP, REGION_MAP_ADDRESSES, type RegionMapAddresses } from "./addresses.js";
export * from "./constants.js";
export { FlagSwitchReader } from "./FlagSwitchReader.js";
export {
  RegionMapDocument,
  layoutIndex,
  type FlyDestination,
  type HealLocation,
  type RegionMapSnapshot,
  type RegionSection,
} from "./RegionMapDocument.js";
export { RegionMapGraphics, type RegionMapGraphicsData, type RegionMapGraphicsSource } from "./RegionMapGraphics.js";
export { RegionMapReader, formatRomOffset, type RegionMapRomData, type RegionMapTableAddresses } from "./RegionMapReader.js";
export { REGION_MAP_FORMAT, RegionMapJson } from "./RegionMapJson.js";
export { RegionMapProject } from "./RegionMapProject.js";
export { REGION_MAP_PATH } from "../project/paths.js";
export { isRegionMapContext, regionMapContext, withRegionMap, type RegionMapContext } from "./RegionMapContext.js";
export { SetRegionSectionCommand, type SetRegionSectionArgs } from "./commands/SetRegionSectionCommand.js";
export { SetRegionCellsCommand, type RegionCellWrite, type SetRegionCellsArgs } from "./commands/SetRegionCellsCommand.js";
export { SetRegionFlagCommand, type SetRegionFlagArgs } from "./commands/SetRegionFlagCommand.js";

/** タウンマップのコマンド（名前と作り方）。RegionMapContext が要る。 */
export const REGION_MAP_COMMANDS: readonly { readonly name: string; readonly fromJson: CommandFactory }[] = [
  SetRegionSectionCommand,
  SetRegionCellsCommand,
  SetRegionFlagCommand,
].map((c) => ({ name: c.NAME, fromJson: c.fromJson as CommandFactory }));

/** タウンマップのコマンドを表に登録する。 */
export function registerRegionMapCommands(registry: CommandRegistry): CommandRegistry {
  for (const c of REGION_MAP_COMMANDS) registry.register(c.name, c.fromJson);
  return registry;
}
