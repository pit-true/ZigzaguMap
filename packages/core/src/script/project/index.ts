// script/project の公開する名前（eventscripts と maps\scripts.json）。
export {
  EVENT_SCRIPT_KINDS,
  eventScriptLabel,
  eventScriptSymbolFor,
  eventScriptSymbolPrefix,
  eventScriptTargetOf,
  parseEventScriptAddress,
  parseEventScriptKind,
  type EventScriptKind,
  type EventScriptTarget,
} from "./eventScriptKinds.js";
export {
  EVENT_SCRIPTS_PATH,
  EventScriptsEditError,
  EventScriptsFile,
  isEventScriptEntryActive,
  loadEventScripts,
  parseEventScriptDefines,
  saveEventScripts,
  type EventScriptCondition,
  type EventScriptEntry,
  type EventScriptEntrySpec,
  type EventScriptsLine,
  type EventScriptsLineType,
  type EventScriptsRemapResult,
} from "./EventScriptsFile.js";
