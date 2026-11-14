// script/commands の公開する名前（このフォルダの issue で足す）。
export {
  type CommandArgumentKind,
  type CommandArgumentRole,
  type CommandArgumentShape,
  describeScriptVariable,
  inferCommandArgumentRole,
} from "./argumentKinds.js";
export { type CommandCsv, type CommandCsvEntry, parseCommandCsv } from "./CommandCsv.js";
export { evaluateMacroExpression } from "./macroExpression.js";
export {
  type MacroDataSize,
  type MacroDefinition,
  type MacroFile,
  type MacroFileProblem,
  type MacroParam,
  type MacroStatement,
  parseMacroFile,
  splitMacroCallArgs,
} from "./MacroFile.js";
export {
  buildMacroLayout,
  type MacroCondition,
  type MacroField,
  type MacroLayout,
  type MacroLayoutContext,
  type MacroLayoutResult,
  type MacroVariant,
} from "./MacroLayout.js";
export {
  type CommandArgument,
  formatCommandHover,
  formatCommandSignature,
  resolveCommandArgumentKind,
  type ScriptCommand,
  type ScriptCommandMatch,
  type ScriptCommandProblem,
  ScriptCommandTable,
  type ScriptCommandTableSource,
} from "./ScriptCommandTable.js";
