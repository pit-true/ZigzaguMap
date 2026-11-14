// script/usage の公開する名前（#227 使われている番号の索引）。
export { HIDDEN_ITEM_FLAG_START, HIDDEN_ITEM_ID_MAX, UsageIndex, nextUnused, type UsageSite, type UsageSourceKind } from "./UsageIndex.js";
export { eventUsage, isVariableNumber, romScriptEntries } from "./eventUsage.js";
export { lineUsage, romOffsetOf, romScriptUsage } from "./romUsage.js";
export { asmUsage, type AsmConstantResolver } from "./asmUsage.js";
export { C_CONSTANT_HEADERS, C_SOURCE_DIRS, cSourceUsage } from "./cUsage.js";
export { UsageProject, type UsageBuildStats, type UsageMapContent, type UsageSources } from "./UsageProject.js";
