// script/link の公開する名前（イベントのラベルの持ち方。maps/BB/scripts_MM.json と eventscripts）。
export { MAP_LABELS_FORMAT, MapLabelsJson, mapLabelsPath, parseMapLabelsPath, type MapLabelEntry, type MapLabelsFile } from "./MapLabelsJson.js";
export {
  EVENT_LABEL_TARGETS,
  EventLabelStore,
  type EventLabel,
  type EventLabelMismatch,
  type EventLabelSavePlan,
  type EventLabelSnapshot,
  type EventLabelTarget,
  type EventPosition,
  type EventPositions,
  type MapLabels,
} from "./EventLabelStore.js";
export {
  AssignEventLabelsCommand,
  EVENT_LABEL_COMMANDS,
  EventLabelError,
  RealignEventLabelsCommand,
  RenameEventLabelCommand,
  SetEventLabelCommand,
  SetMapScriptTableCommand,
  eventLabelContext,
  isEventLabelContext,
  readTable,
  registerEventLabelCommands,
  tableArgs,
  withEventLabels,
  type AssignEventLabelsArgs,
  type EventLabelContext,
  type RealignEventLabelsArgs,
  type RenameEventLabelArgs,
  type SetEventLabelArgs,
  type SetMapScriptTableArgs,
} from "./EventLabelCommands.js";
export { eventLabelCountsOf, eventPositionsOf, type LabeledEventLists } from "./eventLists.js";
export { EventLabelProject, type AddedEvents, type EventLabelCounts, type EventLabelTrackHooks } from "./EventLabelProject.js";
