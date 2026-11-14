// script/config の公開する名前（このフォルダの issue で足す）。
export {
  SCRIPT_DIALECT_SETTINGS,
  XSE_COMMANDS_PATH,
  detectScriptDialect,
  type ScriptDialect,
  type ScriptDialectSetting,
} from "./ScriptDialect.js";
export {
  DEFAULT_SCRIPT_LABEL_TEMPLATE,
  DEFAULT_SCRIPT_LINES_PER_PAGE,
  DEFAULT_SCRIPT_LINE_MAX_CHARS,
  SCRIPT_COPY_COMMAND,
  defaultScriptConfig,
  expandScriptLabelTemplate,
  resolveScriptConfig,
  resolveScriptConfigPath,
  type ScriptCommandStep,
  type ScriptConfig,
  type ScriptConfigSettings,
  type WidthRegistrySetting,
} from "./ScriptConfig.js";
export {
  SCRIPT_CONFIG_FILE,
  SCRIPT_CONFIG_SECTION,
  SCRIPT_DIALECT_FALLBACK,
  ScriptConfigJson,
  loadScriptConfig,
  saveScriptConfig,
  type LoadedScriptConfig,
  type ScriptConfigDocument,
  type ScriptDialectSource,
} from "./ScriptConfigJson.js";
export {
  DEFAULT_USAGE_CONFIG,
  USAGE_CONFIG_SECTION,
  USAGE_KINDS,
  isExcluded,
  loadUsageConfig,
  parseUsageConfig,
  type UsageConfig,
  type UsageKind,
  type UsageRange,
} from "./UsageConfig.js";
