// script/assist の公開する名前（スクリプトエディタの色付け・ホバー・補完・定義へ移動・波線の元になる知識）。
export {
  ASM_DIRECTIVES,
  MSGBOX_TYPES,
  ScriptAssist,
  asmWordAt,
  describeKnownConstant,
  isAsmNameChar,
  localMacroNames,
  parseAsmInteger,
  stringArgBase,
  type AnalyzedArg,
  type AnalyzedLine,
  type AsmOpKind,
  type EquValue,
} from "./ScriptAssist.js";
export { ScriptStringIndex, type ScriptStringEntry } from "./ScriptStringIndex.js";
export { isThumbMnemonic } from "./thumbMnemonics.js";
export { asmSemanticTokens, type AsmSemanticKind, type AsmSemanticToken } from "./asmSemantic.js";
export { asmHoverAt, type AsmHover, type HoverStringRef } from "./asmHover.js";
export {
  argumentItems,
  asmCompletionAt,
  completionLabels,
  type AsmCompletion,
  type AsmCompletionItem,
  type AsmCompletionType,
} from "./asmCompletion.js";
export { asmDefinitionAt, type AsmDefinition, type DefinitionTarget } from "./asmDefinition.js";
export { lintAsmText, type ScriptDiagnostic, type ScriptDiagnosticCode } from "./asmLint.js";
export { lintStringText } from "./stringLint.js";
export { minimalChange, planStringBodyEdit, stringBodyOf, type TextChange } from "./stringEdit.js";
