// script/edit の公開する名前（ラベルの自動命名・ひな形・ラベル名の変更・マップスクリプトの表）。
export {
  SCRIPT_LABEL_KIND_NAMES,
  isScriptLabelName,
  newScriptLabel,
  scriptLabelMapName,
  scriptTextLabel,
  type ScriptLabelKind,
} from "./LabelNaming.js";
export {
  SCRIPT_TEMPLATE_TEXTS,
  appendBlock,
  asmBlockText,
  emptyScriptTemplate,
  eventScriptTemplate,
  removeBlock,
  stringsBlockText,
  textNewline,
  type ScriptTemplate,
  type ScriptTemplateOptions,
} from "./ScriptTemplates.js";
export { detectLabelRename, findLabelOccurrences, renameLabelInText, type LabelOccurrence } from "./LabelRename.js";
export {
  MAP_SCRIPT_TYPE_NAMES,
  findMapScriptTable,
  isMapScriptTableType,
  isMapScriptTarget,
  mapScriptConditionTableLabel,
  mapScriptTableLines,
  parseMapScriptTable,
  replaceMapScriptTable,
  type MapScriptCondition,
  type MapScriptItem,
  type MapScriptTableModel,
  type MapScriptTableSpan,
} from "./MapScriptTableText.js";
